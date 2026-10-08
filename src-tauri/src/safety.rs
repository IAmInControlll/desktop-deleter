//! Decides whether a dropped path may be deleted, and deletes exactly what was checked.
//!
//! Every candidate is checked in three spellings, and all of them must pass:
//! 1. the path as given, normalised lexically (`..`, case, trailing separators, `\\?\`);
//! 2. where the entry really lives: its parent folder with junctions/symlinks/8.3 names
//!    resolved, plus its own name;
//! 3. what it resolves to, following its final component too (catches 8.3 short names like
//!    `C:\PROGRA~1`, and links pointing into protected places).
//!
//! The policy has two tiers. *Protected trees* (Windows, Program Files, ProgramData) are refused
//! along with everything inside them. *Protected roots* (user profile, Desktop, Documents...)
//! are refused themselves, but ordinary files inside them are allowed. Any folder whose
//! recursive deletion would include a protected tree, a protected root, or the running exe is
//! refused too. When something can't be checked, the answer is no.

use std::fs;
use std::path::{Component, Path, PathBuf, Prefix};

/// A path reduced to comparable parts: a volume (`C:` or `\\server\share`) plus its folder and
/// file names, case-folded the way NTFS compares names.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Key {
    volume: String,
    names: Vec<String>,
}

impl Key {
    fn is_volume_root(&self) -> bool {
        self.names.is_empty()
    }

    /// True if `self` is `other` or somewhere inside it (whole components, so `C:\Windows2` is
    /// not inside `C:\Windows`).
    fn is_within(&self, other: &Key) -> bool {
        self.volume == other.volume
            && self.names.len() >= other.names.len()
            && self.names[..other.names.len()] == other.names[..]
    }
}

/// NTFS compares names by upper-casing each UTF-16 unit on its own; mirror that with simple
/// (one char to one char) upper-casing, so e.g. `ß` doesn't become `SS`.
fn fold(name: &str) -> String {
    name.chars()
        .map(|c| {
            let mut up = c.to_uppercase();
            match (up.next(), up.next()) {
                (Some(u), None) => u,
                _ => c,
            }
        })
        .collect()
}

/// Lexically normalises an absolute Windows path, returning it (case kept, `..` resolved,
/// trailing dots/spaces trimmed the way Win32 does) together with its comparison key.
pub fn normalize(path: &Path) -> Result<(PathBuf, Key), &'static str> {
    let mut components = path.components();
    let (volume, verbatim, prefix) = match components.next() {
        Some(Component::Prefix(p)) => {
            let (volume, verbatim) = match p.kind() {
                Prefix::Disk(l) => (format!("{}:", (l as char).to_ascii_uppercase()), false),
                Prefix::VerbatimDisk(l) => (format!("{}:", (l as char).to_ascii_uppercase()), true),
                Prefix::UNC(server, share) => (unc_volume(server, share)?, false),
                Prefix::VerbatimUNC(server, share) => (unc_volume(server, share)?, true),
                // `\\.\` device paths and `\\?\Volume{...}` style paths can't be checked.
                _ => return Err("that's a kind of path I can't check"),
            };
            (volume, verbatim, p.as_os_str().to_owned())
        }
        _ => return Err("that's not a full path"),
    };
    if components.next() != Some(Component::RootDir) {
        return Err("that's not a full path"); // e.g. `C:folder`, relative to C:'s current dir
    }

    let mut out = PathBuf::from(prefix);
    out.push(r"\");
    let mut names = Vec::new();
    for component in components {
        match component {
            // In `\\?\` paths Windows takes `.` and `..` literally, so their meaning is unclear.
            Component::CurDir | Component::ParentDir if verbatim => {
                return Err("that path has '.' or '..' I can't make sense of")
            }
            Component::CurDir => {}
            Component::ParentDir => {
                if names.pop().is_none() {
                    return Err("that path climbs above the drive");
                }
                out.pop();
            }
            Component::Normal(raw) => {
                let raw = raw.to_str().ok_or("that name has characters I can't check")?;
                if raw.contains(':') {
                    return Err("that's a hidden data stream, not a normal file");
                }
                // Win32 silently drops trailing dots and spaces (`C:\Windows.` is `C:\Windows`).
                let name = if verbatim { raw } else { raw.trim_end_matches(['.', ' ']) };
                if name.is_empty() || name.ends_with(['.', ' ']) {
                    return Err("that name is too unusual to check");
                }
                names.push(fold(name));
                out.push(name);
            }
            Component::Prefix(_) | Component::RootDir => return Err("that path is malformed"),
        }
    }
    Ok((out, Key { volume, names }))
}

