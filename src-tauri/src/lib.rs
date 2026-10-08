use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
struct Refused {
    name: String,
    reason: String,
}

#[derive(Serialize)]
struct EatReport {
    eaten: usize,
    refused: Vec<Refused>,
}

fn norm(p: &Path) -> String {
    p.to_string_lossy()
        .trim_end_matches(['\\', '/'])
        .to_lowercase()
}

/// Folders the little guy must never eat, no matter how hungry he is.
fn protected_reason(app: &AppHandle, path: &Path) -> Option<&'static str> {
    if path.parent().is_none() {
        return Some("that's a whole drive!");
    }
    let p = norm(path);

    if let Ok(win) = std::env::var("SystemRoot") {
        let w = norm(Path::new(&win));
        if p == w || p.starts_with(&format!("{w}\\")) {
            return Some("that's part of Windows!");
        }
    }

    let mut important: Vec<PathBuf> = ["ProgramFiles", "ProgramFiles(x86)", "ProgramData", "USERPROFILE", "PUBLIC"]
        .iter()
        .filter_map(|v| std::env::var_os(v).map(PathBuf::from))
        .collect();
    let dirs = app.path();
    important.extend(
        [
            dirs.home_dir(),
            dirs.desktop_dir(),
            dirs.document_dir(),
            dirs.download_dir(),
            dirs.picture_dir(),
            dirs.audio_dir(),
            dirs.video_dir(),
            dirs.data_dir(),
            dirs.local_data_dir(),
        ]
        .into_iter()
        .flatten(),
    );
    if important.iter().any(|i| norm(i) == p) {
        return Some("that folder is too important!");
    }

    if let Ok(exe) = std::env::current_exe() {
        if norm(&exe) == p {
            return Some("I can't eat myself!");
        }
    }
    None
}

fn eat_one(path: &Path, permanent: bool) -> Result<(), String> {
    if permanent {
        if path.is_dir() {
            std::fs::remove_dir_all(path)
        } else {
            std::fs::remove_file(path)
        }
        .map_err(|e| e.to_string())
    } else {
        trash::delete(path).map_err(|e| e.to_string())
    }
}

/// Sends dropped paths to the Recycle Bin (or deletes them for good when `permanent`).
#[tauri::command]
async fn eat(app: AppHandle, paths: Vec<String>, permanent: bool) -> EatReport {
    tauri::async_runtime::spawn_blocking(move || {
        let mut report = EatReport { eaten: 0, refused: Vec::new() };
        for raw in paths {
            let path = PathBuf::from(&raw);
            let name = path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or(raw);

            let result = if !path.exists() {
                Err("it's already gone!".to_string())
            } else if let Some(reason) = protected_reason(&app, &path) {
                Err(reason.to_string())
            } else {
                eat_one(&path, permanent)
            };

            match result {
                Ok(()) => report.eaten += 1,
                Err(reason) => report.refused.push(Refused { name, reason }),
            }
        }
        report
    })
    .await
    .unwrap_or(EatReport { eaten: 0, refused: Vec::new() })
}

#[derive(Serialize, Default)]
struct Tummy {
    bytes: i64,
    items: i64,
}

/// What's in his belly = what's in the Recycle Bin (all drives).
#[tauri::command]
async fn tummy() -> Tummy {
    tauri::async_runtime::spawn_blocking(|| {
        use windows::core::PCWSTR;
        use windows::Win32::UI::Shell::{SHQueryRecycleBinW, SHQUERYRBINFO};

        let mut info = SHQUERYRBINFO {
            cbSize: std::mem::size_of::<SHQUERYRBINFO>() as u32,
            ..Default::default()
        };
        match unsafe { SHQueryRecycleBinW(PCWSTR::null(), &mut info) } {
            Ok(()) => Tummy { bytes: info.i64Size, items: info.i64NumItems },
            Err(_) => Tummy::default(),
        }
    })
    .await
    .unwrap_or_default()
}

/// Empties the Recycle Bin. Windows shows its usual "are you sure?" dialog first.
/// Returns false if the user cancelled or it failed.
#[tauri::command]
async fn digest(window: tauri::WebviewWindow) -> bool {
    let owner = window.hwnd().map(|h| h.0 as isize).unwrap_or(0);
    tauri::async_runtime::spawn_blocking(move || {
        use windows::core::PCWSTR;
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::Shell::SHEmptyRecycleBinW;

        let owner = (owner != 0).then(|| HWND(owner as *mut _));
        unsafe { SHEmptyRecycleBinW(owner, PCWSTR::null(), 0) }.is_ok()
    })
    .await
    .unwrap_or(false)
}

/// `true`: float above every window. `false`: live on the desktop, behind windows but above
/// the wallpaper. For that, the desktop (Progman) becomes his owner window. Windows keeps
/// owned windows above their owner, so he can't sink under the wallpaper, and he stays put
/// when you press Win+D.
#[tauri::command]
fn set_on_top(window: tauri::WebviewWindow, on_top: bool) -> Result<(), String> {
    use windows::core::w;
    use windows::Win32::UI::WindowsAndMessaging::{FindWindowW, SetWindowLongPtrW, GWLP_HWNDPARENT};

    let hwnd = window.hwnd().map_err(|e| e.to_string())?;
    let owner = if on_top {
        0
    } else {
        unsafe { FindWindowW(w!("Progman"), None) }.map_or(0, |h| h.0 as isize)
    };
    unsafe { SetWindowLongPtrW(hwnd, GWLP_HWNDPARENT, owner) };

    if on_top {
        window.set_always_on_bottom(false).map_err(|e| e.to_string())?;
        window.set_always_on_top(true).map_err(|e| e.to_string())
    } else {
        window.set_always_on_top(false).map_err(|e| e.to_string())?;
        window.set_always_on_bottom(true).map_err(|e| e.to_string())
    }
}

/// Installed (release) builds turn on "Start with Windows" the first time they run;
/// dev builds don't, so a throwaway debug exe never gets registered to run at login.
#[tauri::command]
fn is_release() -> bool {
    !cfg!(debug_assertions)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .invoke_handler(tauri::generate_handler![eat, tummy, digest, set_on_top, is_release])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
