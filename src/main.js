const { invoke } = window.__TAURI__.core;
const { getCurrentWindow, currentMonitor, availableMonitors, PhysicalPosition, LogicalSize } = window.__TAURI__.window;
const { getCurrentWebview } = window.__TAURI__.webview;
const { Menu, MenuItem, CheckMenuItem, Submenu, PredefinedMenuItem } = window.__TAURI__.menu;
const { TrayIcon } = window.__TAURI__.tray;
const { Image: TauriImage } = window.__TAURI__.image;

const appWindow = getCurrentWindow();
const guyEl = document.getElementById("guy");
const bubbleEl = document.getElementById("bubble");

// ---------- settings (persisted in the WebView's local storage) ----------

const SETTINGS_KEY = "desktop-deleter-settings";
const settings = Object.assign(
  { character: "chomp", permanent: false, eatenCount: 0, position: null, onTop: true, scale: 1, autostartSet: false },
  safeParse(localStorage.getItem(SETTINGS_KEY))
);

function safeParse(json) {
  try { return JSON.parse(json) || {}; } catch { return {}; }
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

// ---------- character loading ----------
//
// Every character ships the same sprite sheet: one image per (level, state).
//   levels: empty, bit, half, full, overflow  -- how full the Recycle Bin (his tummy) is
//           permanent                         -- used instead while permanent delete is on
//   states: idle, hungry, eating, happy, refuse
// File names come from the character's `sprites` pattern, e.g. "{level}-{state}.svg".

const LEVELS = [
  { name: "empty", at: 0 },
  { name: "bit", at: 0.2 },
  { name: "half", at: 0.45 },
  { name: "full", at: 0.7 },
  { name: "overflow", at: 0.9 },
];
const PERMANENT_LEVEL = "permanent";
const STATES = ["idle", "hungry", "eating", "happy", "refuse"];

const DEFAULT_TIMINGS = { eatingMs: 1400, happyMs: 1600, refuseMs: 2200, petMs: 1200 };
// How fullness (0..1) is derived from the Recycle Bin: 1 = this many MB or items.
const DEFAULT_FULLNESS = { fullAtMB: 1024, fullAtItems: 100 };
let characterIds = [];
let character = null; // { id, base, def, sprites: Set of file names that loaded }

async function loadJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

const spriteFile = (def, level, state) => def.sprites.replace("{level}", level).replace("{state}", state);

/** Loads an image; resolves to whether it exists. Also warms the cache so states never flicker. */
const preload = (url) =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });

async function loadCharacter(id) {
  const base = `characters/${id}/`;
  const def = await loadJson(base + "character.json");
  def.sprites = def.sprites || "{level}-{state}.png";
  def.timings = { ...DEFAULT_TIMINGS, ...def.timings };
  def.lines = def.lines || {};
  def.fullness = { ...DEFAULT_FULLNESS, ...def.fullness };

  const files = [...LEVELS.map((l) => l.name), PERMANENT_LEVEL].flatMap((level) =>
    STATES.map((state) => spriteFile(def, level, state))
  );
  const loaded = await Promise.all(files.map((f) => preload(base + f)));
  const sprites = new Set(files.filter((_, i) => loaded[i]));
  const missing = files.filter((f) => !sprites.has(f));
  if (missing.length) console.warn(`${id} is missing sprites:`, missing);

  character = { id, base, def, sprites };
  settings.character = id;
  saveSettings();
  currentFile = null;
  applyFullness();
  setState("idle");
}

// ---------- tummy (= Recycle Bin contents) ----------

let tummy = { bytes: 0, items: 0 };
let fullness = 0;

function computeFullness({ bytes, items }) {
  const f = character.def.fullness;
  // Front-loaded log scale: the first few snacks show right away, then it tapers off.
  const bySize = Math.log1p(bytes / 1048576) / Math.log1p(f.fullAtMB);
  const byCount = Math.log1p(items * 4) / Math.log1p(f.fullAtItems * 4);
  return Math.min(1, Math.max(bySize, byCount));
}