fn unc_volume(server: &std::ffi::OsStr, share: &std::ffi::OsStr) -> Result<String, &'static str> {
    let server = server.to_str().ok_or("that path is malformed")?;
    let share = share.to_str().ok_or("that path is malformed")?;
    Ok(format!(r"\\{}\{}", fold(server), fold(share)))
}

pub fn key(path: &Path) -> Result<Key, &'static str> {
    normalize(path).map(|(_, k)| k)
}

/// Every spelling of a protected location worth comparing against: as written, and as it
/// really resolves (if it exists).
fn spellings(path: &Path) -> Vec<Key> {
    let mut keys = Vec::new();
    if let Ok(k) = key(path) {
        keys.push(k);
    }
    if let Ok(real) = fs::canonicalize(path) {
        if let Ok(k) = key(&real) {
            if !keys.contains(&k) {
                keys.push(k);
            }
        }
    }
    keys
}

/// What may never be eaten.
pub struct Policy {
    /// Refused, along with everything inside them.
    trees: Vec<Key>,
    /// Refused themselves; ordinary files inside are fine.
    roots: Vec<Key>,
    /// The running app.
    exe: Vec<Key>,
}

impl Policy {
    pub fn new(trees: &[PathBuf], roots: &[PathBuf], exe: Option<&Path>) -> Policy {
        Policy {
            trees: trees.iter().flat_map(|p| spellings(p)).collect(),
            roots: roots.iter().flat_map(|p| spellings(p)).collect(),
            exe: exe.map(spellings).unwrap_or_default(),
        }
    }

    /// The policy for this PC, from the standard Windows locations. `user_roots` adds known
    /// folders (Desktop, Documents...) the caller looked up. Fails if a location that must be
    /// protected can't be found: without it we can't tell what's safe.
    pub fn for_system(user_roots: Vec<PathBuf>) -> Result<Policy, &'static str> {
        let var = |name: &str| std::env::var_os(name).map(PathBuf::from);
        let required = |name: &str| var(name).ok_or("I can't tell what's safe to eat right now");

        let mut trees = vec![required("SystemRoot")?, required("ProgramFiles")?, required("ProgramData")?];
        trees.extend(["ProgramFiles(x86)", "ProgramW6432", "windir"].iter().filter_map(|v| var(v)));

        let profile = required("USERPROFILE")?;
        let mut roots = vec![profile.clone()];
        roots.extend(var("PUBLIC"));
        for name in ["Desktop", "Documents", "Downloads", "Pictures", "Music", "Videos", "OneDrive"] {
            roots.push(profile.join(name));
        }
        roots.extend(["APPDATA", "LOCALAPPDATA", "OneDrive"].iter().filter_map(|v| var(v)));
        roots.extend(user_roots);

        let exe = std::env::current_exe().ok();
        Ok(Policy::new(&trees, &roots, exe.as_deref()))
    }

    /// Checks one spelling of a candidate against every protected location.
    fn check(&self, k: &Key) -> Result<(), &'static str> {
        if k.is_volume_root() {
            return Err("that's a whole drive!");
        }
        if self.trees.iter().any(|t| k.is_within(t)) {
            return Err("that's part of Windows or an installed program!");
        }
        if self.roots.iter().any(|r| k == r) {
            return Err("that folder is too important!");
        }
        if self.exe.iter().any(|e| e.is_within(k)) {
            return Err("I can't eat myself!");
        }
        if self.trees.iter().chain(&self.roots).any(|p| p.is_within(k)) {
            return Err("there's something important inside it!");
        }
        Ok(())
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum Kind {
    File,
    Dir,
    /// A symlink or junction. Only the link itself is ever deleted, never what it points to.
    Link { dir: bool },
}

/// A checked deletion: exactly which object to remove, and how.
#[derive(Debug)]
pub struct Plan {
    /// The entry's real location (resolved parent + its own name). For a link this is the link.
    pub path: PathBuf,
    pub kind: Kind,
}

