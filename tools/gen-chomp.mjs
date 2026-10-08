// Generates the "Chomp" character pack: a blob with a see-through belly that fills up
// with eaten paper, plus a devil/fire look for permanent delete. Run: node tools/gen-chomp.mjs
import { writeFileSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL("../src/characters/chomp/", import.meta.url));
mkdirSync(dir, { recursive: true });
for (const f of readdirSync(dir)) if (f.endsWith(".svg")) unlinkSync(dir + f);

const INK = "#1d1033";
const MOUTH = "#2a1650";

// Body size grows with each level (drawn, not stretched); `papers` = how many are in his belly.
const LEVELS = [
  { name: "empty", rx: 54, ry: 51, papers: 0 },
  { name: "bit", rx: 58, ry: 52, papers: 2 },
  { name: "half", rx: 62, ry: 54, papers: 6 },
  { name: "full", rx: 67, ry: 56, papers: 10 },
  { name: "overflow", rx: 71, ry: 58, papers: 14 },
  { name: "permanent", rx: 56, ry: 52, papers: 0, devil: true },
];

const SKIN = {
  normal: { light: "#b19bff", dark: "#6a4be0", stroke: "#4b31a8", lid: "#9580f5" },
  devil: { light: "#ff9a8a", dark: "#c42f45", stroke: "#7a1426", lid: "#e8606a" },
};

// Belly slots in normalised belly coords, filled bottom-up.
const SLOTS = [
  [-0.45, 0.55, 15], [0.3, 0.6, -20], [-0.05, 0.45, 40], [0.62, 0.3, 10], [-0.68, 0.25, -35],
  [0.12, 0.15, -10], [-0.32, 0.1, 25], [0.42, -0.05, -40], [-0.6, -0.15, 5], [0.0, -0.2, 30],
  [0.3, -0.38, -15], [-0.3, -0.4, 20], [0.62, -0.32, 45], [0.0, -0.6, -25],
];

