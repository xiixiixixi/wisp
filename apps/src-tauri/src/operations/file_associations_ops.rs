use crate::operations::validate_file_path;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;
use tauri::command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Application {
    pub name: String,
    pub path: String,
    pub icon: Option<String>,
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileAssociation {
    pub extension: String,
    pub mime_type: Option<String>,
    pub default_app: Option<Application>,
    pub available_apps: Vec<Application>,
}

#[command]
pub async fn get_file_associations(file_path: String) -> Result<FileAssociation, String> {
    let path = Path::new(&file_path);

    let extension = path
        .extension()
        .unwrap_or_default()
        .to_string_lossy()
        .to_lowercase();

    // Get MIME type
    let mime_type = get_mime_type_for_file(&file_path);

    // Get available applications for this file type
    let available_apps = get_available_applications(&extension, &file_path)?;

    // Determine default application
    let default_app = get_default_application(&extension, &file_path)?;

    Ok(FileAssociation {
        extension,
        mime_type,
        default_app,
        available_apps,
    })
}

#[command]
pub async fn open_file_with_application(file_path: String, app_path: String) -> Result<(), String> {
    validate_file_path(&file_path)?;
    validate_file_path(&app_path)?;
    let file_path = Path::new(&file_path);
    let app_path = Path::new(&app_path);

    if !file_path.exists() {
        return Err("File does not exist".to_string());
    }

    if !app_path.exists() {
        return Err("Application does not exist".to_string());
    }

    #[cfg(windows)]
    {
        let output = Command::new(app_path).arg(file_path).spawn();

        match output {
            Ok(_) => Ok(()),
            Err(e) => Err(format!("Failed to open file with application: {}", e)),
        }
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let output = Command::new(app_path).arg(file_path).spawn();

        match output {
            Ok(_) => Ok(()),
            Err(e) => Err(format!("Failed to open file with application: {}", e)),
        }
    }

    #[cfg(target_os = "macos")]
    {
        let output = Command::new("open")
            .arg("-a")
            .arg(app_path)
            .arg(file_path)
            .spawn();

        match output {
            Ok(_) => Ok(()),
            Err(e) => Err(format!("Failed to open file with application: {}", e)),
        }
    }
}

#[command]
pub async fn get_system_applications() -> Result<Vec<Application>, String> {
    #[cfg(windows)]
    {
        get_windows_applications()
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        get_unix_applications()
    }

    #[cfg(target_os = "macos")]
    {
        get_macos_applications()
    }
}

#[command]
pub async fn set_default_application(
    file_extension: String,
    app_path: String,
) -> Result<(), String> {
    // This is a complex operation that varies significantly by OS
    // For now, we'll provide a basic implementation

    #[cfg(windows)]
    {
        set_windows_default_application(&file_extension, &app_path)
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        set_unix_default_application(&file_extension, &app_path)
    }

    #[cfg(target_os = "macos")]
    {
        set_macos_default_application(&file_extension, &app_path)
    }
}

// Helper functions

fn get_mime_type_for_file(file_path: &str) -> Option<String> {
    let path = Path::new(file_path);

    if let Some(extension) = path.extension() {
        let ext = extension.to_string_lossy().to_lowercase();

        match ext.as_str() {
            // Images
            "jpg" | "jpeg" => Some("image/jpeg".to_string()),
            "png" => Some("image/png".to_string()),
            "gif" => Some("image/gif".to_string()),
            "bmp" => Some("image/bmp".to_string()),
            "webp" => Some("image/webp".to_string()),
            "svg" => Some("image/svg+xml".to_string()),

            // Documents
            "pdf" => Some("application/pdf".to_string()),
            "doc" => Some("application/msword".to_string()),
            "docx" => Some(
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    .to_string(),
            ),
            "txt" => Some("text/plain".to_string()),
            "md" => Some("text/markdown".to_string()),
            "html" | "htm" => Some("text/html".to_string()),

            // Audio
            "mp3" => Some("audio/mpeg".to_string()),
            "wav" => Some("audio/wav".to_string()),
            "ogg" => Some("audio/ogg".to_string()),

            // Video
            "mp4" => Some("video/mp4".to_string()),
            "avi" => Some("video/x-msvideo".to_string()),
            "mov" => Some("video/quicktime".to_string()),

            // Archives
            "zip" => Some("application/zip".to_string()),
            "rar" => Some("application/vnd.rar".to_string()),
            "7z" => Some("application/x-7z-compressed".to_string()),

            _ => None,
        }
    } else {
        None
    }
}

#[cfg(windows)]
fn get_windows_applications() -> Result<Vec<Application>, String> {
    let mut applications = Vec::new();

    // Common Windows applications
    let common_apps = vec![
        ("Notepad", "C:\\Windows\\System32\\notepad.exe"),
        ("Paint", "C:\\Windows\\System32\\mspaint.exe"),
        (
            "WordPad",
            "C:\\Program Files\\Windows NT\\Accessories\\wordpad.exe",
        ),
        ("Calculator", "C:\\Windows\\System32\\calc.exe"),
    ];

    for (name, path) in common_apps {
        if Path::new(path).exists() {
            applications.push(Application {
                name: name.to_string(),
                path: path.to_string(),
                icon: None,
                is_default: false,
            });
        }
    }

    // Try to find more applications by scanning common directories
    let program_dirs = vec!["C:\\Program Files", "C:\\Program Files (x86)"];

    for dir in program_dirs {
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                if entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false) {
                    let app_name = entry.file_name().to_string_lossy().to_string();
                    let app_dir = entry.path();

                    // Look for executable files in the application directory
                    if let Ok(app_entries) = std::fs::read_dir(&app_dir) {
                        for app_entry in app_entries.flatten() {
                            let app_path = app_entry.path();
                            if app_path
                                .extension()
                                .map(|ext| ext == "exe")
                                .unwrap_or(false)
                            {
                                applications.push(Application {
                                    name: app_name.clone(),
                                    path: app_path.to_string_lossy().to_string(),
                                    icon: None,
                                    is_default: false,
                                });
                                break; // Only take the first exe found in each directory
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(applications)
}

#[cfg(unix)]
#[allow(dead_code)]
fn get_unix_applications() -> Result<Vec<Application>, String> {
    let mut applications = Vec::new();

    // Parse .desktop files from common locations
    let desktop_dirs = vec![
        "/usr/share/applications",
        "/usr/local/share/applications",
        "~/.local/share/applications",
    ];

    for dir in desktop_dirs {
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                if entry
                    .path()
                    .extension()
                    .map(|ext| ext == "desktop")
                    .unwrap_or(false)
                {
                    if let Ok(app) = parse_desktop_file(&entry.path()) {
                        applications.push(app);
                    }
                }
            }
        }
    }

    Ok(applications)
}

#[cfg(target_os = "macos")]
fn get_macos_applications() -> Result<Vec<Application>, String> {
    let mut applications = Vec::new();

    // Scan /Applications directory
    if let Ok(entries) = std::fs::read_dir("/Applications") {
        for entry in entries.flatten() {
            if entry
                .path()
                .extension()
                .map(|ext| ext == "app")
                .unwrap_or(false)
            {
                let app_name = entry.file_name().to_string_lossy().to_string();
                let app_name = app_name.trim_end_matches(".app").to_string();

                applications.push(Application {
                    name: app_name,
                    path: entry.path().to_string_lossy().to_string(),
                    icon: None,
                    is_default: false,
                });
            }
        }
    }

    Ok(applications)
}

#[cfg(unix)]
#[allow(dead_code)]
fn parse_desktop_file(path: &Path) -> Result<Application, String> {
    let content =
        std::fs::read_to_string(path).map_err(|e| format!("Failed to read desktop file: {}", e))?;

    let mut name = String::new();
    let mut exec = String::new();
    let mut icon = None;

    for line in content.lines() {
        if line.starts_with("Name=") {
            name = line.strip_prefix("Name=").unwrap_or("").to_string();
        } else if line.starts_with("Exec=") {
            exec = line.strip_prefix("Exec=").unwrap_or("").to_string();
            // Remove %f, %u, etc. from exec line
            exec = exec.split_whitespace().next().unwrap_or("").to_string();
        } else if line.starts_with("Icon=") {
            icon = Some(line.strip_prefix("Icon=").unwrap_or("").to_string());
        }
    }

    if name.is_empty() || exec.is_empty() {
        return Err("Invalid desktop file".to_string());
    }

    Ok(Application {
        name,
        path: exec,
        icon,
        is_default: false,
    })
}

fn get_available_applications(
    extension: &str,
    _file_path: &str,
) -> Result<Vec<Application>, String> {
    #[cfg(target_os = "macos")]
    {
        // Real association list from LaunchServices (what Finder shows).
        let ls_apps = ls::apps_for_file(_file_path);
        if !ls_apps.is_empty() {
            return Ok(ls_apps);
        }
    }

    let mut apps = get_system_applications_sync()?;

    // Filter applications based on file type (this is a basic implementation)
    // In a real implementation, you would check OS-specific file associations
    match extension {
        "txt" | "md" | "log" => {
            apps.retain(|app| {
                app.name.to_lowercase().contains("notepad")
                    || app.name.to_lowercase().contains("editor")
                    || app.name.to_lowercase().contains("code")
                    || app.name.to_lowercase().contains("text")
            });
        }
        "jpg" | "jpeg" | "png" | "gif" | "bmp" => {
            apps.retain(|app| {
                app.name.to_lowercase().contains("paint")
                    || app.name.to_lowercase().contains("photo")
                    || app.name.to_lowercase().contains("image")
                    || app.name.to_lowercase().contains("viewer")
            });
        }
        _ => {
            // For unknown types, return common applications
        }
    }

    Ok(apps)
}

fn get_system_applications_sync() -> Result<Vec<Application>, String> {
    #[cfg(windows)]
    {
        get_windows_applications()
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        get_unix_applications()
    }

    #[cfg(target_os = "macos")]
    {
        get_macos_applications()
    }
}

fn get_default_application(
    _extension: &str,
    file_path: &str,
) -> Result<Option<Application>, String> {
    #[cfg(target_os = "macos")]
    {
        // LaunchServices: exactly the API Finder's 打开方式 menu consults.
        if let Some(app) = ls::default_app_for_file(file_path) {
            return Ok(Some(app));
        }
        Ok(None)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = file_path;
        Ok(None)
    }
}

/// LaunchServices + UTType FFI (deprecated but fully functional public C API
/// in CoreServices). This is the same backing store Finder uses, so writes
/// change the system-wide default immediately.
#[cfg(target_os = "macos")]
mod ls {
    use libloading::Library;
    use std::path::Path;

    const UTF8: u32 = 0x0800_0100;
    const K_LS_ROLES_ALL: u32 = 0xFFFF_FFFF;
    const CORE_SERVICES: &str =
        "/System/Library/Frameworks/CoreServices.framework/CoreServices";
    const APP_SERVICES: &str =
        "/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices";

    #[allow(non_camel_case_types)]
    type cfref = *const std::ffi::c_void;
    type FnRelease = unsafe extern "C" fn(cfref);
    type FnCount = unsafe extern "C" fn(cfref) -> isize;
    type FnAt = unsafe extern "C" fn(cfref, isize) -> cfref;

    fn core() -> &'static Library {
        static INIT: std::sync::OnceLock<&'static Library> = std::sync::OnceLock::new();
        *INIT.get_or_init(|| {
            let lib = unsafe { Library::new(CORE_SERVICES) }
                .or_else(|_| unsafe { Library::new(APP_SERVICES) })
                .expect("CoreServices load");
            Box::leak(Box::new(lib))
        })
    }

    fn symbol<T>(name: &[u8]) -> Option<libloading::Symbol<'static, T>> {
        // SAFETY: the Library is leaked ('static); symbols mirror the C API.
        unsafe { core().get::<T>(name) }.ok().map(|s| unsafe {
            std::mem::transmute::<libloading::Symbol<'_, T>, libloading::Symbol<'static, T>>(s)
        })
    }

    fn release(cf: cfref) {
        if let Some(f) = symbol::<FnRelease>(b"CFRelease\0") {
            unsafe { f(cf) };
        }
    }

    fn array_count(arr: cfref) -> isize {
        symbol::<FnCount>(b"CFArrayGetCount\0").map(|f| unsafe { f(arr) }).unwrap_or(0)
    }

    fn array_at(arr: cfref, i: isize) -> cfref {
        symbol::<FnAt>(b"CFArrayGetValueAtIndex\0")
            .map(|f| unsafe { f(arr, i) })
            .unwrap_or(std::ptr::null())
    }

    pub(crate) struct CfString(cfref);

    impl CfString {
        pub fn new(s: &str) -> CfString {
            type FnNew = unsafe extern "C" fn(cfref, *const std::ffi::c_char, u32) -> cfref;
            type FnLen = unsafe extern "C" fn(cfref) -> isize;
            type FnGet = unsafe extern "C" fn(cfref, *mut std::ffi::c_char, isize, u32) -> bool;
            let f = symbol::<FnNew>(b"CFStringCreateWithCString\0").unwrap();
            let cs = std::ffi::CString::new(s).unwrap();
            let this = CfString(unsafe { f(std::ptr::null(), cs.as_ptr(), UTF8) });
            this
        }

        fn from_raw(raw: cfref) -> CfString {
            CfString(raw)
        }

        pub fn to_rust(&self) -> Option<String> {
            type FnLen = unsafe extern "C" fn(cfref) -> isize;
            type FnGet = unsafe extern "C" fn(cfref, *mut std::ffi::c_char, isize, u32) -> bool;
            let flen = symbol::<FnLen>(b"CFStringGetLength\0")?;
            let fget = symbol::<FnGet>(b"CFStringGetCString\0")?;
            let mut buf = vec![0i8; (unsafe { flen(self.0) } as usize) * 4 + 8];
            if unsafe { fget(self.0, buf.as_mut_ptr(), buf.len() as isize, UTF8) } {
                let bytes =
                    unsafe { std::slice::from_raw_parts(buf.as_ptr() as *const u8, buf.len()) };
                let end = bytes.iter().position(|&b| b == 0).unwrap_or(bytes.len());
                Some(String::from_utf8_lossy(&bytes[..end]).into_owned())
            } else {
                None
            }
        }
    }

    impl Drop for CfString {
        fn drop(&mut self) {
            release(self.0);
        }
    }

    /// App bundle display info via plutil (display name + bundle id).
    fn bundle_info(app_path: &str) -> (String, String) {
        let name = Path::new(app_path)
            .file_stem()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "Application".into());
        let mut id = String::new();
        if let Ok(out) = std::process::Command::new("/usr/bin/plutil")
            .args([
                "-convert",
                "json",
                "-o",
                "-",
                &format!("{app_path}/Contents/Info.plist"),
            ])
            .output()
        {
            if out.status.success() {
                if let Ok(v) = serde_json::from_slice::<serde_json::Value>(&out.stdout) {
                    id = v
                        .get("CFBundleIdentifier")
                        .and_then(|x| x.as_str())
                        .unwrap_or("")
                        .to_string();
                }
            }
        }
        (name, id)
    }

    fn url_to_path(url: cfref) -> Option<String> {
        type FnRep = unsafe extern "C" fn(cfref, bool, *mut u8, isize) -> bool;
        let f = symbol::<FnRep>(b"CFURLGetFileSystemRepresentation\0")?;
        let mut buf = [0u8; 4096];
        if unsafe { f(url, true, buf.as_mut_ptr(), buf.len() as isize) } {
            let end = buf.iter().position(|&b| b == 0).unwrap_or(buf.len());
            Some(String::from_utf8_lossy(&buf[..end]).into_owned())
        } else {
            None
        }
    }

    struct FileUrl {
        _s: CfString,
        url: cfref,
    }

    impl FileUrl {
        fn new(path: &str) -> Option<FileUrl> {
            type FnUrl = unsafe extern "C" fn(cfref, cfref, isize, bool) -> cfref;
            let f = symbol::<FnUrl>(b"CFURLCreateWithFileSystemPath\0")?;
            let s = CfString::new(path);
            let url = unsafe { f(std::ptr::null(), s.0, 0, Path::new(path).is_dir()) };
            if url.is_null() {
                None
            } else {
                Some(FileUrl { _s: s, url })
            }
        }
    }

    impl Drop for FileUrl {
        fn drop(&mut self) {
            release(self.url);
        }
    }

    fn app_at(url_path: &str, is_default: bool) -> super::Application {
        let (name, _id) = bundle_info(url_path);
        super::Application {
            name,
            path: url_path.to_string(),
            icon: None,
            is_default,
        }
    }

    /// The system default app for one concrete file (Finder truth).
    pub(crate) fn default_app_for_file(path: &str) -> Option<super::Application> {
        type FnDef = unsafe extern "C" fn(cfref, u32) -> cfref;
        let f = symbol::<FnDef>(b"LSCopyDefaultApplicationURLForURL\0")?;
        let fu = FileUrl::new(path)?;
        let app_url = unsafe { f(fu.url, K_LS_ROLES_ALL) };
        if app_url.is_null() {
            return None;
        }
        let result = url_to_path(app_url).map(|p| app_at(&p, true));
        release(app_url);
        result
    }

    /// All apps LaunchServices declares able to open this file.
    pub(crate) fn apps_for_file(path: &str) -> Vec<super::Application> {
        type FnApps = unsafe extern "C" fn(cfref, u32) -> cfref;
        let f = match symbol::<FnApps>(b"LSCopyApplicationURLsForURL\0") {
            Some(f) => f,
            None => return Vec::new(),
        };
        let fu = match FileUrl::new(path) {
            Some(v) => v,
            None => return Vec::new(),
        };
        let arr = unsafe { f(fu.url, K_LS_ROLES_ALL) };
        if arr.is_null() {
            return Vec::new();
        }
        let mut out = Vec::new();
        for i in 0..array_count(arr) {
            let item = array_at(arr, i);
            if !item.is_null() {
                if let Some(p) = url_to_path(item) {
                    out.push(app_at(&p, false));
                }
            }
        }
        release(arr);
        out
    }

    /// System-wide "open with" default. LSSetDefaultRoleHandlerForContentType
    /// silently no-ops on modern macOS, so write the per-user LSHandlers
    /// binding directly (the duti/SwiftDefaultApps technique) and bounce lsd
    /// so Finder and every app see the change immediately.
    pub(crate) fn set_default_for_extension(ext: &str, app_path: &str) -> Result<(), String> {
        type FnUti = unsafe extern "C" fn(cfref, cfref, cfref) -> cfref;
        let (_, bundle_id) = bundle_info(app_path);
        if bundle_id.is_empty() {
            return Err("app bundle id unreadable".into());
        }
        let f_uti = symbol::<FnUti>(b"UTTypeCreatePreferredIdentifierForTag\0")
            .ok_or_else(|| "UTType FFI missing".to_string())?;
        let tag_class = CfString::new("public.filename-extension");
        let ext_str = CfString::new(ext);
        let uti_raw = unsafe { f_uti(tag_class.0, ext_str.0, std::ptr::null()) };
        if uti_raw.is_null() {
            return Err("no UTI for extension".into());
        }
        let uti = CfString::from_raw(uti_raw).to_rust().ok_or("UTI decode failed")?;

        let plist = format!(
            "{}/Library/Preferences/com.apple.LaunchServices/com.apple.launchservices.secure.plist",
            std::env::var("HOME").map_err(|_| "no HOME")?
        );
        let existing = std::process::Command::new("/usr/bin/plutil")
            .args(["-convert", "json", "-o", "-", &plist])
            .output()
            .map_err(|e| format!("plutil read failed: {e}"))?;
        let mut doc: serde_json::Value = if existing.status.success() {
            serde_json::from_slice(&existing.stdout).unwrap_or_else(|_| serde_json::json!({}))
        } else {
            serde_json::json!({})
        };

        let entry = serde_json::json!({
            "LSHandlerContentType": uti,
            "LSHandlerRoleAll": bundle_id,
            "LSHandlerPreferredVersions": { "LSHandlerRoleAll": "-" },
        });
        let handlers = doc
            .as_object_mut()
            .ok_or("unexpected LSHandlers shape")?
            .entry("LSHandlers")
            .or_insert_with(|| serde_json::json!([]));
        if let Some(arr) = handlers.as_array_mut() {
            arr.retain(|h| h.get("LSHandlerContentType").and_then(|v| v.as_str()) != Some(&uti));
            arr.push(entry);
        }

        let tmp = std::env::temp_dir().join("wisp-lshandlers.json");
        std::fs::write(&tmp, serde_json::to_vec(&doc).map_err(|e| e.to_string())?)
            .map_err(|e| format!("tmp write failed: {e}"))?;
        let conv = std::process::Command::new("/usr/bin/plutil")
            .args(["-convert", "binary1", "-o", &plist, tmp.to_string_lossy().as_ref()])
            .output()
            .map_err(|e| format!("plutil write failed: {e}"))?;
        let _ = std::fs::remove_file(&tmp);
        if !conv.status.success() {
            return Err(format!(
                "plutil convert failed: {}",
                String::from_utf8_lossy(&conv.stderr)
            ));
        }
        // Bounce the LaunchServices daemon so the binding is picked up.
        let _ = std::process::Command::new("/usr/bin/killall").arg("lsd").output();
        Ok(())
    }
}

