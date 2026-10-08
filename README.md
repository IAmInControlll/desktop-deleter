# Desktop Deleter

A little guy who lives on your desktop and eats your files. Drag files onto him and he
chomps them into the Recycle Bin.

Built with [Tauri 2](https://tauri.app): a Rust backend and a plain HTML/JS frontend, so the
app stays tiny (a few MB) and character art is just image files.

## Using it

- **Drag files or folders onto him**: he gets hungry, then eats them.
- **Drag him** to move him anywhere. He remembers where you left him.
- **Click him** to pet him.
- **Right-click him** to open the menu: see his tummy, digest, switch character, toggle permanent delete, size (50–200%), always on top (off = he lives on the desktop behind your windows, and stays visible with Win+D), move to corner, quit.
- **Tray icon** (a little bin): left-click to hide/show him, right-click for the same menu. It turns red-hot while permanent delete is on.
- He only talks when you interact with him. No unprompted speech bubbles.

### His tummy is the Recycle Bin

How full he looks comes straight from the Recycle Bin, so it stays honest. Each file he eats
fills him up, and restoring or emptying the bin in Explorer empties him again. **Digest** in
the right-click menu empties the Recycle Bin, and Windows asks you to confirm first.

| Level      | Recycle Bin holds roughly                   |
|------------|---------------------------------------------|
| `empty`    | nothing                                     |
| `bit`      | 1–3 items, or ~10 MB                        |
| `half`     | 4–16 items, or ~50 MB                       |
| `full`     | 17–54 items, or ~130 MB                     |
| `overflow` | 55+ items, or ~500 MB                       |

### Permanent delete

By default, eaten files go to the **Windows Recycle Bin**, so you can always get them back.
"Permanent delete" mode skips the bin. He switches to his `permanent` look (an incinerator)
and glows red while it's on. Nothing goes into the bin, so he doesn't fill up.

He refuses to eat drives, the Windows folder, Program Files, and your main user folders
(Desktop, Documents, etc.).

## Development

Prerequisites: Rust (MSVC toolchain), Node.js, Visual Studio Build Tools (C++), WebView2 (built into Windows 11).

```sh
npm install
npm run dev      # run with hot reload
npm run build    # produces an installer in src-tauri/target/release/bundle/nsis/
npm run icon     # regenerate app icons from app-icon.svg
```

## Project layout

```
src/                     frontend (served as-is, no bundler)
  main.js                behaviour: state machine, drag/drop, menu, window placement
  characters/
    index.json           list of character folder names shown in the menu
    chomp/               one folder per character (30 sprites + character.json)
    binny/
tools/
  check-character.mjs    checks a character has every sprite  (node tools/check-character.mjs [id])
  gen-chomp.mjs          generates Chomp's SVG art             (node tools/gen-chomp.mjs)
  gen-bin.mjs            generates Binny's SVG art             (node tools/gen-bin.mjs)
src-tauri/src/lib.rs     Rust commands: eat (Recycle Bin / permanent delete + safety checks),
                         tummy / digest (Recycle Bin size, empty), set_on_top (top vs. desktop)
```

## Making a new character

The full artist brief (specs, design guidance, AI workflow and prompt template) is in
[docs/CHARACTER_GUIDE.md](docs/CHARACTER_GUIDE.md). The short version:

Every character has the same standard sprite set, **6 levels × 5 states = 30 sprites**:

|              | `idle` | `hungry` | `eating` | `happy` | `refuse` |
|--------------|:------:|:--------:|:--------:|:-------:|:--------:|
| `empty`      | ✓ | ✓ | ✓ | ✓ | ✓ |
| `bit`        | ✓ | ✓ | ✓ | ✓ | ✓ |
| `half`       | ✓ | ✓ | ✓ | ✓ | ✓ |
| `full`       | ✓ | ✓ | ✓ | ✓ | ✓ |
| `overflow`   | ✓ | ✓ | ✓ | ✓ | ✓ |
| `permanent`  | ✓ | ✓ | ✓ | ✓ | ✓ |

**Levels:** `empty` → `overflow` show how full he is (see the table above). `permanent` is
used instead while permanent delete is on, so it should look clearly different, because it's
the user's warning that files won't be recoverable.

**States:**

| State    | When it shows                                      |
|----------|----------------------------------------------------|
| `idle`   | Default, just hanging out                          |
| `hungry` | Files are being dragged over him                   |
| `eating` | Files were dropped; plays for at least `eatingMs`  |
| `happy`  | Finished eating, or after being petted             |
| `refuse` | Something couldn't be eaten (protected / missing)  |

### Steps

1. Create `src/characters/<id>/` (for example `src/characters/gobbo/`).
2. Add the 30 sprites, named by the `sprites` pattern, for example `half-eating.gif`. Each one
   should be **160×160** with a transparent background. Any format the browser can show
   works: animated **SVG**, **GIF**, **APNG**, **WebP**, or PNG.
3. Add a `character.json`:

```json
{
  "name": "Gobbo",
  "author": "you",
  "sprites": "{level}-{state}.gif",
  "timings": { "eatingMs": 1400, "happyMs": 1600, "refuseMs": 2200, "petMs": 1200 },
  "lines": {
    "hungry":       ["Gimme!"],
    "eat":          ["Yum!", "That's {total} files eaten!"],
    "full":         ["So full..."],
    "permanentEat": ["Incinerated!"],
    "refuse":       ["Can't eat"],
    "pet":          ["Hehe"],
    "digestStart":  ["Hrrngh..."],
    "digest":       ["Ahh, much better!"]
  }
}
```

4. Add `"gobbo"` to `src/characters/index.json`.
5. Run `node tools/check-character.mjs gobbo` to list any missing sprites.

Notes:
- If a sprite is missing, he falls back to that level's `idle`, then the `empty` one, so a
  half-finished character still works while you draw.
- Speech lines are all optional. `full` lines replace `eat` at the `full`/`overflow` levels,
  and `permanentEat` replaces `eat` in permanent mode. `{count}` (files in this bite) and
  `{total}` (lifetime total) can be used in `eat` lines.
- `timings` and `fullness` (`{ "fullAtMB": 1024, "fullAtItems": 100 }`) are optional overrides.
