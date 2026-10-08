// Logic with no UI or Tauri dependencies, shared by main.js and the tests (npm test).

export const DEFAULT_SETTINGS = {
  character: "chomp",
  eatenCount: 0,
  position: null,
  onTop: true,
  scale: 1,
  autostartSet: false,
};

// Never saved, and dropped if an older version saved them. Permanent delete is session-only:
// every launch starts in Recycle Bin mode, so a restart can't leave it silently switched on.
const SESSION_ONLY = ["permanent"];

/** Saved settings (a JSON string, or null on first run) merged over the defaults. */
export function loadSettings(json) {
  let saved = {};
  try {
    saved = JSON.parse(json) ?? {};
  } catch {}
  if (typeof saved !== "object" || Array.isArray(saved)) saved = {};
  const settings = { ...DEFAULT_SETTINGS, ...saved };
  for (const key of SESSION_ONLY) delete settings[key];
  return settings;
}

/** The JSON to save: everything except session-only settings. */
export function serializeSettings(settings) {
  const saved = { ...settings };
  for (const key of SESSION_ONLY) delete saved[key];
  return JSON.stringify(saved);
}

/**
 * Runs eat jobs one at a time, in drop order. The deletion mode is passed in when a drop is
 * queued, so toggling permanent delete afterwards can't change what already-queued drops do.
 * `feed(paths, permanent)` returns that job's promise; a failed job doesn't block later ones.
 */
export function createFeedQueue(eat) {
  let tail = Promise.resolve();
  return function feed(paths, permanent) {
    const job = tail.then(() => eat(paths, permanent));
    tail = job.catch(() => {});
    return job;
  };
}