#[cfg(windows)]
fn set_windows_default_application(_extension: &str, _app_path: &str) -> Result<(), String> {
    // This would require registry manipulation on Windows
    // For security reasons, we'll return an error for now
    Err("Setting default applications is not supported in this version".to_string())
}

#[cfg(unix)]
#[allow(dead_code)]
fn set_unix_default_application(_extension: &str, _app_path: &str) -> Result<(), String> {
    // This would require updating .desktop associations
    // For security reasons, we'll return an error for now
    Err("Setting default applications is not supported in this version".to_string())
}

#[cfg(target_os = "macos")]
fn set_macos_default_application(extension: &str, app_path: &str) -> Result<(), String> {
    ls::set_default_for_extension(extension, app_path)
}

#[cfg(test)]
mod ls_tests {
    use super::ls;

    #[test]
    fn set_default_round_trips_through_launchservices() {
        // Declared extension (txt -> public.plain-text): write the CURRENT
        // default back so the system setting is untouched by the test, then
        // verify the read-back agrees.
        let probe = std::env::temp_dir().join("probe.txt");
        std::fs::write(&probe, b"x").unwrap();
        let current = ls::default_app_for_file(probe.to_string_lossy().as_ref())
            .expect("txt default should resolve");
        ls::set_default_for_extension("txt", &current.path).expect("set default should succeed");
        let def = ls::default_app_for_file(probe.to_string_lossy().as_ref()).unwrap();
        assert_eq!(def.path, current.path);
        let _ = std::fs::remove_file(&probe);
    }

