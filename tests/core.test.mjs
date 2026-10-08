import { test } from "node:test";
import assert from "node:assert/strict";
import { loadSettings, serializeSettings, createFeedQueue, DEFAULT_SETTINGS } from "../src/core.js";

test("restarting with permanent delete saved by an older version starts in Recycle Bin mode", () => {
  const saved = JSON.stringify({ character: "binny", permanent: true, scale: 1.5, position: { x: 10, y: 20 } });
  const settings = loadSettings(saved);
  assert.equal(settings.permanent, undefined, "the saved permanent flag is ignored");
  // Everything else still comes back.
  assert.equal(settings.character, "binny");
  assert.equal(settings.scale, 1.5);
  assert.deepEqual(settings.position, { x: 10, y: 20 });
});

test("permanent delete is never written to saved settings", () => {
  const settings = loadSettings(null);
  settings.permanent = true; // even if something sets it on the settings object
  const saved = JSON.parse(serializeSettings(settings));
  assert.equal("permanent" in saved, false);
  assert.equal(loadSettings(serializeSettings(settings)).permanent, undefined);
});

test("missing or broken saved settings fall back to the defaults", () => {
  for (const raw of [null, "", "not json", "null", "[1,2]", "42"]) {
    assert.deepEqual(loadSettings(raw), DEFAULT_SETTINGS, `for ${JSON.stringify(raw)}`);
  }
});

test("queued drops keep the deletion mode they were dropped with", async () => {
  const calls = [];
  let releaseFirst;
  const firstBlocked = new Promise((r) => (releaseFirst = r));
  const feed = createFeedQueue(async (paths, permanent) => {
    calls.push({ paths, permanent });
    if (paths[0] === "a") await firstBlocked; // the first bite takes a while
  });

  let permanentMode = true;
  const first = feed(["a"], permanentMode); // dropped while permanent delete is on
  permanentMode = false; // user switches back to Recycle Bin mode mid-meal
  const second = feed(["b"], permanentMode);
  permanentMode = true; // ...and on again, before "b" has started
  releaseFirst();
  await Promise.all([first, second]);

  assert.deepEqual(calls, [
    { paths: ["a"], permanent: true },
    { paths: ["b"], permanent: false },
  ]);
});

test("a failed bite doesn't stop later ones", async () => {
  const done = [];
  const feed = createFeedQueue(async (paths) => {
    if (paths[0] === "bad") throw new Error("boom");
    done.push(paths[0]);
  });
  await assert.rejects(feed(["bad"], false));
  await feed(["good"], false);
  assert.deepEqual(done, ["good"]);
});
