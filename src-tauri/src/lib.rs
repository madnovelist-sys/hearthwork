// The desktop (and later mobile) shell around the web game in ../src.
//
// Besides hosting the game, the shell gives it what a browser can't:
// - a menu-bar clock with Start/Stop, which keeps ticking while the window is hidden,
// - closing the window hides it (the city keeps its clock in the menu bar),
// - how long since the last keyboard or mouse input, so a forgotten session can pause,
// - system notifications,
// - saving a village to a file you choose, and opening one again.
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Manager, WindowEvent};

#[derive(Default)]
struct Timer {
    running: bool,
    /** Focus time already counted when the game last reported it. */
    elapsed_ms: u64,
    /** When the game last reported it. */
    at_ms: u64,
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn clock_text(ms: u64) -> String {
    let t = ms / 1000;
    let (h, m, s) = (t / 3600, (t % 3600) / 60, t % 60);
    if h > 0 { format!("{h}:{m:02}:{s:02}") } else { format!("{m}:{s:02}") }
}

/// The game reports whether a session is running and how much time it has counted.
#[tauri::command]
fn set_timer(app: AppHandle, state: tauri::State<Mutex<Timer>>, running: bool, elapsed_ms: u64) {
    let changed = {
        let mut t = state.lock().unwrap();
        let changed = t.running != running;
        t.running = running;
        t.elapsed_ms = elapsed_ms;
        t.at_ms = now_ms();
        changed
    };
    if changed {
        #[cfg(desktop)]
        if let Some(item) = app.try_state::<tauri::menu::MenuItem<tauri::Wry>>() {
            let _ = item.set_text(if running { "Stop (take a break)" } else { "Start working" });
        }
    }
    update_clock(&app);
}

/// Seconds since the last keyboard or mouse input anywhere on the computer,
/// or nothing where that isn't available yet.
#[tauri::command]
fn idle_seconds() -> Option<f64> {
    idle::seconds()
}

#[cfg(target_os = "macos")]
mod idle {
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventSourceSecondsSinceLastEventType(source_state: i32, event_type: u32) -> f64;
    }
    pub fn seconds() -> Option<f64> {
        // kCGEventSourceStateCombinedSessionState = 0, kCGAnyInputEventType = ~0
        Some(unsafe { CGEventSourceSecondsSinceLastEventType(0, u32::MAX) })
    }
}

#[cfg(not(target_os = "macos"))]
mod idle {
    pub fn seconds() -> Option<f64> {
        None
    }
}

fn update_clock(app: &AppHandle) {
    let (running, ms) = {
        let state = app.state::<Mutex<Timer>>();
        let t = state.lock().unwrap();
        (t.running, t.elapsed_ms + now_ms().saturating_sub(t.at_ms))
    };
    #[cfg(desktop)]
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_title(if running { Some(clock_text(ms)) } else { None });
        let _ = tray.set_tooltip(Some(if running { "Hearthwork: you're working" } else { "Hearthwork: the city sleeps" }));
    }
    #[cfg(not(desktop))]
    let _ = (running, ms);
}

fn show_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

#[cfg(desktop)]
fn setup_tray(app: &mut tauri::App) -> tauri::Result<()> {
    use tauri::image::Image;
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
    use tauri::tray::TrayIconBuilder;
    use tauri::Emitter;

    let toggle = MenuItem::with_id(app, "toggle", "Start working", true, None::<&str>)?;
    let show = MenuItem::with_id(app, "show", "Show Hearthwork", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Hearthwork", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&toggle, &show, &separator, &quit])?;
    app.manage(toggle);

    TrayIconBuilder::with_id("main")
        .icon(Image::from_bytes(include_bytes!("../icons/tray.png"))?)
        .icon_as_template(true)
        .tooltip("Hearthwork")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "toggle" => {
                // Stopping means it's break time: bring the window up to show what happened.
                let running = app.state::<Mutex<Timer>>().lock().map(|t| t.running).unwrap_or(false);
                let _ = app.emit("tray-toggle", ());
                if running {
                    show_window(app);
                }
            }
            "show" => show_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;

    // Keep the menu-bar clock ticking even while the window is hidden and the
    // game's own timers are slowed down.
    let handle = app.handle().clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(1));
        update_clock(&handle);
    });
    Ok(())
}

/// Only save files the game makes: villages and chronicles.
fn allowed_file(path: &str, exts: &[&str]) -> Result<(), String> {
    let ext = std::path::Path::new(path).extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    if exts.contains(&ext.as_str()) { Ok(()) } else { Err(format!("Hearthwork only saves {} files.", exts.join(", "))) }
}

/// Write a village (or the Chronicle) to the file the player chose in the save dialog.
#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    allowed_file(&path, &["json", "md", "txt"])?;
    std::fs::write(&path, contents).map_err(|e| e.to_string())
}

/// Read a village file the player chose in the open dialog.
#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    allowed_file(&path, &["json"])?;
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(Mutex::new(Timer::default()))
        .invoke_handler(tauri::generate_handler![set_timer, idle_seconds, write_text_file, read_text_file])
        .setup(|app| {
            #[cfg(desktop)]
            setup_tray(app)?;
            #[cfg(not(desktop))]
            let _ = app;
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the window hides it; Hearthwork keeps running in the menu bar.
            if let WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building Hearthwork");

    app.run(|app, event| {
        // Clicking the Dock icon brings the window back.
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Reopen { .. } = event {
            show_window(app);
        }
        let _ = (app, event);
    });
}