function draw(L, kind) {
  const skin = L.devil ? SKIN.devil : SKIN.normal;
  const cy = 142 - L.ry; // keep his feet on the ground as he grows
  const y = (dy) => cy + dy;
  const lvl = LEVELS.indexOf(L);
  const stuffed = !L.devil && lvl >= 3;

  // ---- body ----
  const bx = 80, by = y(L.ry * 0.58), bw = L.rx * 0.5, bh = L.ry * 0.33; // belly window
  // Little file icons (folded corner + text lines) in assorted colours.
  const FILE_COLORS = ["#ffffff", "#cfe8ff", "#fff3a8", "#ffd6e0", "#d8f5d0"];
  const papers = SLOTS.slice(0, L.papers).map(([nx, ny, rot], i) => {
    const px = bx + nx * bw, py = by + ny * bh;
    const x = px - 4.5, t = py - 5.5;
    return `<g transform="rotate(${rot} ${px} ${py})"><path d="M${x} ${t} h6 l3 3 v8 h-9 z" fill="${FILE_COLORS[i % FILE_COLORS.length]}" stroke="#7d7a99" stroke-width="1"/><path d="M${x + 6} ${t} v3 h3" fill="none" stroke="#7d7a99" stroke-width="1"/><path d="M${x + 2} ${t + 5} h5 M${x + 2} ${t + 7.5} h5" stroke="#9a97b5" stroke-width=".9"/></g>`;
  }).join("");
  const bellyFire = L.devil ? `<g class="bf">
      <path class="fl fa" d="M${bx - 22} ${by + bh} C${bx - 26} ${by} ${bx - 14} ${by - 4} ${bx - 12} ${by - bh}  C${bx - 4} ${by - 2} ${bx - 2} ${by + 6} ${bx - 4} ${by + bh} Z" fill="#ff7a1a"/>
      <path class="fl fb" d="M${bx - 8} ${by + bh} C${bx - 12} ${by - 2} ${bx} ${by - 6} ${bx + 2} ${by - bh - 2} C${bx + 10} ${by - 4} ${bx + 14} ${by + 4} ${bx + 10} ${by + bh} Z" fill="#ffb21a"/>
      <path class="fl fc" d="M${bx + 6} ${by + bh} C${bx + 4} ${by + 2} ${bx + 14} ${by - 2} ${bx + 18} ${by - bh + 4} C${bx + 24} ${by} ${bx + 26} ${by + 6} ${bx + 22} ${by + bh} Z" fill="#ff7a1a"/>
      <path class="fl fa" d="M${bx - 6} ${by + bh} C${bx - 6} ${by + 6} ${bx} ${by + 2} ${bx + 2} ${by - 4} C${bx + 6} ${by + 4} ${bx + 8} ${by + 8} ${bx + 6} ${by + bh} Z" fill="#ffe14a"/>
    </g>` : "";
  const belly = `<clipPath id="belly"><ellipse cx="${bx}" cy="${by}" rx="${bw}" ry="${bh}"/></clipPath>
    <ellipse cx="${bx}" cy="${by}" rx="${bw}" ry="${bh}" fill="${L.devil ? "#5a0f1c" : "#3d2a8a"}" opacity="${L.devil ? 0.85 : 0.35}"/>
    <g clip-path="url(#belly)"><g class="gurgle">${papers}${bellyFire}</g></g>
    <ellipse cx="${bx}" cy="${by}" rx="${bw}" ry="${bh}" fill="none" stroke="${skin.stroke}" stroke-width="2" opacity=".45"/>
    <ellipse cx="${bx - bw * 0.45}" cy="${by - bh * 0.45}" rx="${bw * 0.22}" ry="${bh * 0.18}" fill="#fff" opacity=".35" transform="rotate(-20 ${bx - bw * 0.45} ${by - bh * 0.45})"/>`;

  const horns = L.devil
    ? `<path d="M${80 - L.rx * 0.5} ${y(-L.ry * 0.72)} q-6 -16 -16 -22 q14 2 24 14 z" fill="#3a0d16" stroke="#3a0d16" stroke-width="2" stroke-linejoin="round"/>
    <path d="M${80 + L.rx * 0.5} ${y(-L.ry * 0.72)} q6 -16 16 -22 q-14 2 -24 14 z" fill="#3a0d16" stroke="#3a0d16" stroke-width="2" stroke-linejoin="round"/>`
    : `<path d="M78 ${y(-L.ry + 2)} C 72 ${y(-L.ry - 12)}, 86 ${y(-L.ry - 20)}, 92 ${y(-L.ry - 10)}" fill="none" stroke="${skin.stroke}" stroke-width="4" stroke-linecap="round"/>`;

  const body = `<ellipse cx="${80 - L.rx * 0.43}" cy="140" rx="13" ry="8" fill="${skin.stroke}"/><ellipse cx="${80 + L.rx * 0.43}" cy="140" rx="13" ry="8" fill="${skin.stroke}"/>
    ${horns}
    <ellipse cx="80" cy="${cy}" rx="${L.rx}" ry="${L.ry}" fill="url(#skin)" stroke="${skin.stroke}" stroke-width="3"/>
    <ellipse cx="${80 - L.rx * 0.42}" cy="${y(-L.ry * 0.6)}" rx="14" ry="7" fill="#fff" opacity=".28" transform="rotate(-28 ${80 - L.rx * 0.42} ${y(-L.ry * 0.6)})"/>
    ${belly}`;

  // ---- face ----
  const ey = y(-24), ex = [60, 100];
  const eye = (x) => `<g class="eye"><ellipse cx="${x}" cy="${ey}" rx="12" ry="13" fill="#fff"/><circle cx="${x + 2}" cy="${ey + 3}" r="6" fill="${INK}"/><circle cx="${x + 4.5}" cy="${ey}" r="2" fill="#fff"/></g>`;
  const bigEye = (x) => `<ellipse cx="${x}" cy="${ey - 2}" rx="14" ry="15" fill="#fff"/><circle cx="${x + 1}" cy="${ey - 6}" r="8" fill="${INK}"/><circle cx="${x + 4}" cy="${ey - 9}" r="3" fill="#fff"/><circle cx="${x - 2}" cy="${ey - 3}" r="1.5" fill="#fff"/>`;
  const happyEye = (x) => `<path d="M${x - 11} ${ey + 4} Q${x} ${ey - 10} ${x + 11} ${ey + 4}" fill="none" stroke="${INK}" stroke-width="4.5" stroke-linecap="round"/>`;
  const sleepyEye = (x) => `<ellipse cx="${x}" cy="${ey + 1}" rx="12" ry="11" fill="#fff"/><circle cx="${x + 1}" cy="${ey + 5}" r="5.5" fill="${INK}"/>
    <path d="M${x - 13} ${ey + 1} A13 13 0 0 1 ${x + 13} ${ey + 1} Z" fill="${skin.lid}"/><path d="M${x - 13} ${ey + 1} L${x + 13} ${ey + 1}" stroke="${INK}" stroke-width="3.5" stroke-linecap="round"/>`;
  const squeeze = `<path d="M51 ${ey - 9} L68 ${ey} L51 ${ey + 9}" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><path d="M109 ${ey - 9} L92 ${ey} L109 ${ey + 9}" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`;
  const brows = `<path d="M47 ${ey - 17} L70 ${ey - 9} M113 ${ey - 17} L90 ${ey - 9}" stroke="${INK}" stroke-width="4.5" stroke-linecap="round"/>`;
  const EYES = {
    normal: eye(ex[0]) + eye(ex[1]),
    big: bigEye(ex[0]) + bigEye(ex[1]),
    happy: happyEye(ex[0]) + happyEye(ex[1]),
    sleepy: sleepyEye(ex[0]) + sleepyEye(ex[1]),
    squeeze,
  };

  const my = y(-1);
  const MOUTHS = {
    smile: `<path d="M68 ${my} Q80 ${my + 11} 92 ${my}" fill="none" stroke="${MOUTH}" stroke-width="4" stroke-linecap="round"/>`,
    small: `<path d="M72 ${my + 2} Q80 ${my + 7} 88 ${my + 2}" fill="none" stroke="${MOUTH}" stroke-width="4" stroke-linecap="round"/>`,
    smirk: `<path d="M70 ${my + 4} Q84 ${my + 10} 94 ${my - 2}" fill="none" stroke="${MOUTH}" stroke-width="4" stroke-linecap="round"/>`,
    grin: `<path d="M64 ${my - 2} Q80 ${my + 20} 96 ${my - 2} Z" fill="${MOUTH}" stroke="${MOUTH}" stroke-width="3" stroke-linejoin="round"/><ellipse cx="80" cy="${my + 9}" rx="9" ry="4" fill="#ff6f91"/>`,
    gape: `<g class="gape"><ellipse cx="80" cy="${my + 6}" rx="24" ry="17" fill="${MOUTH}"/><ellipse cx="80" cy="${my + 16}" rx="14" ry="6" fill="#ff6f91"/>
      <rect x="68" y="${my - 11}" width="9" height="8" rx="2" fill="#fff"/><rect x="83" y="${my - 11}" width="9" height="8" rx="2" fill="#fff"/></g>`,
    chomp: `<ellipse class="chomp" cx="80" cy="${my + 4}" rx="20" ry="12" fill="${MOUTH}"/>`,
    wavy: `<path d="M60 ${my + 4} q5 -7 10 0 t10 0 t10 0 t10 0" fill="none" stroke="${MOUTH}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`,
    bleh: `<path d="M68 ${my + 2} Q80 ${my + 8} 92 ${my + 2}" fill="none" stroke="${MOUTH}" stroke-width="4" stroke-linecap="round"/><path d="M80 ${my + 5} q0 10 6 10 q6 0 5 -9" fill="#ff6f91" stroke="${MOUTH}" stroke-width="2"/>
      <rect x="88" y="${my - 6}" width="12" height="14" rx="1.5" fill="#fff" stroke="#9a9ab0" stroke-width="1" transform="rotate(25 94 ${my})"/>`,
  };
  const cx1 = 80 - L.rx + 20, cx2 = 80 + L.rx - 20;
  const cheeks = (size, o) => `<ellipse cx="${cx1}" cy="${y(-6)}" rx="${size}" ry="${size * 0.55}" fill="#ff8fb1" opacity="${o}"/><ellipse cx="${cx2}" cy="${y(-6)}" rx="${size}" ry="${size * 0.55}" fill="#ff8fb1" opacity="${o}"/>`;
  const sweat = `<path class="sweat" d="M${80 + L.rx - 8} ${y(-L.ry * 0.7)} q-7 11 0 15 q7 -4 0 -15z" fill="#8fdcff"/>`;
  const drool = `<path class="drool" d="M101 ${my + 12} q-4 7 0 9 q4 -2 0 -9z" fill="#8fdcff"/>`;

  const IDLE = [
    EYES.normal + MOUTHS.smile + cheeks(9, 0.45),
    EYES.normal + MOUTHS.smile + cheeks(9, 0.55),
    EYES.normal + MOUTHS.grin + cheeks(10, 0.7),
    EYES.sleepy + MOUTHS.small + cheeks(12, 0.75),
    EYES.sleepy + MOUTHS.bleh + cheeks(13, 0.8) + sweat,
    EYES.normal + brows + MOUTHS.smirk + cheeks(9, 0.4),
  ];
  const face = {
    idle: IDLE[lvl],
    hungry: EYES.big + (L.devil ? brows : "") + MOUTHS.gape + cheeks(9, 0.55) + drool,
    eating: EYES.happy + MOUTHS.chomp + cheeks(stuffed ? 14 : 12, 0.7),
    happy: EYES.happy + MOUTHS.grin + cheeks(stuffed ? 13 : 11, 0.8),
    refuse: squeeze + MOUTHS.wavy + cheeks(9, 0.55) + sweat,
  }[kind];

  // ---- extras outside the body ----
  const mouthY = my + 4;
  const extras = {
    eating: L.devil
      // Permanent: whatever he eats goes up in smoke.
      ? `<g fill="#9a8f99" opacity=".9">
    <circle class="puff p1" cx="74" cy="${mouthY}" r="6"/><circle class="puff p2" cx="86" cy="${mouthY}" r="5"/><circle class="puff p3" cx="80" cy="${mouthY}" r="7"/></g>
  <g fill="#ffb347"><circle class="puff p2" cx="70" cy="${mouthY}" r="2"/><circle class="puff p3" cx="92" cy="${mouthY}" r="2"/></g>`
      : `<g fill="#fff" stroke="#9a9ab0" stroke-width="1">
    <rect class="bit b1" x="74" y="${mouthY - 6}" width="9" height="11" rx="1"/>
    <rect class="bit b2" x="78" y="${mouthY - 6}" width="8" height="10" rx="1"/>
    <rect class="bit b3" x="72" y="${mouthY - 2}" width="7" height="9" rx="1"/>
    <rect class="bit b4" x="80" y="${mouthY - 2}" width="9" height="8" rx="1"/></g>`,
    happy: `<path class="heart h1" d="M18 40 c0 -6 8 -6 8 0 c0 -6 8 -6 8 0 c0 6 -8 10 -8 12 c0 -2 -8 -6 -8 -12z" fill="${L.devil ? "#ff7a1a" : "#ff5c8a"}"/>
  <path class="heart h2" d="M124 34 c0 -5 7 -5 7 0 c0 -5 7 -5 7 0 c0 5 -7 9 -7 11 c0 -2 -7 -6 -7 -11z" fill="${L.devil ? "#ff7a1a" : "#ff5c8a"}"/>`,
  }[kind] || "";

  // ---- animation ----
  const groundY = 146;
  const css = {
    idle: stuffed
      ? `.g { transform-origin: 80px ${groundY}px; animation: breathe 3.2s ease-in-out infinite; }
    .hic { animation: hic 6s ease-out infinite; }`
      : `.g { animation: bob 2.4s ease-in-out infinite; }`,
    hungry: `.g { animation: bounce .5s ease-in-out infinite; }
    .gape { transform-box: fill-box; transform-origin: top center; animation: gape .5s ease-in-out infinite; }
    .drool { animation: drool 1.2s ease-in infinite; }`,
    eating: `.g { transform-origin: 80px ${groundY}px; animation: chew .28s ease-in-out infinite alternate; }
    .chomp { transform-box: fill-box; transform-origin: center; animation: chomp .28s ease-in-out infinite alternate; }
    .gurgle { animation: gurgle .28s ease-in-out infinite alternate; }
    .bit, .puff { transform-box: fill-box; transform-origin: center; opacity: 0; }
    .b1 { animation: b1 .9s ease-out infinite; } .b2 { animation: b2 .9s ease-out .22s infinite; }
    .b3 { animation: b3 .9s ease-out .45s infinite; } .b4 { animation: b4 .9s ease-out .67s infinite; }
    .p1 { animation: smoke 1.2s ease-out infinite; } .p2 { animation: smoke 1.2s ease-out .4s infinite; } .p3 { animation: smoke 1.2s ease-out .8s infinite; }`,
    happy: `.g { transform-origin: 80px ${groundY}px; animation: hop .6s ease-in-out infinite; }
    .heart { transform-box: fill-box; transform-origin: center; opacity: 0; }
    .h1 { animation: float 1.4s ease-out infinite; } .h2 { animation: float 1.4s ease-out .7s infinite; }`,
    refuse: `.g { animation: shake .6s ease-in-out infinite; }`,
  }[kind];

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-6 -10 172 172" width="160" height="160">
  <style>
    ${css}
    .eye { transform-box: fill-box; transform-origin: center; animation: blink 4.2s infinite; }
    .sweat { animation: sweat 1.2s ease-in infinite; }
    .fl { transform-box: fill-box; transform-origin: 50% 100%; }
    .fa { animation: flick .45s ease-in-out infinite alternate; }
    .fb { animation: flick .38s ease-in-out .1s infinite alternate-reverse; }
    .fc { animation: flick .52s ease-in-out .2s infinite alternate; }
    @keyframes blink { 0%, 92%, 100% { transform: scaleY(1); } 95% { transform: scaleY(.1); } }
    @keyframes bob { 50% { transform: translateY(-4px); } }
    @keyframes breathe { 50% { transform: scale(1.025, .98); } }
    @keyframes hic { 0%, 88%, 100% { transform: translateY(0); } 91% { transform: translateY(-9px); } 94% { transform: translateY(0); } }
    @keyframes bounce { 50% { transform: translateY(-7px); } }
    @keyframes gape { 50% { transform: scaleY(1.1); } }
    @keyframes drool { 0% { transform: translateY(0); opacity: 0; } 20% { opacity: 1; } 100% { transform: translateY(16px); opacity: 0; } }
    @keyframes chew { from { transform: scale(1.04, .96); } to { transform: scale(.98, 1.03); } }
    @keyframes chomp { from { transform: scaleY(1); } to { transform: scaleY(.12); } }
    @keyframes gurgle { from { transform: translateY(0); } to { transform: translateY(-2px); } }
    @keyframes b1 { 0% { opacity: 1; transform: translate(0,0) rotate(0); } 100% { opacity: 0; transform: translate(-48px,-30px) rotate(-200deg); } }
    @keyframes b2 { 0% { opacity: 1; transform: translate(0,0) rotate(0); } 100% { opacity: 0; transform: translate(46px,-36px) rotate(220deg); } }
    @keyframes b3 { 0% { opacity: 1; transform: translate(0,0) rotate(0); } 100% { opacity: 0; transform: translate(-36px,22px) rotate(-160deg); } }
    @keyframes b4 { 0% { opacity: 1; transform: translate(0,0) rotate(0); } 100% { opacity: 0; transform: translate(40px,18px) rotate(180deg); } }
    @keyframes smoke { 0% { opacity: .9; transform: translate(0,0) scale(.6); } 100% { opacity: 0; transform: translate(0,-50px) scale(1.6); } }
    @keyframes hop { 0%, 100% { transform: translateY(0) scale(1.03, .97); } 50% { transform: translateY(-12px) scale(.98, 1.02); } }
    @keyframes float { 0% { opacity: 0; transform: translateY(0) scale(.6); } 25% { opacity: 1; } 100% { opacity: 0; transform: translateY(-26px) scale(1); } }
    @keyframes shake { 0%, 60%, 100% { transform: translateX(0); } 10%, 30%, 50% { transform: translateX(-5px); } 20%, 40% { transform: translateX(5px); } }
    @keyframes sweat { 0% { transform: translateY(0); opacity: 0; } 20% { opacity: 1; } 100% { transform: translateY(14px); opacity: 0; } }
    @keyframes flick { from { transform: scale(1, 1) skewX(0); } to { transform: scale(.92, 1.14) skewX(4deg); } }
  </style>
  <defs><radialGradient id="skin" cx="38%" cy="32%" r="75%"><stop offset="0" stop-color="${skin.light}"/><stop offset="1" stop-color="${skin.dark}"/></radialGradient></defs>
  <ellipse cx="80" cy="150" rx="${L.rx * 0.75}" ry="6" fill="#000" opacity=".18"/>
  <g class="hic"><g class="g">
    ${body}
    ${face}
  </g></g>
  ${extras}
</svg>
`;
}

const STATES = ["idle", "hungry", "eating", "happy", "refuse"];
for (const L of LEVELS) for (const s of STATES) writeFileSync(dir + `${L.name}-${s}.svg`, draw(L, s));

writeFileSync(dir + "character.json", JSON.stringify({
  name: "Chomp",
  author: "Desktop Deleter",
  sprites: "{level}-{state}.svg",
  timings: { eatingMs: 1400, happyMs: 1600, refuseMs: 2200, petMs: 1200 },
  lines: {
    hungry: ["Ooh, gimme!", "Is that for me?", "*drools*"],
    eat: ["Nom nom nom!", "Delicious!", "*burp*", "Mmm, crunchy bytes.", "That's {total} files eaten!"],
    full: ["Urp... so full.", "One more... maybe.", "*loosens belt*"],
    permanentEat: ["*FWOOSH*", "Gone. Forever.", "Mwahaha!"],
    refuse: ["Bleh! I can't eat", "Nope, not eating"],
    pet: ["Hehe!", "That tickles!", "<3"],
    digestStart: ["Hrrngh..."],
    digest: ["Ahh, much better!", "Room for more!"],
  },
}, null, 2) + "\n");

writeFileSync(fileURLToPath(new URL("../app-icon.svg", import.meta.url)),
  draw(LEVELS[0], "idle").replace(/<style>[\s\S]*?<\/style>/, "").replace('width="160" height="160"', 'width="1024" height="1024"'));

console.log(`wrote ${LEVELS.length * STATES.length} sprites to ${dir}`);