    // Real switch: txt -> Script Editor -> verify -> restore TextEdit.
    // Manual/E2E only (`--ignored`) because it mutates system state briefly.
    #[test]
    #[ignore]
    fn switches_default_and_restores() {
        let probe = std::env::temp_dir().join("probe.txt");
        std::fs::write(&probe, b"x").unwrap();
        let p = probe.to_string_lossy().into_owned();
        let original = ls::default_app_for_file(&p).expect("original default");

        ls::set_default_for_extension("txt", "/System/Applications/Utilities/Script Editor.app")
            .expect("switch should succeed");
        // lsd just bounced; in-process LS clients need a moment to re-resolve.
        let mut switched = None;
        for _ in 0..20 {
            std::thread::sleep(std::time::Duration::from_millis(250));
            if let Some(def) = ls::default_app_for_file(&p) {
                if def.path.contains("Script Editor") {
                    switched = Some(def);
                    break;
                }
                switched = Some(def);
            }
        }
        let switched = switched.expect("switched default");
        assert!(
            switched.path.contains("Script Editor"),
            "got {}",
            switched.path
        );

        ls::set_default_for_extension("txt", &original.path).expect("restore should succeed");
        let restored = ls::default_app_for_file(&p).unwrap();
        assert_eq!(restored.path, original.path);
        let _ = std::fs::remove_file(&probe);
    }

    #[test]
    fn default_app_resolves_for_common_type() {
        // Read-only LaunchServices queries on a guaranteed-existing file.
        let home = std::env::temp_dir().join("wisp-ls-probe.txt");
        std::fs::write(&home, b"probe").unwrap();
        let path = home.to_string_lossy().into_owned();
        let default = ls::default_app_for_file(&path);
        assert!(default.is_some(), "txt default app should resolve");
        println!("default for txt: {:?}", default.unwrap().name);
        let apps = ls::apps_for_file(&path);
        assert!(!apps.is_empty(), "apps-for-file should list candidates");
        println!("apps: {:?}", apps.iter().map(|a| a.name.clone()).take(5).collect::<Vec<_>>());
        let _ = std::fs::remove_file(&home);
    }
}