/// Validates a dropped path. Returns what to delete, or why not.
pub fn plan(raw: &Path, policy: &Policy) -> Result<Plan, &'static str> {
    // 1. As given.
    let (given, given_key) = normalize(raw)?;
    policy.check(&given_key)?;

    let meta = match fs::symlink_metadata(&given) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Err("it's already gone!"),
        Err(_) => return Err("I couldn't check it"),
    };

    // 2. Where the entry really lives: resolve its parent (junctions, links, 8.3 names on the
    //    way), keep its own name so a link stays a link.
    let parent = given.parent().ok_or("that's a whole drive!")?;
    let name = given.file_name().ok_or("I couldn't check it")?;
    let real_parent = fs::canonicalize(parent).map_err(|_| "I couldn't check where it lives")?;
    let location = real_parent.join(name);
    policy.check(&key(&location)?)?;

    // 3. What it resolves to. For a link that's its target: deleting the link leaves the target
    //    alone, but a link into a protected place is refused anyway, to be safe. For anything
    //    else this resolves its own 8.3 short name (`C:\PROGRA~1` -> `C:\Program Files`).
    let resolved = fs::canonicalize(&given).map_err(|_| "it points somewhere I can't check")?;
    policy.check(&key(&resolved)?)?;

    let ft = meta.file_type();
    let kind = if ft.is_symlink() {
        // `is_symlink` is true for symlinks and junctions (name-surrogate reparse points), but
        // not for OneDrive placeholders and other reparse points that are real files/folders.
        Kind::Link { dir: is_dir_link(&ft) }
    } else if ft.is_dir() {
        Kind::Dir
    } else {
        Kind::File
    };
    // A plain file or folder is deleted at its fully resolved spelling; a link at its own spot.
    let path = if kind == Kind::File || kind == Kind::Dir { resolved } else { location };
    Ok(Plan { path, kind })
}

#[cfg(windows)]
fn is_dir_link(ft: &fs::FileType) -> bool {
    use std::os::windows::fs::FileTypeExt;
    ft.is_symlink_dir()
}

#[cfg(not(windows))]
fn is_dir_link(_: &fs::FileType) -> bool {
    false
}

/// Deletes exactly what `plan` approved.
pub fn execute(plan: &Plan, permanent: bool) -> Result<(), String> {
    if !permanent {
        // `trash` resolves only the parent folder and keeps the name, so a link is recycled as
        // a link and its target is untouched.
        return trash::delete(&plan.path).map_err(|e| e.to_string());
    }
    match plan.kind {
        Kind::File | Kind::Link { dir: false } => fs::remove_file(&plan.path),
        // Removes the link only. Never `remove_dir_all` on a link.
        Kind::Link { dir: true } => fs::remove_dir(&plan.path),
        // std's `remove_dir_all` deletes links it finds inside without following them.
        Kind::Dir => fs::remove_dir_all(&plan.path),
    }
    .map_err(|e| e.to_string())
}

#[derive(serde::Serialize, Debug)]
pub struct Refused {
    pub name: String,
    pub reason: String,
}

#[derive(serde::Serialize, Debug)]
pub struct EatReport {
    pub eaten: usize,
    pub refused: Vec<Refused>,
}

