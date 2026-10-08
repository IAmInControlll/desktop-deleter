// Checks that a character pack has the full standard sprite set.
// Usage: node tools/check-character.mjs <character-id>   (or no id to check all of them)
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../src/characters/", import.meta.url));
const LEVELS = ["empty", "bit", "half", "full", "overflow", "permanent"];
const STATES = ["idle", "hungry", "eating", "happy", "refuse"];
const LINES = ["hungry", "eat", "full", "permanentEat", "refuse", "pet", "digestStart", "digest"];

const index = JSON.parse(readFileSync(root + "index.json", "utf8"));
const ids = process.argv[2] ? [process.argv[2]] : readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);

let failed = false;
for (const id of ids) {
  const dir = `${root}${id}/`;
  const problems = [];
  const notes = [];
  if (!existsSync(dir + "character.json")) {
    problems.push("no character.json");
  } else {
    const def = JSON.parse(readFileSync(dir + "character.json", "utf8"));
    const pattern = def.sprites || "{level}-{state}.png";
    if (!def.name) problems.push('no "name"');
    for (const level of LEVELS) {
      const missing = STATES.filter((s) => !existsSync(dir + pattern.replace("{level}", level).replace("{state}", s)));
      if (missing.length) problems.push(`${level}: missing ${missing.map((s) => pattern.replace("{level}", level).replace("{state}", s)).join(", ")}`);
    }
    const noLines = LINES.filter((k) => !def.lines?.[k]?.length);
    if (noLines.length) notes.push(`no speech lines for: ${noLines.join(", ")} (optional)`);
  }
  if (!index.includes(id)) problems.push(`not listed in src/characters/index.json`);

  console.log(`${problems.length ? "✗" : "✓"} ${id}`);
  for (const p of problems) console.log(`    ${p}`);
  for (const n of notes) console.log(`    note: ${n}`);
  failed ||= problems.length > 0;
}
process.exit(failed ? 1 : 0);
