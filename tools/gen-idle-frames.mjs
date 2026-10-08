// Generates blink and glance frames for still (PNG) characters by editing their eyes:
//   {level}-idle-blink.png       eyes closed
//   {level}-idle-look-left.png   pupils shifted left
//   {level}-idle-look-right.png  pupils shifted right
// Only eye pixels change, so the extra frames line up exactly with the idle sprite.
//
// Usage: node tools/gen-idle-frames.mjs [character-id ...]   (no ids = every configured one)
//
// Each character needs a short description of its eyes in EYES below: which colours make up the
// eye (the white/coloured part, not the pupil), where to look, and how many eyes there are.
// A sprite where that many eyes can't be found is skipped and reported, never half-edited.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const root = fileURLToPath(new URL("../src/characters/", import.meta.url));
const LEVELS = ["empty", "bit", "half", "full", "overflow", "permanent"];

const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
const sat = (r, g, b) => Math.max(r, g, b) - Math.min(r, g, b);

/**
 * eye(r, g, b): is this pixel part of an eye's white/coloured area?
 * roi: [x0, y0, x1, y1] area to search (in the 160 px sprite), count: eyes expected,
 * minArea: smallest eye in pixels, shift: how far pupils move when glancing.
 * Optional: skip: true leaves a level out; skin / line ("#rrggbb") force the closed-lid and lash colours (e.g. for a black cat,
 * whose fur is as dark as an outline); levels: { <level>: { ...overrides } } for one level.
 */
const EYES = {
  pou: {
    eye: (r, g, b) => lum(r, g, b) > 165 && sat(r, g, b) < 30,
    roi: [40, 50, 150, 125],
    count: 2,
    minArea: 60,
    shift: 4,
    // Permanent mode has glowing orange eyes; the orange meter on the left stays out of the area.
    levels: { permanent: { eye: (r, g, b) => r > 200 && g < 120 && b < 40, roi: [45, 55, 150, 125], skin: "#3b3b3b" } },
  },
  nullcat: {
    eye: (r, g, b) => g > 140 && g > r + 40 && g > b + 20,
    roi: [60, 45, 145, 95],
    count: 2,
    minArea: 25,
    shift: 3,
    skin: "#090909",
    line: "#3f0f6c",
    levels: { permanent: { eye: (r, g, b) => r > 190 && b > 90 && g < 90 } }, // magenta eyes
  },
  "yarn-cat": {
    eye: (r, g, b) => g > 50 && g > r + 30 && g > b + 30,
    roi: [80, 85, 148, 118],
    count: 2,
    minArea: 15,
    shift: 3,
    // bit/full have near-black eyes that can't be told from the outline, and overflow/permanent
    // eyes are too small and uneven to edit cleanly, so those levels are skipped.
    levels: { overflow: { skip: true }, permanent: { skip: true } },
  },
  cinder: {
    eye: (r, g, b) => r > 200 && g > 120 && g < 185 && b < 60,
    roi: [50, 45, 135, 85],
    count: 2,
    minArea: 20,
    shift: 3,
    levels: { permanent: { skin: "#494847" } }, // grey scales; the tan muzzle isn't lid colour
  },
  plankton: {
    // One big eye: pale yellow white with a red iris.
    eye: (r, g, b) => r > 220 && g > 200 && b < 170,
    roi: [40, 65, 90, 112],
    count: 1,
    minArea: 40,
    shift: 3,
  },
  munchest: {
    eye: (r, g, b) => r > 200 && g > 170 && b < 110,
    roi: [30, 30, 150, 100],
    count: 2,
    minArea: 40,
    shift: 3,
  },
};