/// Checks and deletes each path in turn. A path that fails any check is refused and left alone.
pub fn eat_paths(paths: &[String], permanent: bool, policy: Result<&Policy, &'static str>) -> EatReport {
    let mut report = EatReport { eaten: 0, refused: Vec::new() };
    for raw in paths {
        let path = Path::new(raw);
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| raw.clone());
        // Plan and delete back to back, to keep the gap between checking and deleting small.
        let result = policy
            .and_then(|p| plan(path, p))
            .map_err(str::to_string)
            .and_then(|plan| execute(&plan, permanent));
        match result {
            Ok(()) => report.eaten += 1,
            Err(reason) => report.refused.push(Refused { name, reason }),
        }
    }
    report
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use std::process::Command;

    /// A throwaway folder tree, removed when dropped:
    /// ```text
    /// <root>\sys\inner\file.txt        protected tree
    /// <root>\progs\App\a.dll           protected tree
    /// <root>\home\Desktop\note.txt     home and home\Desktop are protected roots
    /// <root>\app\dd.exe                the "running exe"
    /// <root>\sys2\file.txt, <root>\home2\file.txt, <root>\other\...   ordinary
    /// ```
    struct Fixture {
        root: PathBuf,
        policy: Policy,
    }

    impl Fixture {
        fn new(tag: &str) -> Fixture {
            let root = std::env::temp_dir().join(format!("dd-safety-{tag}-{}", std::process::id()));
            let _ = fs::remove_dir_all(&root);
            for dir in ["sys/inner", "progs/App", "home/Desktop/sub", "app", "sys2", "home2", "other/keep"] {
                fs::create_dir_all(root.join(dir)).unwrap();
            }
            for file in [
                "sys/inner/file.txt", "progs/App/a.dll", "home/Desktop/note.txt", "home/Desktop/sub/x.txt",
                "app/dd.exe", "sys2/file.txt", "home2/file.txt", "other/file.txt", "other/keep/precious.txt",
            ] {
                fs::write(root.join(file), b"test").unwrap();
            }
            let policy = Policy::new(
                &[root.join("sys"), root.join("progs")],
                &[root.join("home"), root.join("home").join("Desktop")],
                Some(&root.join("app").join("dd.exe")),
            );
            Fixture { root, policy }
        }

        fn p(&self, rel: &str) -> PathBuf {
            self.root.join(rel.replace('/', "\\"))
        }

        fn check(&self, path: impl AsRef<Path>) -> Result<Plan, &'static str> {
            plan(path.as_ref(), &self.policy)
        }

        /// Makes a junction (no admin rights needed, unlike symlinks).
        fn junction(&self, link: &str, target: &str) {
            let ok = Command::new("cmd")
                .args(["/C", "mklink", "/J"])
                .arg(self.p(link))
                .arg(self.p(target))
                .output()
                .unwrap()
                .status
                .success();
            assert!(ok, "mklink /J failed");
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn protected_trees_and_everything_inside() {
        let f = Fixture::new("trees");
        for rel in ["sys", "sys/inner", "sys/inner/file.txt", "progs", "progs/App/a.dll"] {
            assert!(f.check(f.p(rel)).is_err(), "{rel} should be refused");
        }
    }

    #[test]
    fn protected_roots_but_not_files_inside() {
        let f = Fixture::new("roots");
        assert!(f.check(f.p("home")).is_err());
        assert!(f.check(f.p("home/Desktop")).is_err());
        assert_eq!(f.check(f.p("home/Desktop/note.txt")).unwrap().kind, Kind::File);
        assert_eq!(f.check(f.p("home/Desktop/sub")).unwrap().kind, Kind::Dir);
    }

    #[test]
    fn other_spellings_of_protected_paths() {
        let f = Fixture::new("spell");
        let root = f.root.to_str().unwrap();
        let refused = [
            format!(r"{root}\SYS\INNER"),                    // case
            format!(r"{root}\sys\"),                         // trailing separator
            format!(r"{root}\sys\\inner\\"),                 // doubled separators
            format!(r"{root}\other\..\sys\inner\file.txt"),  // ..
            format!(r"{root}\other\.\..\sys"),               // . and ..
            format!(r"{root}\sys."),                         // Win32 trims trailing dots
            format!(r"{root}\sys \inner"),                   // ... and spaces
            format!(r"\\?\{root}\sys\inner"),                // extended-length prefix
            format!(r"\\?\{root}\other\..\sys"),             // .. inside \\?\ is refused outright
            format!(r"{root}\other\file.txt:secret"),        // alternate data stream
            format!(r"{root}\HOME\desktop\"),                // protected root, other spelling
            format!(r"{root}\home\Desktop\sub\..\..\.."),    // climbs back up to the fixture root
        ];
        for path in &refused {
            assert!(f.check(path).is_err(), "{path} should be refused");
        }
        // Similarly named siblings are not protected.
        assert!(f.check(f.p("sys2/file.txt")).is_ok());
        assert!(f.check(f.p("sys2")).is_ok());
        assert!(f.check(f.p("home2")).is_ok());
        // Ordinary path through `..` that ends somewhere fine.
        assert!(f.check(format!(r"{root}\sys\..\other\file.txt")).is_ok());
    }

    #[test]
    fn roots_relative_and_odd_paths() {
        let f = Fixture::new("odd");
        for path in [r"C:\", r"C:", r"C:relative\file.txt", r"relative\file.txt", r"\no-drive", r"\\server\share",
                     r"\\server\share\", r"\\.\C:\x", r"\\?\Volume{00000000-0000-0000-0000-000000000000}\x"] {
            assert!(f.check(path).is_err(), "{path} should be refused");
        }
        assert_eq!(f.check(f.p("nope.txt")).unwrap_err(), "it's already gone!");
    }

    #[test]
    fn junctions_into_protected_places() {
        let f = Fixture::new("junction");
        f.junction("other/to-sys", "sys");
        f.junction("other/to-home", "home");
        // The link itself points into a protected tree / at a protected root.
        assert!(f.check(f.p("other/to-sys")).is_err());
        assert!(f.check(f.p("other/to-home")).is_err());
        // Going *through* the link lands inside the protected tree.
        assert!(f.check(f.p("other/to-sys/inner/file.txt")).is_err());
        // Through a link to a protected root, ordinary files are still fine (same as directly).
        assert!(f.check(f.p("other/to-home/Desktop/note.txt")).is_ok());
    }

    #[test]
    fn deleting_a_junction_removes_only_the_link() {
        let f = Fixture::new("junction-del");
        f.junction("other/to-keep", "other/keep");
        let plan = f.check(f.p("other/to-keep")).unwrap();
        assert_eq!(plan.kind, Kind::Link { dir: true });
        execute(&plan, true).unwrap();
        assert!(!f.p("other/to-keep").exists(), "the link should be gone");
        assert!(f.p("other/keep/precious.txt").exists(), "the target's contents must survive");
    }

    #[test]
    fn deleting_a_folder_with_a_junction_inside_keeps_the_target() {
        let f = Fixture::new("junction-inside");
        fs::create_dir_all(f.p("other/box")).unwrap();
        f.junction("other/box/to-keep", "other/keep");
        let plan = f.check(f.p("other/box")).unwrap();
        assert_eq!(plan.kind, Kind::Dir);
        execute(&plan, true).unwrap();
        assert!(!f.p("other/box").exists());
        assert!(f.p("other/keep/precious.txt").exists(), "recursive delete must not follow the junction");
    }

    #[test]
    fn symlinks_into_protected_places() {
        let f = Fixture::new("symlink");
        // Creating symlinks needs Developer Mode or admin rights; junctions above cover the
        // no-privilege case.
        if std::os::windows::fs::symlink_file(f.p("sys/inner/file.txt"), f.p("other/link.txt")).is_err() {
            eprintln!("SKIPPED symlinks_into_protected_places: no symlink privilege");
            return;
        }
        assert!(f.check(f.p("other/link.txt")).is_err());
        std::os::windows::fs::symlink_file(f.p("other/file.txt"), f.p("other/ok-link.txt")).unwrap();
        let plan = f.check(f.p("other/ok-link.txt")).unwrap();
        assert_eq!(plan.kind, Kind::Link { dir: false });
        execute(&plan, true).unwrap();
        assert!(f.p("other/file.txt").exists(), "deleting the link must keep its target");
    }

    #[test]
    fn ancestors_of_protected_places_or_the_exe() {
        let f = Fixture::new("ancestors");
        assert!(f.check(&f.root).is_err(), "contains protected trees and roots");
        assert_eq!(f.check(f.p("app")).unwrap_err(), "I can't eat myself!");
        assert_eq!(f.check(f.p("app/dd.exe")).unwrap_err(), "I can't eat myself!");
        assert!(f.check(f.p("other")).is_ok(), "nothing protected inside");
    }

    #[test]
    fn refused_paths_are_left_alone() {
        let f = Fixture::new("eat");
        let paths: Vec<String> = ["sys/inner/file.txt", "home/Desktop", "other/file.txt", "nope.txt"]
            .iter()
            .map(|r| f.p(r).to_string_lossy().into_owned())
            .collect();
        let report = eat_paths(&paths, true, Ok(&f.policy));
        assert_eq!(report.eaten, 1);
        assert_eq!(report.refused.len(), 3);
        assert!(!f.p("other/file.txt").exists(), "the allowed file is deleted");
        assert!(f.p("sys/inner/file.txt").exists());
        assert!(f.p("home/Desktop/note.txt").exists());
    }

    #[test]
    fn no_policy_means_nothing_is_deleted() {
        let f = Fixture::new("nopolicy");
        let paths = vec![f.p("other/file.txt").to_string_lossy().into_owned()];
        let report = eat_paths(&paths, true, Err("I can't tell what's safe to eat right now"));
        assert_eq!(report.eaten, 0);
        assert!(f.p("other/file.txt").exists());
    }

    /// The real policy on this PC. Only plans; never deletes anything.
    #[test]
    fn real_system_locations() {
        let policy = Policy::for_system(vec![]).unwrap();
        let sys = std::env::var("SystemRoot").unwrap();
        let pf = std::env::var("ProgramFiles").unwrap();
        let profile = std::env::var("USERPROFILE").unwrap();
        let drive = &sys[..2];
        let refused = [
            format!(r"{sys}\System32\notepad.exe"),
            format!(r"{}\SYSTEM32\", sys.to_lowercase()),
            format!(r"\\?\{sys}\explorer.exe"),
            format!(r"{sys}\..\Program Files"),
            format!(r"{pf}\Common Files"),
            format!(r"{drive}\PROGRA~1"),
            format!(r"{drive}\"),
            profile.clone(),
            format!(r"{profile}\Desktop"),
            format!(r"{profile}\Documents\"),
            std::env::current_exe().unwrap().to_string_lossy().into_owned(),
        ];
        for path in &refused {
            assert!(plan(Path::new(path), &policy).is_err(), "{path} should be refused");
        }
    }
}
