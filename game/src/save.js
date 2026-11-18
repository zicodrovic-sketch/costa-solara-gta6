// Costa Solara — save/load via localStorage. Everything is try/catch: private windows
// and non-browser runtimes (Node) have no usable storage, so every call degrades to
// defaults instead of throwing.
import { SAVE_KEY } from './config.js';

/** The shape a save always has, even when nothing was ever stored. */
export function defaultSave() {
  return { cash: 0, missionIndex: 0, bestCash: 0, muted: false };
}

/** Read the save, merging over defaults so old or partial saves stay valid. */
export function loadSave() {
  const save = defaultSave();
  try {
    if (typeof localStorage === 'undefined') return save;
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return save;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      if (Number.isFinite(parsed.cash)) save.cash = parsed.cash;
      if (Number.isFinite(parsed.missionIndex)) save.missionIndex = parsed.missionIndex;
      if (Number.isFinite(parsed.bestCash)) save.bestCash = parsed.bestCash;
      if (typeof parsed.muted === 'boolean') save.muted = parsed.muted;
    }
  } catch {
    // Corrupt or unreadable save: play from defaults.
  }
  return save;
}

/** Write the current run: cash, mission progress, best cash so far, mute setting. */
export function saveGame(state) {
  try {
    if (typeof localStorage === 'undefined') return;
    const previous = loadSave();
    const data = {
      cash: state.cash || 0,
      missionIndex: state.mission ? state.mission.index || 0 : 0,
      bestCash: Math.max(previous.bestCash || 0, state.cash || 0),
      muted: !!state.muted,
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch {
    // Storage unavailable: the run simply is not persisted.
  }
}

/** Erase the save entirely (new-game reset). */
export function clearSave() {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(SAVE_KEY);
  } catch {
    // Ignore.
  }
}
