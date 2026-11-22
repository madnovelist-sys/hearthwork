# Hearthwork

A city that only lives while you work.

Eight travelers light a fire by a river. Start a focus session and the sun rises on them; stop, and they sleep. Every hour you work is a year of their lives: they build homes, farm, fall in love, have children, fall ill, go on quests and come back rich, or don't come back. Every twenty minutes or so you earn a Spark, and reaching your daily goal earns more. Spend them to call newcomers to the gate (each bringing the customs of their homeland), to bless people, create settlers of your own, send someone out into the world, or encourage the customs you'd like your town to keep.

- Game design and decisions: [docs/design.md](docs/design.md)
- Art pipeline: [art/README.md](art/README.md)

## Playing

1. Found your settlement: name it, pick a site, choose whether to track time worked or words written, set your daily goal and Sparks, and choose the Darkness and Weirdness.
2. Press **Start working** when you begin. Keep Hearthwork open in another window or on a second screen; it keeps time even when hidden or minimized.
3. Press **Stop** when you take a break. If you track words, enter what you wrote. Read what happened while you worked, welcome travelers, and spend Sparks on Acts.

Everything saves automatically every 30 seconds, with a backup from each of the last 7 days you played. **Settings → Export save file** makes a full backup you can keep anywhere.

## Running it

You need [Node.js](https://nodejs.org) 20 or newer.

```bash
npm install
```

To play in a browser while developing:

```bash
npm run dev
```

Then open http://localhost:5173.

To run it as a Mac app (needs [Rust](https://rustup.rs) and Xcode's command-line tools):

```bash
npm run desktop:dev
```

To build an installable Mac app on your own machine:

```bash
npm run desktop:build
```

Or let GitHub build it: on the repository's **Actions** tab, choose **Desktop apps → Run workflow**. When it finishes, the Mac `.dmg` and the Windows installer are downloadable from the run's page. The apps aren't code-signed yet, so the first time you open the Mac app, right-click it and choose **Open** (or allow it under System Settings → Privacy & Security).

## Development

```bash
npm test               # simulation, clock and save tests
npm run simulate -- 60 # run 60 focus hours headless and print a census
npm run art            # turn art/ masters into game sprites in public/art/
```

```
src/sim/      the simulation: pure, seeded, deterministic, no browser APIs
src/game/     the focus clock, saving, and the store the UI reads
src/render/   the isometric Canvas renderer, sprites and placeholders, walkers
src/app/      the interface (Preact)
art/          art masters from ChatGPT, exactly as made (see art/README.md)
public/art/   generated game sprites and manifest (made by npm run art)
src-tauri/    the desktop shell (Tauri 2); later iOS and Android too
```