/** Which sprite level to draw: the permanent set while permanent delete is on, else by fullness. */
function currentLevel() {
  if (settings.permanent) return PERMANENT_LEVEL;
  let level = LEVELS[0].name;
  for (const l of LEVELS) if (fullness >= l.at) level = l.name;
  return level;
}

/** Re-render the current state, e.g. after the level changed. */
function redraw() {
  if (currentState) setState(currentState);
}

function applyFullness() {
  const before = currentLevel();
  fullness = computeFullness(tummy);
  if (currentLevel() !== before) redraw();
}

async function refreshTummy() {
  try {
    const before = tummy;
    tummy = await invoke("tummy");
    if (character) applyFullness();
    if (tummy.items !== before.items || tummy.bytes !== before.bytes) updateTray();
  } catch (e) {
    console.error(e);
  }
}

function formatBytes(n) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i && n < 10 ? 1 : 0)} ${units[i]}`;
}

async function digest() {
  const before = tummy.items;
  setState("hungry");
  say(line("digestStart") || "Hrrngh...", 4000);
  const ok = await invoke("digest");
  await refreshTummy();
  if (ok && tummy.items < before) {
    setState("happy", character.def.timings.happyMs);
    say(line("digest") || "Ahh, much better!", 2500);
  } else {
    setState("idle");
    say("Never mind, I'll keep it.", 2000);
  }
}

// ---------- state machine ----------

let currentState = null;
let currentFile = null;
let stateGen = 0;

/** Picks the best sprite that exists: this level+state, this level's idle, then the empty level. */
function resolveSprite(state) {
  const { def, sprites } = character;
  const level = currentLevel();
  const candidates = [[level, state], [level, "idle"], ["empty", state], ["empty", "idle"]];
  for (const [l, s] of candidates) {
    const file = spriteFile(def, l, s);
    if (sprites.has(file)) return file;
  }
  return spriteFile(def, "empty", "idle");
}

/** Show a state; if `revertMs` is given, fall back to idle afterwards (unless something else happened). */
function setState(state, revertMs) {
  const gen = ++stateGen;
  const file = resolveSprite(state);
  if (file !== currentFile) {
    guyEl.src = character.base + file;
    currentFile = file;
  }
  currentState = state;
  if (revertMs) {
    setTimeout(() => { if (gen === stateGen) setState("idle"); }, revertMs);
  }
}

let bubbleTimer;
function say(text, ms = 2200) {
  if (!text) return;
  bubbleEl.textContent = text;
  bubbleEl.classList.add("show");
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => bubbleEl.classList.remove("show"), ms);
}

function line(kind, vars = {}) {
  const options = character.def.lines[kind];
  if (!options || !options.length) return "";
  const text = options[Math.floor(Math.random() * options.length)];
  return text.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- eating ----------

let busy = false;
let feedQueue = Promise.resolve();

function feed(paths) {
  feedQueue = feedQueue.then(() => eatNow(paths)).catch((e) => {
    console.error(e);
    busy = false;
    setState("refuse", character.def.timings.refuseMs);
    say("Ow, my tummy... something went wrong.");
  });
}

async function eatNow(paths) {
  if (!paths.length) return;
  busy = true;
  const t = character.def.timings;
  setState("eating");
  const started = Date.now();
  const report = await invoke("eat", { paths, permanent: settings.permanent });
  const remaining = t.eatingMs - (Date.now() - started);
  if (remaining > 0) await sleep(remaining);

  settings.eatenCount += report.eaten;
  saveSettings();
  await refreshTummy();
  busy = false;

  if (report.refused.length) {
    const r = report.refused[0];
    const more = report.refused.length > 1 ? ` (+${report.refused.length - 1} more)` : "";
    setState("refuse", t.refuseMs);
    say(`${line("refuse")} "${r.name}": ${r.reason}${more}`, t.refuseMs + 800);
  } else {
    setState("happy", t.happyMs);
    const level = currentLevel();
    const kind = level === PERMANENT_LEVEL && character.def.lines.permanentEat ? "permanentEat"
      : (level === "full" || level === "overflow") && character.def.lines.full ? "full"
      : "eat";
    say(line(kind, { count: report.eaten, total: settings.eatenCount }), t.happyMs);
  }
}

getCurrentWebview().onDragDropEvent(({ payload }) => {
  switch (payload.type) {
    case "enter":
      if (!busy) {
        setState("hungry");
        say(line("hungry"), 1500);
      }
      break;
    case "leave":
      if (!busy) setState("idle");
      break;
    case "drop":
      feed(payload.paths || []);
      break;
  }
});

// ---------- dragging the window around / petting ----------

let pressAt = null;
guyEl.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return;
  pressAt = { x: e.screenX, y: e.screenY };
});
window.addEventListener("mousemove", (e) => {
  if (!pressAt || !(e.buttons & 1)) return;
  if (Math.hypot(e.screenX - pressAt.x, e.screenY - pressAt.y) > 4) {
    pressAt = null;
    appWindow.startDragging();
  }
});
window.addEventListener("mouseup", () => {
  if (pressAt && !busy) {
    setState("happy", character.def.timings.petMs);
    say(line("pet"), character.def.timings.petMs);
  }
  pressAt = null;
});

appWindow.onMoved(({ payload }) => {
  settings.position = { x: payload.x, y: payload.y };
  saveSettings();
});

// ---------- menus: right-click on him, and the tray icon ----------

const sep = () => PredefinedMenuItem.new({ item: "Separator" });
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

async function characterSubmenu() {
  const items = await Promise.all(
    characterIds.map(async (id) => {
      let name = id;
      try { name = (await loadJson(`characters/${id}/character.json`)).name || id; } catch {}
      return CheckMenuItem.new({
        text: name,
        checked: id === character.id,
        action: () => loadCharacter(id).then(updateTray).catch(console.error),
      });
    })
  );
  return Submenu.new({ text: "Characters", items });
}

function togglePermanent() {
  settings.permanent = !settings.permanent;
  saveSettings();
  applyMode();
  redraw();
  updateTray();
  say(settings.permanent ? "No take-backs mode! Files are gone for good." : "Phew, back to the Recycle Bin.", 3000);
}

/** The menu items both menus share. */
async function sharedItems() {
  return [
    await MenuItem.new({
      text: `Tummy: ${formatBytes(tummy.bytes)} (${plural(tummy.items, "item")} in Recycle Bin)`,
      enabled: false,
    }),
    await MenuItem.new({
      text: "Digest (empty Recycle Bin)...",
      enabled: tummy.items > 0,
      action: () => { if (!busy) digest().catch(console.error); },
    }),
    await sep(),
    await characterSubmenu(),
    await CheckMenuItem.new({ text: "Permanent delete (skip Recycle Bin)", checked: settings.permanent, action: togglePermanent }),
    await sep(),
    await Submenu.new({
      text: "Size",
      items: await Promise.all(
        SIZES.map((pct) =>
          CheckMenuItem.new({
            text: `${pct}%`,
            checked: Math.round(settings.scale * 100) === pct,
            action: () => setScale(pct / 100).then(updateTray).catch(console.error),
          })
        )
      ),
    }),
    await CheckMenuItem.new({
      text: "Always on top",
      checked: settings.onTop,
      action: () => setOnTop(!settings.onTop).then(updateTray).catch(console.error),
    }),
    await MenuItem.new({ text: "Move to corner", action: () => setShown(true).then(moveToDefaultPosition) }),
    await CheckMenuItem.new({
      text: "Start with Windows",
      checked: autostart,
      action: () => setAutostart(!autostart).then(updateTray).catch(console.error),
    }),
    await sep(),
    await MenuItem.new({ text: "Quit", action: () => appWindow.close() }),
  ];
}

window.addEventListener("contextmenu", async (e) => {
  e.preventDefault();
  const menu = await Menu.new({
    items: [
      await MenuItem.new({ text: `${character.def.name} has eaten ${plural(settings.eatenCount, "file")}`, enabled: false }),
      ...(await sharedItems()),
    ],
  });
  await menu.popup();
});

// The tray icon is a little bin: left-click shows/hides him, right-click opens the menu.
// It turns red-hot in permanent delete mode, so the warning shows even while he's hidden.

let tray = null;
let trayFire = null;
let shown = true;

async function setShown(value) {
  shown = value;
  if (value) {
    await appWindow.show();
    await setOnTop(settings.onTop); // re-apply his layer after being hidden
  } else {
    await appWindow.hide();
  }
  updateTray();
}

function binSvg(fire) {
  const c = fire
    ? { body: "#ff7a2e", lid: "#ffb36b", stroke: "#7a2208" }
    : { body: "#4cc79a", lid: "#6fe0b4", stroke: "#1d6b4f" };
  const top = fire
    ? `<path d="M16 0.8 C12.6 3.4 12.4 5.2 13.6 6.5 H18.4 C19.6 5.2 19.4 3.4 16 0.8 Z" fill="#ffd84a" stroke="${c.stroke}" stroke-width="1.2"/>`
    : `<rect x="12" y="3" width="8" height="3.5" rx="1.5" fill="${c.lid}" stroke="${c.stroke}" stroke-width="1.5"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">${top}
    <rect x="4.5" y="6.5" width="23" height="4" rx="2" fill="${c.lid}" stroke="${c.stroke}" stroke-width="1.5"/>
    <path d="M7 11.5 H25 L23.5 28 Q23.3 29.5 21.8 29.5 H10.2 Q8.7 29.5 8.5 28 Z" fill="${c.body}" stroke="${c.stroke}" stroke-width="1.5" stroke-linejoin="round"/>
    <path d="M12 14.5 L12.6 26.5 M16 14.5 V26.5 M20 14.5 L19.4 26.5" stroke="${c.stroke}" stroke-width="1.5" stroke-linecap="round" opacity=".55"/></svg>`;
}

/** Renders the bin SVG to raw RGBA, which is what the tray takes. */
async function binIcon(fire) {
  const img = new Image();
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(binSvg(fire));
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 32;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, 32, 32);
  const { data } = ctx.getImageData(0, 0, 32, 32);
  return TauriImage.new(new Uint8Array(data.buffer), 32, 32);
}

async function trayMenu() {
  return Menu.new({
    items: [
      await MenuItem.new({ text: shown ? `Hide ${character.def.name}` : `Show ${character.def.name}`, action: () => setShown(!shown) }),
      await sep(),
      ...(await sharedItems()),
    ],
  });
}

async function createTray() {
  const options = {
    icon: await binIcon(settings.permanent),
    tooltip: "Desktop Deleter",
    menu: await trayMenu(),
    showMenuOnLeftClick: false,
    action: (e) => {
      if (e.type === "Click" && e.button === "Left" && e.buttonState === "Up") setShown(!shown).catch(console.error);
    },
  };
  trayFire = settings.permanent;
  // A page reload (dev) shouldn't stack up a second tray icon.
  tray = (await TrayIcon.getById("main")) || (await TrayIcon.new({ id: "main", ...options }));
  await updateTray(true);
}

/** Rebuilds the tray menu (and icon, if the mode changed) so it matches the current settings. */
async function updateTray(forceIcon = false) {
  if (!tray) return;
  try {
    await tray.setMenu(await trayMenu());
    if (forceIcon || trayFire !== settings.permanent) {
      trayFire = settings.permanent;
      await tray.setIcon(await binIcon(settings.permanent));
    }
    await tray.setTooltip(`Desktop Deleter${settings.permanent ? " (permanent delete ON)" : ""}`);
  } catch (e) {
    console.error(e);
  }
}

function applyMode() {
  guyEl.classList.toggle("permanent", settings.permanent);
}

// ---------- window placement ----------

/** On top: floats above all windows. Off: lives on the desktop, behind windows (survives Win+D). */
async function setOnTop(onTop) {
  settings.onTop = onTop;
  saveSettings();
  await invoke("set_on_top", { onTop });
}

// ---------- start with Windows ----------

let autostart = false;

async function setAutostart(on) {
  await invoke(on ? "plugin:autostart|enable" : "plugin:autostart|disable");
  autostart = await invoke("plugin:autostart|is_enabled");
}

/** First run of an installed build: start with Windows by default (the user can untick it). */
async function initAutostart() {
  try {
    if (!settings.autostartSet && (await invoke("is_release"))) {
      await setAutostart(true);
      settings.autostartSet = true;
      saveSettings();
    }
    autostart = await invoke("plugin:autostart|is_enabled");
  } catch (e) {
    console.error(e);
  }
}

// ---------- size ----------

const SIZES = [50, 75, 100, 125, 150, 200];

/** Window size (logical px) for a given scale; at 100% this matches tauri.conf.json (240 x 230). */
const windowSizeFor = (scale) => ({
  width: Math.round(Math.max(200, 160 * scale + 80)), // never narrower than a speech bubble
  height: Math.round(160 * scale + 70), // sprite + room for the bubble above him
});

/** Scales him (and his window). With `anchor`, his feet stay where they were on screen. */
async function setScale(scale, anchor = true) {
  settings.scale = scale;
  saveSettings();
  guyEl.style.setProperty("--scale", scale);
  const before = anchor && { pos: await appWindow.outerPosition(), size: await appWindow.outerSize() };
  const { width, height } = windowSizeFor(scale);
  await appWindow.setSize(new LogicalSize(width, height));
  if (before) {
    const size = await appWindow.outerSize();
    const x = before.pos.x + Math.round((before.size.width - size.width) / 2);
    const y = before.pos.y + before.size.height - size.height;
    await setClampedPosition(x, y);
  }
}

async function moveToDefaultPosition() {
  const monitor = await currentMonitor();
  if (!monitor) return;
  const scale = monitor.scaleFactor;
  const area = monitor.workArea || {
    position: monitor.position,
    size: { width: monitor.size.width, height: monitor.size.height - 48 * scale },
  };
  const size = await appWindow.outerSize();
  const x = area.position.x + area.size.width - size.width - Math.round(24 * scale);
  const y = area.position.y + area.size.height - size.height;
  await appWindow.setPosition(new PhysicalPosition(x, y));
}

async function restorePosition() {
  const pos = settings.position;
  if (pos) {
    const monitors = await availableMonitors();
    const m = monitors.find(
      (m) =>
        pos.x >= m.position.x - 50 && pos.x < m.position.x + m.size.width - 50 &&
        pos.y >= m.position.y - 50 && pos.y < m.position.y + m.size.height - 50
    );
    if (m) {
      await setClampedPosition(pos.x, pos.y, m);
      return;
    }
  }
  await moveToDefaultPosition();
}

/** Moves the window to (x, y), nudged so all of it stays on the monitor. */
async function setClampedPosition(x, y, monitor) {
  const m = monitor || (await currentMonitor());
  const size = await appWindow.outerSize();
  if (m) {
    x = Math.min(Math.max(x, m.position.x), m.position.x + m.size.width - size.width);
    y = Math.min(Math.max(y, m.position.y), m.position.y + m.size.height - size.height);
  }
  await appWindow.setPosition(new PhysicalPosition(x, y));
}

// ---------- boot ----------

(async () => {
  characterIds = await loadJson("characters/index.json");
  const startId = characterIds.includes(settings.character) ? settings.character : characterIds[0];
  tummy = await invoke("tummy");
  await loadCharacter(startId);
  // Keep in sync with the bin if it's emptied/restored from Explorer.
  setInterval(() => { if (!busy) refreshTummy(); }, 4000);
  applyMode();
  await setOnTop(settings.onTop);
  await setScale(settings.scale, false);
  await restorePosition();
  await appWindow.show();
  await initAutostart();
  await createTray();
})().catch((e) => {
  console.error(e);
  appWindow.show();
});