function generate(id, cfg) {
  const def = JSON.parse(readFileSync(`${root}${id}/character.json`, "utf8"));
  const pattern = def.sprites || "{level}-{state}.png";
  const name = (level, state) => pattern.replace("{level}", level).replace("{state}", state);
  const results = [];
  for (const level of LEVELS) {
    const src = `${root}${id}/${name(level, "idle")}`;
    if (!existsSync(src)) continue;
    const img = PNG.sync.read(readFileSync(src));
    const levelCfg = { ...cfg, ...cfg.levels?.[level] };
    if (levelCfg.skip) {
      results.push(`${level}: left out on purpose`);
      continue;
    }
    const frames = makeFrames(img, levelCfg);
    if (typeof frames === "string") {
      results.push(`${level}: skipped (${frames})`);
      continue;
    }
    for (const [suffix, data] of Object.entries(frames)) {
      const out = new PNG({ width: img.width, height: img.height });
      data.copy(out.data);
      writeFileSync(`${root}${id}/${name(level, `idle-${suffix}`)}`, PNG.sync.write(out));
    }
    results.push(`${level}: ok`);
  }
  console.log(`${id}\n  ${results.join("\n  ")}`);
}

/** Returns { blink, "look-left", "look-right" } pixel buffers, or a reason string. */
function makeFrames(img, cfg) {
  const { width: W, height: H, data } = img;
  const at = (x, y) => (y * W + x) * 4;
  const rgba = (x, y) => [...data.subarray(at(x, y), at(x, y) + 4)];
  const opaque = (x, y) => data[at(x, y) + 3] > 0;
  const isEye = (x, y) => opaque(x, y) && cfg.eye(...rgba(x, y));
  const dark = (x, y) => opaque(x, y) && lum(...rgba(x, y)) < 80;
  const grey = (x, y) => opaque(x, y) && sat(...rgba(x, y)) < 40 && lum(...rgba(x, y)) < 200;
  const outline = (x, y) => dark(x, y) || (grey(x, y) && !isEye(x, y));
  const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H;

  // 1. Eye areas: connected blobs of eye colour inside the search area.
  const [x0, y0, x1, y1] = cfg.roi;
  const seen = new Uint8Array(W * H);
  const blobs = [];
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      if (seen[y * W + x] || !isEye(x, y)) continue;
      const blob = [], stack = [[x, y]];
      seen[y * W + x] = 1;
      while (stack.length) {
        const [cx, cy] = stack.pop();
        blob.push([cx, cy]);
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const nx = cx + dx, ny = cy + dy;
            if (nx < x0 || ny < y0 || nx > x1 || ny > y1 || seen[ny * W + nx] || !isEye(nx, ny)) continue;
            seen[ny * W + nx] = 1;
            stack.push([nx, ny]);
          }
      }
      if (blob.length >= cfg.minArea) blobs.push(blob);
    }
  if (blobs.length < cfg.count) return `found ${blobs.length} eye(s), expected ${cfg.count}`;
  const eyes = blobs.sort((a, b) => b.length - a.length).slice(0, cfg.count);

  const blink = Buffer.from(data), left = Buffer.from(data), right = Buffer.from(data);
  const put = (buf, x, y, c) => { if (inside(x, y)) c.forEach((v, k) => (buf[at(x, y) + k] = v)); };
  const mode = (list) => {
    const m = new Map();
    for (const c of list) { const k = c.join(); m.set(k, (m.get(k) || 0) + 1); }
    return [...m].sort((a, b) => b[1] - a[1])[0]?.[0].split(",").map(Number);
  };

  for (const blob of eyes) {
    // 2. The whole eye: its coloured area plus everything enclosed by it (pupil, shine).
    const set = new Set(blob.map(([x, y]) => y * W + x));
    const xs = blob.map((p) => p[0]), ys = blob.map((p) => p[1]);
    const bx0 = Math.min(...xs), bx1 = Math.max(...xs), by0 = Math.min(...ys), by1 = Math.max(...ys);
    const rowSpan = new Map(), colSpan = new Map();
    for (const [x, y] of blob) {
      const r = rowSpan.get(y) || [x, x]; rowSpan.set(y, [Math.min(r[0], x), Math.max(r[1], x)]);
      const c = colSpan.get(x) || [y, y]; colSpan.set(x, [Math.min(c[0], y), Math.max(c[1], y)]);
    }
    const enclosed = (x, y) => {
      const r = rowSpan.get(y), c = colSpan.get(x);
      return (r && x >= r[0] && x <= r[1]) || (c && y >= c[0] && y <= c[1]);
    };
    const mask = [];
    for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) if (set.has(y * W + x) || enclosed(x, y)) mask.push([x, y]);
    // Pupil/iris: whatever sits inside the eye's white/coloured area.
    const pupil = mask.filter(([x, y]) => !set.has(y * W + x) && opaque(x, y));

    // 3. Its outline and shading: dark or grey pixels just outside the eye (not bright white,
    //    so teeth or highlights next to an eye survive).
    const near = (x, y, d) => {
      for (let dy = -d; dy <= d; dy++) for (let dx = -d; dx <= d; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= bx0 && nx <= bx1 && ny >= by0 && ny <= by1 && (set.has(ny * W + nx) || enclosed(nx, ny))) return true;
      }
      return false;
    };
    const ring = [];
    for (let y = by0 - 4; y <= by1 + 4; y++)
      for (let x = bx0 - 4; x <= bx1 + 4; x++)
        if (inside(x, y) && outline(x, y) && !enclosed(x, y) && !set.has(y * W + x) && near(x, y, 4)) ring.push([x, y]);

    // 4. Skin colour for the closed lid, taken from just above the eye (where a lid comes down
    //    from), falling back to all around it; and the outline colour for the lash line.
    const sample = (ya, yb) => {
      const out = [];
      for (let y = ya; y <= yb; y++)
        for (let x = bx0 - 9; x <= bx1 + 9; x++)
          if (inside(x, y) && opaque(x, y) && !isEye(x, y) && !outline(x, y) && !near(x, y, 4)) out.push(rgba(x, y));
      return out;
    };
    const hex = (h) => h && [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).concat(255);
    const skin = hex(cfg.skin) || mode(sample(by0 - 10, by0 - 1)) || mode(sample(by0 - 10, by1 + 10));
    const line = hex(cfg.line) || mode(ring.map(([x, y]) => rgba(x, y))) || mode(pupil.map(([x, y]) => rgba(x, y)));
    if (!skin || !line) return "couldn't tell the eye from its surroundings";

    // Edge pixels: anything right next to the eye that isn't lid colour or bright white
    // (anti-aliased rims, darker amber edges), so no specks of the open eye are left behind.
    const dist = (a, b) => Math.max(...[0, 1, 2].map((k) => Math.abs(a[k] - b[k])));
    const edge = [];
    for (let y = by0 - 2; y <= by1 + 2; y++)
      for (let x = bx0 - 2; x <= bx1 + 2; x++) {
        if (!inside(x, y) || !opaque(x, y) || enclosed(x, y) || set.has(y * W + x) || !near(x, y, 2)) continue;
        const c = rgba(x, y);
        if (dist(c, skin) > 50 && !(lum(...c) > 225 && sat(...c) < 35)) edge.push([x, y]);
      }

    // Blink: paint the eye, its outline and edges over with skin, then a closed-eye line.
    for (const [x, y] of [...mask, ...ring, ...edge]) put(blink, x, y, skin);
    const ly = Math.round(by0 + (by1 - by0) * 0.6);
    for (let x = bx0; x <= bx1; x++) for (let t = -1; t <= 1; t++) put(blink, x, ly + t, line);

    // Glances: move the pupil sideways, staying inside the eye.
    const white = mode(blob.map(([x, y]) => rgba(x, y)));
    const inEye = new Set(mask.map(([x, y]) => y * W + x));
    for (const [buf, dx] of [[left, -cfg.shift], [right, cfg.shift]]) {
      for (const [x, y] of pupil) put(buf, x, y, white);
      for (const [x, y] of pupil) if (inEye.has(y * W + x + dx)) put(buf, x + dx, y, rgba(x, y));
    }
  }
  return { blink, "look-left": left, "look-right": right };
}

const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(EYES);
for (const id of ids) {
  if (!EYES[id]) console.log(`${id}\n  skipped (no eye description in EYES)`);
  else generate(id, EYES[id]);
}
