// Saving. A city can hold hundreds of hours of someone's work, so it's saved
// often, backed up daily, and can be exported to a file at any time.
import { DAYS_PER_YEAR } from '../sim/types';
import type { GameState } from '../sim/types';
import { SAVE_VERSION } from '../sim/sim';
import { ensureForest } from '../sim/forest';
import { saveTextFile } from './files';

const DB_NAME = 'hearthwork';
const STORE = 'saves';
const CURRENT = 'current';
const BACKUPS_KEPT = 7;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => { db.close(); resolve(req.result); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

const backupKey = (date: string) => `backup:${date}`;

export async function saveGame(s: GameState, date: string): Promise<void> {
  const json = JSON.stringify(s);
  try {
    await withStore('readwrite', (st) => st.put(json, CURRENT));
    const key = backupKey(date);
    const existing = await withStore<IDBValidKey[]>('readonly', (st) => st.getAllKeys());
    if (!existing.includes(key)) {
      await withStore('readwrite', (st) => st.put(json, key));
      const backups = existing.filter((k) => String(k).startsWith('backup:')).map(String).sort();
      for (const old of backups.slice(0, Math.max(0, backups.length + 1 - BACKUPS_KEPT))) {
        await withStore('readwrite', (st) => st.delete(old));
      }
    }
  } catch {
    // Storage unavailable (private window, blocked site data): fall back to localStorage.
    try { localStorage.setItem('hearthwork:current', json); } catch { /* nowhere left to save */ }
  }
}

export async function loadGame(): Promise<GameState | null> {
  let json: string | undefined;
  try {
    json = await withStore<string | undefined>('readonly', (st) => st.get(CURRENT));
  } catch { /* fall through */ }
  if (!json) {
    try { json = localStorage.getItem('hearthwork:current') ?? undefined; } catch { /* none */ }
  }
  if (!json) return null;
  return parseSave(json);
}

export async function listBackups(): Promise<string[]> {
  try {
    const keys = await withStore<IDBValidKey[]>('readonly', (st) => st.getAllKeys());
    return keys.map(String).filter((k) => k.startsWith('backup:')).map((k) => k.slice(7)).sort().reverse();
  } catch {
    return [];
  }
}

export async function loadBackup(date: string): Promise<GameState | null> {
  const json = await withStore<string | undefined>('readonly', (st) => st.get(backupKey(date)));
  return json ? parseSave(json) : null;
}

export async function deleteSave(): Promise<void> {
  try { await withStore('readwrite', (st) => st.delete(CURRENT)); } catch { /* ignore */ }
  try { localStorage.removeItem('hearthwork:current'); } catch { /* ignore */ }
}

/** Fahrenheit where people use it, Celsius elsewhere. */
export function defaultUnits(): 'c' | 'f' {
  const lang = typeof navigator !== 'undefined' ? navigator.language : '';
  return /^en-(US|LR|MM)$/i.test(lang) || /-US$/.test(lang) ? 'f' : 'c';
}

export function parseSave(json: string): GameState {
  const data = JSON.parse(json) as GameState;
  if (!data || typeof data !== 'object' || !Array.isArray(data.people) || !data.map) {
    throw new Error("This file doesn't look like a Hearthwork save.");
  }
  if (data.version > SAVE_VERSION) throw new Error('This save comes from a newer version of Hearthwork.');
  return migrate(data);
}

function migrate(s: GameState): GameState {
  // Version 1 is the first format; future versions upgrade older saves here.
  s.flags ??= { relics: 0, knowledge: 0 };
  s.lateReturns ??= [];
  s.pending ??= [];
  s.arrivals ??= [];
  s.sparks ??= 0;
  s.settings.units ??= defaultUnits();
  // Traditions: an older village already buries its dead, and (if it's a village) has a chief.
  if (!s.traditions) {
    s.traditions = { history: [] };
    if (s.graves.length || s.buildings.some((b) => b.kind === 'graveyard')) s.traditions.dead = { custom: 'burial', since: 0 };
    if (s.stage !== 'settlement') s.traditions.rule = { form: 'chief', since: 0 };
  }
  s.goals.track ??= 'time';
  s.settings.awayMinutes ??= 15;
  ensureForest(s.map);
  s.laws ??= [];
  s.faiths ??= [];
  s.fortunes ??= [];
  s.pets ??= [];
  s.wild ??= { deer: -1 };
  s.items ??= [];
  s.nextId.pet ??= 0;
  s.nextId.item ??= 0;
  s.nextId.faith ??= 0;
  s.nextId.fortune ??= 0;
  s.settings.notify ??= false;
  s.settings.dayNight ??= 'clock';
  s.settings.stopAt ??= null;
  // Towns and ages. An older city has been learning things all along: give it a head start,
  // and the discoveries arrive over the next seasons.
  s.ages ??= [{ name: s.age.name, era: s.age.era, from: 0 }];
  s.lore ??= { points: Math.min(300, Math.floor(s.day / DAYS_PER_YEAR) * 6), known: [] };
  s.guilds ??= [];
  s.nextId.guild ??= 0;
  // Petitions and the Old Stone are gone: the hearth is the one gathering place.
  delete (s as { petitions?: unknown }).petitions;
  for (const b of s.buildings) {
    if (b.kind !== 'stone' || b.removed) continue;
    b.removed = true;
    for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) {
      const i = y * s.map.w + x;
      if (s.map.occ[i] === b.id + 1) s.map.occ[i] = 0;
    }
  }
  return s;
}

