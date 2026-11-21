// Saving to a file and opening one: in the Mac app, with the system's own save
// and open dialogs; in a browser, as a download and a file picker.
import { isDesktop } from './desktop';

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

/** Save text to a file the player chooses. Resolves true if it was saved. */
export async function saveTextFile(name: string, text: string, kind: { label: string; ext: string; mime: string }): Promise<boolean> {
  if (isDesktop) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { invoke } = await import('@tauri-apps/api/core');
    const path = await save({ defaultPath: name, filters: [{ name: kind.label, extensions: [kind.ext] }] });
    if (!path) return false;
    await (invoke as Invoke)('write_text_file', { path, contents: text });
    return true;
  }
  const url = URL.createObjectURL(new Blob([text], { type: kind.mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

/** Let the player choose a village file and read it. Resolves null if they cancel. */
export async function openTextFile(): Promise<string | null> {
  if (isDesktop) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const { invoke } = await import('@tauri-apps/api/core');
    const path = await open({ multiple: false, directory: false, filters: [{ name: 'Hearthwork village', extensions: ['json'] }] });
    if (!path || Array.isArray(path)) return null;
    return (invoke as Invoke)<string>('read_text_file', { path });
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = () => { const f = input.files?.[0]; if (f) f.text().then(resolve, () => resolve(null)); else resolve(null); };
    input.click();
  });
}
