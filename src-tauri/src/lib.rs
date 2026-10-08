mod safety;

use safety::{EatReport, Policy, Refused};
use serde::Serialize;
use tauri::{AppHandle, Manager};

/// Builds the "never eat this" policy for this PC, adding the user's known folders
/// (Desktop, Documents...) as Windows reports them, which may differ from the defaults
/// (e.g. when OneDrive moves them).
fn system_policy(app: &AppHandle) -> Result<Policy, &'static str> {
    let dirs = app.path();
    let known = [
        dirs.home_dir(),
        dirs.desktop_dir(),
        dirs.document_dir(),
        dirs.download_dir(),
        dirs.picture_dir(),
        dirs.audio_dir(),
        dirs.video_dir(),
        dirs.data_dir(),
        dirs.local_data_dir(),
    ];
    Policy::for_system(known.into_iter().flatten().collect())
}

/// Sends dropped paths to the Recycle Bin (or deletes them for good when `permanent`).
/// Every path is checked by `safety` first; anything it can't approve is refused, untouched.
#[tauri::command]
async fn eat(app: AppHandle, paths: Vec<String>, permanent: bool) -> EatReport {
    let fallback = paths.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let policy = system_policy(&app);
        safety::eat_paths(&paths, permanent, policy.as_ref().map_err(|e| *e))
    })
    .await
    .unwrap_or_else(|_| EatReport {
        eaten: 0,
        refused: fallback
            .into_iter()
            .map(|name| Refused { name, reason: "something went wrong".into() })
            .collect(),
    })
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
