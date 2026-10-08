// Generates the "Binny" character pack: a trash can whose lid is his mouth and who
// visibly fills up with trash across 5 stages. Run: node tools/gen-bin.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL("../src/characters/binny/", import.meta.url));
mkdirSync(dir, { recursive: true });

// ---------- palette ----------
const INK = "#173b2e";
const STROKE = "#1d6b4f";
const LID = "#6fe0b4";
const LID_SHADE = "#49b98f"; // body colour around the eyes, used for eyelids

// ---------- stages: how high the trash pile pushes the lid, and how wonky it sits ----------
const STAGES = [
  { name: "empty", at: 0, h: 0, tilt: 0 },
  { name: "bit", at: 0.2, h: 8, tilt: 0 },
  { name: "half", at: 0.45, h: 18, tilt: -4 },
  { name: "full", at: 0.7, h: 30, tilt: 6 },
  { name: "overflow", at: 0.9, h: 42, tilt: -10 },
  // Permanent delete: no trash piles up -- he's an incinerator. Lid rides on the flames.
  { name: "permanent", h: 12, tilt: 0, fire: true },
];

// ---------- trash ----------
const paper = (cx, cy, r) => `<g><circle cx="${cx}" cy="${cy}" r="${r}" fill="#f6f5ef" stroke="#a9a89c" stroke-width="1.5"/>
    <path d="M${cx - r * 0.5} ${cy - r * 0.2} l${r * 0.4} ${r * 0.3} l${r * 0.3} ${-r * 0.5} M${cx - r * 0.2} ${cy + r * 0.45} l${r * 0.5} ${-r * 0.1}" fill="none" stroke="#b9b8ac" stroke-width="1.2" stroke-linecap="round"/></g>`;
const can = (x, y, rot) => `<g transform="rotate(${rot} ${x} ${y})"><rect x="${x - 5}" y="${y - 9}" width="10" height="18" rx="2" fill="#e5484d" stroke="#8f2228" stroke-width="1.5"/><rect x="${x - 5}" y="${y - 3}" width="10" height="5" fill="#fff" opacity=".8"/></g>`;
const bottle = (x, y, rot) => `<g transform="rotate(${rot} ${x} ${y})"><rect x="${x - 2.5}" y="${y - 14}" width="5" height="7" rx="1" fill="#7cc4f5" stroke="#2f6f9e" stroke-width="1.5"/><rect x="${x - 5}" y="${y - 8}" width="10" height="18" rx="3" fill="#7cc4f5" stroke="#2f6f9e" stroke-width="1.5"/></g>`;
const banana = `<path d="M114 58 q11 -4 15 6 q2 9 -3 15 q1 -9 -5 -13 q-4 -3 -7 -8z" fill="#ffd84a" stroke="#b08a10" stroke-width="1.5" stroke-linejoin="round"/>`;

// Pile items by the stage they first appear in; later stages keep everything before them.
const PILE = [
  [4, paper(78, 24, 9)], [4, can(54, 30, -30)], [4, paper(100, 22, 8)],
  [3, bottle(66, 36, -25)], [3, paper(92, 34, 9)], [3, paper(110, 42, 7)], [3, banana],
  [2, paper(80, 44, 10)], [2, can(104, 47, 20)], [2, paper(56, 50, 7)],
  [1, paper(66, 52, 8)], [1, paper(95, 53, 7)],
];
const pile = (s) => PILE.filter(([min]) => s >= min).map(([, svg]) => svg).join("\n    ");

const SPILL = `${paper(22, 148, 6)}${paper(138, 150, 5)}${can(146, 142, 80)}`;
const fly = (cls, x, y) => `<g class="fly ${cls}"><ellipse cx="${x - 3}" cy="${y - 4}" rx="4" ry="2.5" fill="#e8f4ff" stroke="#555" stroke-width=".8" transform="rotate(-25 ${x - 3} ${y - 4})"/><ellipse cx="${x + 3}" cy="${y - 4}" rx="4" ry="2.5" fill="#e8f4ff" stroke="#555" stroke-width=".8" transform="rotate(25 ${x + 3} ${y - 4})"/><ellipse cx="${x}" cy="${y}" rx="4.5" ry="3.5" fill="#262626"/></g>`;
const FLIES = fly("f1", 30, 4) + fly("f2", 132, -4);

