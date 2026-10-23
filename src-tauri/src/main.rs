// Wortweg als Desktop-App: zeigt die fertige App-Version (dist/, offline, ohne Konto) in einem eigenen Fenster.
// Links ins Internet öffnen im normalen Browser, damit das Fenster immer Wortweg bleibt; exportierte Dateien landen im
// Download-Ordner. Die App selbst braucht keine Tauri-Schnittstellen (kein IPC, keine Plugins).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::PathBuf;

use tauri::webview::{DownloadEvent, NewWindowResponse, WebviewWindowBuilder};
use tauri::{Manager, Url, WebviewUrl};

/// Öffentliche App-Version: Ziel für eigene Dateien, die die App in einem neuen Fenster öffnen will (z. B. Lizenztexte).
const WEBSITE: &str = "https://aprael.github.io/wortweg/";

/// Seiten der App selbst: macOS tauri://localhost, Windows http://tauri.localhost.
fn is_app(url: &Url) -> bool {
    url.scheme() == "tauri" || url.host_str() == Some("tauri.localhost")
}

/// Adresse für den normalen Browser: fremde Seiten unverändert, eigene Dateien von der Website.
fn browser_target(url: &Url) -> Option<String> {
    if is_app(url) {
        return Some(format!("{WEBSITE}{}", url.path().trim_start_matches('/')));
    }
    matches!(url.scheme(), "http" | "https" | "mailto").then(|| url.to_string())
}

/// Freier Dateiname im Download-Ordner („name (2).json“, falls es „name.json“ schon gibt).
fn free_path(dir: PathBuf, name: &str) -> PathBuf {
    let path = dir.join(name);
    if !path.exists() {
        return path;
    }
    let (stem, ext) = name.rsplit_once('.').unwrap_or((name, ""));
    (2..)
        .map(|n| dir.join(if ext.is_empty() { format!("{stem} ({n})") } else { format!("{stem} ({n}).{ext}") }))
        .find(|p| !p.exists())
        .unwrap()
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("Wortweg")
                .inner_size(1100.0, 800.0)
                .min_inner_size(360.0, 560.0)
                .on_navigation(|url| {
                    if is_app(url) || matches!(url.scheme(), "about" | "blob" | "data") {
                        return true;
                    }
                    if let Some(target) = browser_target(url) {
                        let _ = open::that_detached(target);
                    }
                    false
                })
                .on_new_window(|url, _features| {
                    if let Some(target) = browser_target(&url) {
                        let _ = open::that_detached(target);
                    }
                    NewWindowResponse::Deny
                })
                .on_download(|webview, event| {
                    if let DownloadEvent::Requested { destination, .. } = event {
                        let name = destination
                            .file_name()
                            .and_then(|n| n.to_str())
                            .filter(|n| !n.is_empty())
                            .unwrap_or("wortweg-fortschritt.json")
                            .to_string();
                        let Ok(dir) = webview.app_handle().path().download_dir() else {
                            return false;
                        };
                        *destination = free_path(dir, &name);
                    }
                    true
                })
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Wortweg konnte nicht starten");
}