/** Save the whole village to a file of the player's choosing. Resolves true if saved. */
export async function saveVillageToFile(s: GameState): Promise<boolean> {
  const stamp = new Date().toISOString().slice(0, 10);
  const name = `${s.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-year-${Math.floor(s.day / DAYS_PER_YEAR) + 1}-${stamp}.json`;
  return saveTextFile(name, JSON.stringify(s), { label: 'Hearthwork village', ext: 'json', mime: 'application/json' });
}

// ---------------------------------------------------------------------------
// Other villages: starting a new one keeps the old, to come back to any time.

export interface VillageInfo { key: string; name: string; year: number; people: number; savedAt: number }
const villageKey = (s: GameState) => String(s.seed);

/** Put a village away (it can be picked up again from Settings or the founding screen). */
export async function archiveVillage(s: GameState): Promise<void> {
  const key = villageKey(s);
  const info: VillageInfo = {
    key, name: s.name, year: Math.floor(s.day / DAYS_PER_YEAR) + 1,
    people: s.people.filter((p) => p.alive && !p.left && p.away === undefined).length, savedAt: Date.now(),
  };
  const json = JSON.stringify(s);
  await withStore('readwrite', (st) => st.put(json, `village:${key}`));
  await withStore('readwrite', (st) => st.put(JSON.stringify(info), `villageinfo:${key}`));
}

export async function listVillages(): Promise<VillageInfo[]> {
  try {
    const keys = (await withStore<IDBValidKey[]>('readonly', (st) => st.getAllKeys())).map(String).filter((k) => k.startsWith('villageinfo:'));
    const out: VillageInfo[] = [];
    for (const k of keys) {
      const raw = await withStore<string | undefined>('readonly', (st) => st.get(k));
      if (raw) out.push(JSON.parse(raw));
    }
    return out.sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

/** Take a village back out (it becomes the current one, so it's no longer kept separately). */
export async function takeVillage(key: string): Promise<GameState | null> {
  const json = await withStore<string | undefined>('readonly', (st) => st.get(`village:${key}`));
  if (!json) return null;
  const s = parseSave(json);
  await forgetVillage(key);
  return s;
}

export async function forgetVillage(key: string): Promise<void> {
  await withStore('readwrite', (st) => st.delete(`village:${key}`));
  await withStore('readwrite', (st) => st.delete(`villageinfo:${key}`));
}

export async function importGame(file: File): Promise<GameState> {
  return parseSave(await file.text());
}