// ---------- fire (permanent delete) ----------
const flame = (cls, d, fill) => `<path class="fl ${cls}" d="${d}" fill="${fill}"/>`;
const FLAMES = `<g class="flames">
    ${flame("fa", "M30 60 C22 46 30 34 26 18 C40 30 46 44 44 60 Z", "#ff6a1a")}
    ${flame("fb", "M116 60 C114 44 122 32 134 20 C132 36 140 46 130 60 Z", "#ff6a1a")}
    ${flame("fc", "M44 60 C36 40 50 26 52 4 C64 22 72 38 66 60 Z", "#ff7a1a")}
    ${flame("fa", "M92 60 C86 38 100 22 110 2 C116 24 124 40 116 60 Z", "#ff7a1a")}
    ${flame("fb", "M64 60 C58 36 72 18 80 -4 C90 18 100 36 96 60 Z", "#ff8c1a")}
    ${flame("fc", "M70 60 C66 44 76 32 80 20 C86 32 92 44 90 60 Z", "#ffd84a")}
    ${flame("fa", "M50 60 C46 50 52 42 54 34 C60 42 62 50 60 60 Z", "#ffd84a")}
    ${flame("fb", "M100 60 C98 50 104 42 108 34 C112 44 114 52 110 60 Z", "#ffd84a")}
  </g>`;
const BROWS = `<path d="M56 80 L75 86 M104 80 L85 86" stroke="#173b2e" stroke-width="4" stroke-linecap="round"/>`;
// Same drawing, recoloured red-hot.
const FIRE_COLORS = {
  "#1d6b4f": "#7a2208", "#6fe0b4": "#ff9d5c", "#49b98f": "#f07a3a",
  "#3fae85": "#d9541a", "#62d6a9": "#ff9a4d", "#2e9670": "#b33a0c",
};
const recolor = (svg) => svg.replace(/#[0-9a-f]{6}/gi, (c) => FIRE_COLORS[c.toLowerCase()] || c);

// ---------- body ----------
const DEFS = `<defs><linearGradient id="metal" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#3fae85"/><stop offset=".35" stop-color="#62d6a9"/><stop offset="1" stop-color="#2e9670"/></linearGradient></defs>`;
const BODY = `<ellipse cx="62" cy="149" rx="9" ry="5" fill="${STROKE}"/><ellipse cx="98" cy="149" rx="9" ry="5" fill="${STROKE}"/>
    <path d="M42 62 L118 62 L112 140 Q111 147 104 147 L56 147 Q49 147 48 140 Z" fill="url(#metal)" stroke="${STROKE}" stroke-width="3" stroke-linejoin="round"/>
    <path d="M53 74 L56 136 M107 74 L104 136" stroke="${STROKE}" stroke-width="3" stroke-linecap="round" opacity=".3"/>`;
const RIM = `<rect x="36" y="56" width="88" height="10" rx="5" fill="${LID}" stroke="${STROKE}" stroke-width="3"/>`;
const HOLE = `<ellipse cx="80" cy="59" rx="38" ry="4" fill="${INK}"/>`;
const LID_SHAPE = `<path d="M40 48 Q80 30 120 48 Z" fill="${LID}" stroke="${STROKE}" stroke-width="3" stroke-linejoin="round"/>
      <rect x="72" y="33" width="16" height="6" rx="3" fill="${LID}" stroke="${STROKE}" stroke-width="2.5"/>
      <rect x="34" y="46" width="92" height="10" rx="5" fill="${LID}" stroke="${STROKE}" stroke-width="3"/>`;
const lid = (st) => `<g transform="translate(0 ${-st.h}) rotate(${st.tilt} 80 51)"><g class="lid">
      ${LID_SHAPE}
    </g></g>`;

// ---------- face ----------
const eye = (cx, cy = 94) => `<g class="eye"><ellipse cx="${cx}" cy="${cy}" rx="9" ry="10" fill="#fff"/><circle cx="${cx + 1.5}" cy="${cy + 2}" r="4.5" fill="${INK}"/><circle cx="${cx + 3}" cy="${cy}" r="1.5" fill="#fff"/></g>`;
const bigEye = (cx, cy = 92) => `<ellipse cx="${cx}" cy="${cy}" rx="11" ry="12" fill="#fff"/><circle cx="${cx + 1}" cy="${cy - 2}" r="6" fill="${INK}"/><circle cx="${cx + 3}" cy="${cy - 5}" r="2.2" fill="#fff"/><circle cx="${cx - 1.5}" cy="${cy}" r="1.1" fill="#fff"/>`;
const happyEye = (cx, cy = 96) => `<path d="M${cx - 9} ${cy} Q${cx} ${cy - 11} ${cx + 9} ${cy}" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>`;
const sleepyEye = (cx, cy = 95) => `<ellipse cx="${cx}" cy="${cy}" rx="9" ry="9" fill="#fff"/><circle cx="${cx + 1}" cy="${cy + 3}" r="4.2" fill="${INK}"/>
    <path d="M${cx - 10} ${cy} A10 10 0 0 1 ${cx + 10} ${cy} Z" fill="${LID_SHADE}"/><path d="M${cx - 10} ${cy} L${cx + 10} ${cy}" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`;
const EYES = {
  normal: eye(66) + eye(94),
  big: bigEye(66) + bigEye(94),
  happy: happyEye(66) + happyEye(94),
  sleepy: sleepyEye(66) + sleepyEye(94),
  squeeze: `<path d="M59 88 L71 95 L59 102" fill="none" stroke="${INK}" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M101 88 L89 95 L101 102" fill="none" stroke="${INK}" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>`,
};
const MOUTHS = {
  smile: `<path d="M70 114 Q80 123 90 114" fill="none" stroke="${INK}" stroke-width="3.5" stroke-linecap="round"/>`,
  small: `<path d="M73 116 Q80 120 87 116" fill="none" stroke="${INK}" stroke-width="3.5" stroke-linecap="round"/>`,
  grin: `<path d="M66 112 Q80 132 94 112 Z" fill="${INK}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/><ellipse cx="80" cy="124" rx="7" ry="3.5" fill="#ff6f91"/>`,
  open: `<ellipse cx="80" cy="119" rx="13" ry="11" fill="${INK}"/><ellipse cx="80" cy="126" rx="8" ry="4" fill="#ff6f91"/>`,
  chew: `<ellipse class="chew" cx="80" cy="118" rx="10" ry="7" fill="${INK}"/>`,
  wavy: `<path d="M66 119 q3.5 -5 7 0 t7 0 t7 0 t7 0" fill="none" stroke="${INK}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>`,
  bleh: `<path d="M70 116 Q80 121 90 116" fill="none" stroke="${INK}" stroke-width="3.5" stroke-linecap="round"/><path d="M80 118 q0 9 5 9 q5 0 4 -8" fill="#ff6f91" stroke="${INK}" stroke-width="2"/>`,
};
const cheeks = (puffed, opacity) => puffed
  ? `<ellipse cx="54" cy="108" rx="9" ry="6" fill="#ff8fb1" opacity="${opacity}"/><ellipse cx="106" cy="108" rx="9" ry="6" fill="#ff8fb1" opacity="${opacity}"/>`
  : `<ellipse cx="55" cy="107" rx="6" ry="3.5" fill="#ff8fb1" opacity="${opacity}"/><ellipse cx="105" cy="107" rx="6" ry="3.5" fill="#ff8fb1" opacity="${opacity}"/>`;
const SWEAT = `<path class="sweat" d="M118 70 q-6 10 0 13 q6 -3 0 -13z" fill="#8fdcff"/>`;

// The idle face says how full he is.
const IDLE_FACE = [
  EYES.normal + MOUTHS.smile,
  EYES.normal + MOUTHS.smile + cheeks(false, 0.5),
  EYES.normal + MOUTHS.grin + cheeks(false, 0.7),
  EYES.sleepy + MOUTHS.small + cheeks(true, 0.7),
  EYES.sleepy + MOUTHS.bleh + cheeks(true, 0.8) + SWEAT,
];

// ---------- states ----------
const COMMON_CSS = `
    .eye { transform-box: fill-box; transform-origin: center; animation: blink 4.4s infinite; }
    .lid { transform-box: fill-box; transform-origin: 0% 100%; }
    .sweat { animation: sweat 1.4s ease-in infinite; }
    .fly { transform-box: fill-box; transform-origin: center; }
    .f1 { animation: buzz1 1.1s linear infinite; }
    .f2 { animation: buzz2 .9s linear infinite; }
    @keyframes blink { 0%, 92%, 100% { transform: scaleY(1); } 95% { transform: scaleY(.1); } }
    @keyframes sweat { 0% { transform: translateY(0); opacity: 0; } 20% { opacity: 1; } 100% { transform: translateY(12px); opacity: 0; } }
    @keyframes buzz1 { 0% { transform: translate(0,0); } 25% { transform: translate(9px,-5px); } 50% { transform: translate(2px,-10px); } 75% { transform: translate(-7px,-4px); } 100% { transform: translate(0,0); } }
    .fl { transform-box: fill-box; transform-origin: 50% 100%; }
    .fa { animation: flick .45s ease-in-out infinite alternate; }
    .fb { animation: flick .38s ease-in-out .1s infinite alternate-reverse; }
    .fc { animation: flick .52s ease-in-out .2s infinite alternate; }
    .ember { opacity: 0; }
    .e1 { animation: rise 1.1s ease-out infinite; }
    .e2 { animation: rise 1.1s ease-out .35s infinite; }
    .e3 { animation: rise 1.1s ease-out .7s infinite; }
    @keyframes flick { from { transform: scale(1, 1) skewX(0); } to { transform: scale(.92, 1.14) skewX(4deg); } }
    @keyframes rise { 0% { opacity: 1; transform: translateY(0); } 100% { opacity: 0; transform: translateY(-36px); } }
    @keyframes buzz2 { 0% { transform: translate(0,0); } 25% { transform: translate(-8px,4px); } 50% { transform: translate(-3px,9px); } 75% { transform: translate(6px,3px); } 100% { transform: translate(0,0); } }`;

function state(st, s, kind) {
  const fire = !!st.fire;
  // How far the lid can swing open before it leaves the picture.
  const open = s >= 3 && !fire ? 22 : 38;
  const css = {
    idle: `
    .g { animation: bob 2.6s ease-in-out infinite; }
    @keyframes bob { 50% { transform: translateY(-3px); } }`,
    hungry: `
    .g { animation: bounce .5s ease-in-out infinite; }
    .lid { animation: gape .5s ease-in-out infinite alternate; }
    @keyframes bounce { 50% { transform: translateY(-6px); } }
    @keyframes gape { from { transform: rotate(-${open - 8}deg); } to { transform: rotate(-${open}deg); } }`,
    eating: `
    .g { transform-box: fill-box; transform-origin: 50% 100%; animation: squash .3s ease-in-out infinite alternate; }
    .lid { animation: flap .3s ease-in-out infinite alternate; }
    .chew { transform-box: fill-box; transform-origin: center; animation: chew .3s ease-in-out infinite alternate; }
    .bit { opacity: 0; }
    .b1 { animation: fall .9s ease-in infinite; }
    .b2 { animation: fall .9s ease-in .3s infinite; }
    .b3 { animation: fall .9s ease-in .6s infinite; }
    @keyframes squash { from { transform: scale(1.03, .97); } to { transform: scale(.98, 1.02); } }
    @keyframes flap { from { transform: rotate(0); } to { transform: rotate(-${open}deg); } }
    @keyframes chew { from { transform: scaleY(1); } to { transform: scaleY(.2); } }
    @keyframes fall { 0% { opacity: 1; transform: translateY(-34px) rotate(0); } 85% { opacity: 1; } 100% { opacity: 0; transform: translateY(0) rotate(160deg); } }`,
    happy: `
    .g { transform-box: fill-box; transform-origin: 50% 100%; animation: hop .6s ease-in-out infinite; }
    .lid { animation: pop .6s ease-in-out infinite; }
    .heart { transform-box: fill-box; transform-origin: center; opacity: 0; }
    .h1 { animation: float 1.4s ease-out infinite; }
    .h2 { animation: float 1.4s ease-out .7s infinite; }
    @keyframes hop { 0%, 100% { transform: translateY(0) scale(1.03, .97); } 50% { transform: translateY(-10px) scale(.98, 1.02); } }
    @keyframes pop { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px) rotate(-6deg); } }
    @keyframes float { 0% { opacity: 0; transform: translateY(0) scale(.6); } 25% { opacity: 1; } 100% { opacity: 0; transform: translateY(-24px) scale(1); } }`,
    refuse: `
    .g { animation: shake .6s ease-in-out infinite; }
    @keyframes shake { 0%, 60%, 100% { transform: translateX(0); } 10%, 30%, 50% { transform: translateX(-5px); } 20%, 40% { transform: translateX(5px); } }`,
  }[kind];

  const face = {
    idle: fire ? EYES.normal + BROWS + MOUTHS.smile : IDLE_FACE[s],
    hungry: EYES.big + (fire ? BROWS : "") + MOUTHS.open + cheeks(false, 0.5),
    eating: EYES.happy + MOUTHS.chew + cheeks(s >= 3 && !fire, 0.7),
    happy: EYES.happy + MOUTHS.grin + cheeks(s >= 3 && !fire, 0.85),
    refuse: EYES.squeeze + MOUTHS.wavy + cheeks(false, 0.5) + SWEAT,
  }[kind];

  const lidOpen = kind === "hungry" || kind === "eating";
  const top = 56 - st.h; // where falling trash lands
  const extras = {
    eating: `<g fill="#f6f5ef" stroke="#a9a89c" stroke-width="1.2">
    <rect class="bit b1" x="70" y="${top - 4}" width="8" height="9" rx="1.5"/>
    <rect class="bit b2" x="84" y="${top - 6}" width="7" height="8" rx="1.5"/>
    <circle class="bit b3" cx="78" cy="${top - 2}" r="4"/>
  </g>${fire ? `
  <g fill="#ffb347"><circle class="ember e1" cx="66" cy="20" r="2.5"/><circle class="ember e2" cx="92" cy="14" r="2"/><circle class="ember e3" cx="80" cy="24" r="2.5"/></g>` : ""}`,
    happy: `<path class="heart h1" d="M18 40 c0 -6 8 -6 8 0 c0 -6 8 -6 8 0 c0 6 -8 10 -8 12 c0 -2 -8 -6 -8 -12z" fill="#ff5c8a"/>
  <path class="heart h2" d="M128 50 c0 -5 7 -5 7 0 c0 -5 7 -5 7 0 c0 5 -7 9 -7 11 c0 -2 -7 -6 -7 -11z" fill="#ff5c8a"/>`,
  }[kind] || "";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-12 -24 184 184" width="160" height="160">
  <style>${COMMON_CSS}${css}
  </style>
  ${DEFS}
  <ellipse cx="80" cy="153" rx="42" ry="5" fill="#000" opacity=".18"/>
  ${s === 4 ? SPILL : ""}
  <g class="g">
    ${BODY}
    ${RIM}
    ${lidOpen && s === 0 ? HOLE : ""}
    ${fire ? FLAMES : pile(s)}
    ${lid(st)}
    ${face}
  </g>
  ${extras}
  ${s === 4 ? FLIES : ""}
</svg>
`;
  return fire ? recolor(svg) : svg;
}

const KINDS = ["idle", "hungry", "eating", "happy", "refuse"];

STAGES.forEach((st, s) => {
  for (const kind of KINDS) writeFileSync(dir + `${st.name}-${kind}.svg`, state(st, s, kind));
});

writeFileSync(dir + "character.json", JSON.stringify({
  name: "Binny",
  author: "Desktop Deleter",
  sprites: "{level}-{state}.svg",
  timings: { eatingMs: 1400, happyMs: 1600, refuseMs: 2200, petMs: 1200 },
  lines: {
    hungry: ["Ooh, garbage!", "Feed me trash!", "*lid rattles*"],
    eat: ["*clang* Nom!", "Trash is treasure.", "Mmm, rubbish."],
    full: ["Getting a bit full...", "*creak*", "Can't... close... lid..."],
    permanentEat: ["*FWOOSH*", "Incinerated!", "Gone forever!"],
    refuse: ["Can't fit", "Nope, not eating"],
    pet: ["*happy rattle*", "Hehe!"],
    digestStart: ["Taking myself out..."],
    digest: ["Fresh and empty!", "Squeaky clean!"],
  },
}, null, 2) + "\n");

console.log(`wrote ${STAGES.length * KINDS.length} sprites to ${dir}`);
