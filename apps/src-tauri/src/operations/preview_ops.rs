// Finder-parity preview bridges.
//
// Everything here leans on the same macOS frameworks Quick Look itself uses:
//   sips      — ImageIO: HEIC/HEIF/RAW/PSD/… → JPEG (EXIF orientation applied)
//   textutil  — NSAttributedString: doc/docx/rtf/rtfd/odt/webarchive → HTML
//   plutil    — binary plists/.strings → XML
//   qlmanage  — Quick Look thumbnails for anything Finder can preview
// Converted artefacts are cached under app_data_dir/preview-cache, keyed by
// path + mtime + size so repeated selections are instant. All artefacts live
// inside the `$APPDATA/**` asset-protocol scope so the webview can load them.

use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::Manager;

const CACHE_DIR_NAME: &str = "preview-cache";
const MAX_SNIFF_BYTES: usize = 64 * 1024;

fn cache_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app data dir unavailable: {e}"))?
        .join(CACHE_DIR_NAME);
    std::fs::create_dir_all(&dir).map_err(|e| format!("failed to create preview cache: {e}"))?;
    Ok(dir)
}

/// Stable cache key for a source file + conversion kind + parameters.
fn cache_key(path: &str, kind: &str, params: &str) -> String {
    let (mtime, size) = std::fs::metadata(path)
        .map(|m| {
            (
                m.modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs())
                    .unwrap_or(0),
                m.len(),
            )
        })
        .unwrap_or((0, 0));
    let mut hasher = Sha256::new();
    hasher.update(path.as_bytes());
    hasher.update(kind.as_bytes());
    hasher.update(params.as_bytes());
    hasher.update(mtime.to_le_bytes());
    hasher.update(size.to_le_bytes());
    format!("{:x}", hasher.finalize())
}

async fn run_tool(cmd: &mut tokio::process::Command, timeout: Duration) -> Result<bool, String> {
    cmd.stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    match tokio::time::timeout(timeout, cmd.status()).await {
        Ok(Ok(status)) => Ok(status.success()),
        Ok(Err(e)) => Err(format!("spawn failed: {e}")),
        Err(_) => Err("timed out".to_string()),
    }
}

/// Convert an image the webview cannot decode natively (HEIC, camera RAW,
/// PSD, PICT, …) into a downscaled JPEG via ImageIO (`sips`). Falls back to a
/// Quick Look thumbnail when ImageIO refuses the format.
#[tauri::command]
pub async fn preview_convert_image(
    app: tauri::AppHandle,
    path: String,
    max_dim: u32,
) -> Result<Option<String>, String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, max_dim);
        return Ok(None);
    }
    #[cfg(target_os = "macos")]
    {
        if !Path::new(&path).is_file() {
            return Ok(None);
        }
        let max_dim = max_dim.clamp(256, 4096);
        let dir = cache_dir(&app)?;
        let key = cache_key(&path, "img", &max_dim.to_string());
        let out = dir.join(format!("{key}.jpg"));
        if out.exists() {
            return Ok(Some(out.to_string_lossy().into_owned()));
        }

        let sips_ok = run_tool(
            tokio::process::Command::new("/usr/bin/sips")
                .arg("-s")
                .arg("format")
                .arg("jpeg")
                .arg("--resampleHeightWidthMax")
                .arg(max_dim.to_string())
                .arg(&path)
                .arg("--out")
                .arg(&out),
            Duration::from_secs(60),
        )
        .await
        .unwrap_or(false);

        if sips_ok && out.exists() {
            return Ok(Some(out.to_string_lossy().into_owned()));
        }
        let _ = std::fs::remove_file(&out);

        // ImageIO could not read it — let Quick Look render the first frame.
        ql_thumbnail_in(&app, &path, max_dim, &dir, "imgql", &key).await
    }
}

/// Convert a text document (doc, docx, rtf, rtfd, odt, webarchive) to HTML
/// with `textutil`. The generated HTML references extracted images by plain
/// file name, so both land in the same cache directory.
#[tauri::command]
pub async fn preview_doc_html(app: tauri::AppHandle, path: String) -> Result<Option<String>, String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        return Ok(None);
    }
    #[cfg(target_os = "macos")]
    {
        if !Path::new(&path).is_file() {
            return Ok(None);
        }
        let dir = cache_dir(&app)?;
        let key = cache_key(&path, "dochtml", "");
        let out = dir.join(format!("{key}.html"));
        if out.exists() {
            return Ok(Some(out.to_string_lossy().into_owned()));
        }

        let ok = run_tool(
            tokio::process::Command::new("/usr/bin/textutil")
                .arg("-convert")
                .arg("html")
                .arg("-output")
                .arg(&out)
                .arg(&path),
            Duration::from_secs(30),
        )
        .await
        .unwrap_or(false);

        if ok && out.exists() {
            // Drop stale artefacts from previous conversions of other files so
            // the cache directory cannot grow without bound.
            cleanup_cache(&dir, 200);
            Ok(Some(out.to_string_lossy().into_owned()))
        } else {
            let _ = std::fs::remove_file(&out);
            Ok(None)
        }
    }
}

/// Convert an XML or binary plist (and .strings) into readable XML text.
#[tauri::command]
pub async fn preview_plist_xml(path: String) -> Result<String, String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = path;
        return Err("plist preview requires macOS".to_string());
    }
    #[cfg(target_os = "macos")]
    {
        let output = tokio::process::Command::new("/usr/bin/plutil")
            .arg("-convert")
            .arg("xml1")
            .arg("-o")
            .arg("-")
            .arg(&path)
            .stdin(std::process::Stdio::null())
            .output()
            .await
            .map_err(|e| format!("plutil failed to start: {e}"))?;
        if output.status.success() {
            String::from_utf8(output.stdout)
                .map(|s| s.trim_end().to_string())
                .map_err(|_| "plist output was not valid UTF-8".to_string())
        } else {
            Err("not a valid property list".to_string())
        }
    }
}

/// Read a media file for preview over the RAW binary IPC channel. The
/// generic read_binary_file is capped at 500MB and JSON-serializes Vec<u8>;
/// previews need up to ~2GB (remuxed movies) at wire speed.
#[tauri::command]
pub async fn preview_read_media(path: String) -> Result<tauri::ipc::Response, String> {
    tokio::task::spawn_blocking(move || -> Result<tauri::ipc::Response, String> {
        let meta = std::fs::metadata(&path).map_err(|e| format!("stat failed: {e}"))?;
        if meta.len() > 2_500_000_000 {
            return Err("media too large for in-memory preview".to_string());
        }
        let bytes = std::fs::read(&path).map_err(|e| format!("read failed: {e}"))?;
        Ok(tauri::ipc::Response::new(bytes))
    })
    .await
    .map_err(|e| format!("task join error: {e}"))?
}

/// Remux a video whose CONTAINER WebKit/AVFoundation cannot open (avi, mkv,
/// wmv, flv, mpeg-ps…) into mp4 with stream copy — no transcoding, so a 1GB
/// avi takes only disk I/O. Returns the cached mp4 path, or None when ffmpeg
/// is missing / the streams cannot be copied into mp4 (caller falls back to
/// the Quick Look poster).
#[tauri::command]
pub async fn preview_remux_media(app: tauri::AppHandle, path: String) -> Result<Option<String>, String> {
    if !Path::new(&path).is_file() {
        return Ok(None);
    }
    let ffmpeg = ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"]
        .iter()
        .find(|p| Path::new(p).exists())
        .map(|p| p.to_string())
        .or_else(|| {
            // Fall back to whatever `ffmpeg` resolves to via PATH.
            std::process::Command::new("which")
                .arg("ffmpeg")
                .output()
                .ok()
                .filter(|o| o.status.success())
                .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
                .filter(|s| !s.is_empty())
        });
    let Some(ffmpeg) = ffmpeg else {
        return Ok(None);
    };

    let dir = cache_dir(&app)?;
    let key = cache_key(&path, "remux", "");
    let out = dir.join(format!("{key}.remux.mp4"));
    if out.exists() {
        return Ok(Some(out.to_string_lossy().into_owned()));
    }

    // ffmpeg -c copy fails outright when a stream cannot live in mp4 (e.g.
    // old DivX), which is exactly the "give up → poster" signal.
    let out_str = out.to_string_lossy().into_owned();
    let ok = run_tool(
        tokio::process::Command::new(&ffmpeg)
            .arg("-y")
            .arg("-hide_banner")
            .arg("-loglevel")
            .arg("error")
            .arg("-i")
            .arg(&path)
            .arg("-c")
            .arg("copy")
            .arg("-movflags")
            .arg("+faststart")
            .arg(&out_str),
        Duration::from_secs(300),
    )
    .await
    .unwrap_or(false);

    if ok && out.exists() && std::fs::metadata(&out).map(|m| m.len() > 1024).unwrap_or(false) {
        cleanup_cache(&dir, 40);
        Ok(Some(out_str))
    } else {
        let _ = std::fs::remove_file(&out);
        Ok(None)
    }
}

/// One chapter of an unpacked EPUB: the href is relative to the epub root so
/// the webview can load `base_dir + "/" + href` through the asset protocol.
#[derive(serde::Serialize)]
pub struct EpubChapter {
    pub href: String,
    pub title: String,
}

#[derive(serde::Serialize)]
pub struct EpubInfo {
    pub base_dir: String,
    pub chapters: Vec<EpubChapter>,
}

/// Unpack an EPUB (a zip of XHTML + assets) into the preview cache and
/// resolve its reading order: container.xml → OPF → manifest + spine, with
/// chapter titles from the epub3 nav document or the epub2 toc.ncx.
#[tauri::command]
pub async fn preview_epub(app: tauri::AppHandle, path: String) -> Result<Option<EpubInfo>, String> {
    if !Path::new(&path).is_file() {
        return Ok(None);
    }
    let dir = cache_dir(&app)?;
    let key = cache_key(&path, "epub", "");
    let out_dir = dir.join(format!("{key}.epub"));
    if !out_dir.join("META-INF").exists() {
        let src = path.clone();
        let out_dir_str = out_dir.to_string_lossy().into_owned();
        let unpacked = tokio::task::spawn_blocking(move || -> Result<(), String> {
            let file =
                std::fs::File::open(&src).map_err(|e| format!("open failed: {e}"))?;
            let mut archive =
                zip::ZipArchive::new(file).map_err(|e| format!("not a readable epub: {e}"))?;
            // Zip-slip protection mirrors compression/zip_ops.rs: skip any
            // entry with parent references, strip leading slashes.
            for i in 0..archive.len() {
                let mut entry = archive
                    .by_index(i)
                    .map_err(|e| format!("entry read failed: {e}"))?;
                let raw_name = entry.name().to_string();
                if raw_name.contains("..") {
                    continue;
                }
                let safe_name = raw_name
                    .trim_start_matches('/')
                    .trim_start_matches('\\')
                    .to_string();
                if safe_name.is_empty() {
                    continue;
                }
                let outpath = Path::new(&out_dir_str).join(&safe_name);
                if entry.is_dir() {
                    std::fs::create_dir_all(&outpath)
                        .map_err(|e| format!("mkdir failed: {e}"))?;
                } else {
                    if let Some(parent) = outpath.parent() {
                        std::fs::create_dir_all(parent)
                            .map_err(|e| format!("mkdir failed: {e}"))?;
                    }
                    let mut out_file = std::fs::File::create(&outpath)
                        .map_err(|e| format!("create failed: {e}"))?;
                    std::io::copy(&mut entry, &mut out_file)
                        .map_err(|e| format!("copy failed: {e}"))?;
                }
            }
            Ok(())
        })
        .await
        .map_err(|e| format!("task join error: {e}"))?;
        unpacked?;
        cleanup_cache(&dir, 200);
    }

    let base_dir = out_dir.to_string_lossy().into_owned();
    let info = tokio::task::spawn_blocking(move || parse_epub(&out_dir))
        .await
        .map_err(|e| format!("task join error: {e}"))?;
    match info {
        Ok(chapters) if !chapters.is_empty() => Ok(Some(EpubInfo { base_dir, chapters })),
        _ => Ok(None),
    }
}

/// Attribute value from an XML tag body, tolerant of attribute order.
fn xml_attr(tag: &str, name: &str) -> Option<String> {
    let pat = format!("{name}=\"");
    let start = tag.find(&pat)? + pat.len();
    let rest = &tag[start..];
    let end = rest.find('"')?;
    Some(urlencoding::decode(&rest[..end]).ok()?.to_string())
}

/// Join an OPF-relative href onto the OPF's own directory.
fn rel_from(opf_dir: &str, href: &str) -> String {
    if href.starts_with('/') {
        return href.trim_start_matches('/').to_string();
    }
    // Tiny path join: OPFs sit at most one or two levels deep.
    let mut parts: Vec<&str> = opf_dir
        .split('/')
        .filter(|p| !p.is_empty() && *p != ".")
        .collect();
    for seg in href.split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            _ => parts.push(seg),
        }
    }
    parts.join("/")
}

fn parse_epub(root: &Path) -> Result<Vec<EpubChapter>, String> {
    let container = std::fs::read_to_string(root.join("META-INF/container.xml"))
        .map_err(|e| format!("container.xml unreadable: {e}"))?;
    // NB: `<rootfiles>` shares the `<rootfile` prefix, so locate the
    // full-path attribute directly instead of splitting on the tag name.
    let opf_path = container
        .find("full-path=\"")
        .and_then(|pos| xml_attr(&container[pos..], "full-path"))
        .ok_or_else(|| "no rootfile in container.xml".to_string())?;
    let opf = std::fs::read_to_string(root.join(&opf_path))
        .map_err(|e| format!("OPF unreadable: {e}"))?;
    let opf_dir = opf_path.rsplit_once('/').map(|(d, _)| d.to_string()).unwrap_or_default();

    // manifest: id → (href, media-type, properties)
    let mut hrefs: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    let mut ncx_href: Option<String> = None;
    let mut nav_href: Option<String> = None;
    for tag in opf.split("<item").skip(1) {
        let body = &tag[..tag.find('>').unwrap_or(tag.len())];
        let (Some(id), Some(href)) = (xml_attr(body, "id"), xml_attr(body, "href")) else {
            continue;
        };
        let media_type = xml_attr(body, "media-type").unwrap_or_default();
        let properties = xml_attr(body, "properties").unwrap_or_default();
        if media_type == "application/x-dtbncx+xml" {
            ncx_href = Some(href.clone());
        }
        if properties.split_whitespace().any(|p| p == "nav") {
            nav_href = Some(href.clone());
        }
        hrefs.insert(id, href);
    }

    // spine order
    let mut spine_ids: Vec<String> = Vec::new();
    for tag in opf.split("<itemref").skip(1) {
        let body = &tag[..tag.find('>').unwrap_or(tag.len())];
        if let Some(idref) = xml_attr(body, "idref") {
            spine_ids.push(idref);
        }
    }
    let spine_hrefs: Vec<String> = spine_ids
        .iter()
        .filter_map(|id| hrefs.get(id).cloned())
        .map(|h| rel_from(&opf_dir, &h))
        .collect();

    // titles: prefer epub3 nav document, fall back to toc.ncx, then 第N章.
    let mut titles: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    let title_source = nav_href
        .map(|h| root.join(rel_from(&opf_dir, &h)))
        .filter(|p| p.exists())
        .map(|p| (p, true))
        .or_else(|| {
            ncx_href.map(|h| root.join(rel_from(&opf_dir, &h))).map(|p| (p, false))
        });
    if let Some((toc_path, is_nav)) = title_source {
        if let Ok(text) = std::fs::read_to_string(&toc_path) {
            if is_nav {
                // <a href="...">Label</a>
                let mut cursor = 0usize;
                while let Some(pos) = text[cursor..].find("<a ") {
                    let tag_start = cursor + pos;
                    let tag_end = tag_start + text[tag_start..].find('>').unwrap_or(0) + 1;
                    let body = &text[tag_start..tag_end];
                    if let Some(href) = xml_attr(body, "href") {
                        let label_end = text[tag_end..].find("</a>").map(|e| tag_end + e);
                        if let Some(le) = label_end {
                            let label = text[tag_end..le]
                                .replace("<span>", "")
                                .replace("</span>", "")
                                .trim()
                                .to_string();
                            let clean = rel_from(&opf_dir, &href);
                            titles
                                .entry(clean)
                                .or_insert_with(|| html_text(&label));
                        }
                    }
                    cursor = tag_end.max(cursor + 1);
                }
            } else {
                // toc.ncx: navPoint blocks pairing <text> with <content src>
                for block in text.split("<navPoint").skip(1) {
                    let text_label = block
                        .split("<text>")
                        .nth(1)
                        .and_then(|t| t.split("</text>").next())
                        .map(|t| t.trim().to_string());
                    let src = block
                        .split("<content")
                        .nth(1)
                        .and_then(|c| {
                            let end = c.find('>')?;
                            xml_attr(&c[..end], "src")
                        });
                    if let (Some(label), Some(src)) = (text_label, src) {
                        let clean = rel_from(&opf_dir, &src);
                        titles.entry(clean).or_insert_with(|| html_text(&label));
                    }
                }
            }
        }
    }

    // Empty titles are fine — the UI shows a localized 第N章 fallback.
    Ok(spine_hrefs
        .into_iter()
        .map(|href| {
            let title = titles.get(&href).cloned().unwrap_or_default();
            EpubChapter { href, title }
        })
        .collect())
}

/// Strip the handful of entities that appear in epub titles.
fn html_text(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
}

/// Extract the embedded QuickLook/Preview.pdf that iWork documents ship for
/// exactly this purpose (Pages/Numbers/Keynote), so the webview's native PDF
/// viewer can render the full document.
#[tauri::command]
pub async fn preview_iwork_pdf(app: tauri::AppHandle, path: String) -> Result<Option<String>, String> {
    if !Path::new(&path).is_file() {
        return Ok(None);
    }
    let dir = cache_dir(&app)?;
    let key = cache_key(&path, "iworkpdf", "");
    let out = dir.join(format!("{key}.pdf"));
    if out.exists() {
        return Ok(Some(out.to_string_lossy().into_owned()));
    }

    let out_str = out.to_string_lossy().into_owned();
    let path_str = path.clone();
    let extract = tokio::task::spawn_blocking(move || -> Result<bool, String> {
        let file = std::fs::File::open(&path_str).map_err(|e| format!("open failed: {e}"))?;
        let mut archive =
            zip::ZipArchive::new(file).map_err(|e| format!("not a readable iWork zip: {e}"))?;
        let preview_name = ["QuickLook/Preview.pdf", "QuickLook/preview.pdf"]
            .iter()
            .find(|n| archive.file_names().any(|f| f == **n))
            .ok_or_else(|| "no embedded QuickLook preview".to_string())?;
        let mut entry = archive
            .by_name(preview_name)
            .map_err(|_| "no embedded QuickLook preview".to_string())?;
        let mut bytes = Vec::new();
        std::io::Read::read_to_end(&mut entry, &mut bytes)
            .map_err(|e| format!("read failed: {e}"))?;
        if !bytes.starts_with(b"%PDF") {
            return Err("embedded preview is not a PDF".to_string());
        }
        std::fs::write(&out_str, bytes).map_err(|e| format!("write failed: {e}"))?;
        Ok(true)
    })
    .await
    .map_err(|e| format!("task join error: {e}"))?;

    match extract {
        Ok(true) => {
            cleanup_cache(&dir, 200);
            Ok(Some(out.to_string_lossy().into_owned()))
        }
        _ => {
            let _ = std::fs::remove_file(&out);
            Ok(None)
        }
    }
}

/// Quick Look thumbnail for formats with no dedicated web previewer
/// (ppt/pptx, usdz, icc, video posters, …). This is literally the engine
/// Finder uses, so whatever previews in Finder produces a thumbnail here.
#[tauri::command]
pub async fn preview_ql_thumbnail(
    app: tauri::AppHandle,
    path: String,
    size: u32,
) -> Result<Option<String>, String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, size);
        return Ok(None);
    }
    #[cfg(target_os = "macos")]
    {
        if !Path::new(&path).is_file() {
            return Ok(None);
        }
        let dir = cache_dir(&app)?;
        let size = size.clamp(64, 2560);
        let key = cache_key(&path, "ql", &size.to_string());
        ql_thumbnail_in(&app, &path, size, &dir, "ql", &key).await
    }
}

#[cfg(target_os = "macos")]
async fn ql_thumbnail_in(
    app: &tauri::AppHandle,
    path: &str,
    size: u32,
    dir: &Path,
    kind: &str,
    key: &str,
) -> Result<Option<String>, String> {
    let _ = app;
    // Content-keyed destination: hitting this path means the artefact is fresh
    // (key includes mtime + size), so no qlmanage round-trip is needed.
    let final_path = dir.join(format!("{key}.{kind}.png"));
    if final_path.exists() {
        return Ok(Some(final_path.to_string_lossy().into_owned()));
    }
    let expected = dir.join(format!(
        "{}.png",
        Path::new(path)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default()
    ));

    let ok = run_tool(
        tokio::process::Command::new("/usr/bin/qlmanage")
            .arg("-t")
            .arg("-s")
            .arg(size.to_string())
            .arg("-o")
            .arg(dir)
            .arg(path),
        Duration::from_secs(45),
    )
    .await
    .unwrap_or(false);

    if ok && expected.exists() {
        // qlmanage names output <basename>.png; rename to the content key so
        // the mtime-keyed cache check above cannot serve a stale thumbnail.
        match std::fs::rename(&expected, &final_path) {
            Ok(()) => {
                cleanup_cache(dir, 200);
                Ok(Some(final_path.to_string_lossy().into_owned()))
            }
            Err(_) => Ok(Some(expected.to_string_lossy().into_owned())),
        }
    } else {
        let _ = std::fs::remove_file(&expected);
        Ok(None)
    }
}

/// Finder previews ANY file whose content is text, regardless of extension
/// (Makefile, .gitignore, dotfiles, extensionless scripts, …). Mirror that by
/// sniffing the first 64 KiB: a NUL byte means binary, otherwise the prefix
/// must be valid UTF-8.
#[tauri::command]
pub async fn preview_sniff_text(path: String) -> Result<bool, String> {
    use std::io::Read;

    let meta = std::fs::metadata(&path).map_err(|e| format!("stat failed: {e}"))?;
    if !meta.is_file() {
        return Ok(false);
    }
    if meta.len() > 50 * 1024 * 1024 {
        return Ok(false);
    }

    let mut file = std::fs::File::open(&path).map_err(|e| format!("open failed: {e}"))?;
    let mut buf = vec![0u8; MAX_SNIFF_BYTES];
    let mut read = 0usize;
    while read < buf.len() {
        match file.read(&mut buf[read..]) {
            Ok(0) => break,
            Ok(n) => read += n,
            Err(e) => return Err(format!("read failed: {e}")),
        }
    }
    buf.truncate(read);
    if buf.is_empty() {
        return Ok(true); // empty files are trivially previewable text
    }
    if buf.contains(&0) {
        return Ok(false);
    }
    // A multi-byte sequence cut off by the 64 KiB window is fine — accept the
    // longest valid UTF-8 prefix when the error sits at the very tail.
    match std::str::from_utf8(&buf) {
        Ok(_) => Ok(true),
        Err(e) if e.error_len().is_none() && e.valid_up_to() >= buf.len() - 4 => Ok(true),
        Err(_) => Ok(false),
    }
}

/// Best-effort cache eviction: keep the newest `keep` artefacts.
fn cleanup_cache(dir: &Path, keep: usize) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let mut files: Vec<(std::time::SystemTime, u64, PathBuf)> = entries
        .flatten()
        .filter_map(|e| {
            let p = e.path();
            let meta = e.metadata().ok()?;
            let mtime = meta.modified().ok()?;
            Some((mtime, meta.len(), p))
        })
        .collect();
    // Two budgets, whichever hits first: file count (converted artefacts are
    // small) and total bytes (remuxed movies are source-sized, so 200 of
    // those would eat the disk).
    const MAX_TOTAL_BYTES: u64 = 8 * 1024 * 1024 * 1024;
    let total_now: u64 = files.iter().map(|(_, len, _)| len).sum();
    if files.len() <= keep && total_now <= MAX_TOTAL_BYTES {
        return;
    }
    files.sort_by(|a, b| b.0.cmp(&a.0)); // newest first
    // Evict from the OLDEST end until both budgets hold.
    let mut total = total_now;
    let mut count = files.len();
    let mut idx = files.len();
    while idx > 0 && (count > keep || total > MAX_TOTAL_BYTES) {
        idx -= 1;
        let (_, len, path) = &files[idx];
        total = total.saturating_sub(*len);
        count -= 1;
        let _ = std::fs::remove_file(path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn sniff_text_detects_text_and_binary() {
        let dir = std::env::temp_dir().join("wisp-preview-ops-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        let text_file = dir.join("Makefile");
        std::fs::write(&text_file, "all:\n\techo 你好\n").unwrap();
        assert!(preview_sniff_text(text_file.to_string_lossy().into()).await.unwrap());

        let bin_file = dir.join("blob.bin");
        std::fs::write(&bin_file, b"abc\x00def").unwrap();
        assert!(!preview_sniff_text(bin_file.to_string_lossy().into()).await.unwrap());

        let empty = dir.join("empty");
        std::fs::write(&empty, b"").unwrap();
        assert!(preview_sniff_text(empty.to_string_lossy().into()).await.unwrap());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn plist_xml_converts_binary_plist() {
        let dir = std::env::temp_dir().join("wisp-preview-ops-plist");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let plist = dir.join("t.plist");
        let out = std::process::Command::new("/usr/bin/plutil")
            .args(["-convert", "binary1", "-o"])
            .arg(&plist)
            .arg("-")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .and_then(|mut c| {
                use std::io::Write;
                c.stdin
                    .as_mut()
                    .expect("piped stdin")
                    .write_all(br#"{"a":1}"#)?;
                c.wait().map(|_| ())
            });
        assert!(out.is_ok(), "fixture creation failed");

        let xml = preview_plist_xml(plist.to_string_lossy().into()).await.unwrap();
        assert!(xml.contains("<integer>1</integer>"), "unexpected xml: {xml}");
        let _ = std::fs::remove_dir_all(&dir);
    }
}

#[cfg(test)]
mod epub_tests {
    use super::*;

    #[test]
    fn parses_real_epub_spine_and_toc() {
        let epub = "/Users/tc/Downloads/牧神记 (宅猪) (z-library.sk, 1lib.sk, z-lib.sk).epub";
        if !Path::new(epub).exists() {
            return; // machine-dependent test
        }
        let dir = std::env::temp_dir().join("wisp-epub-parse-test");
        let _ = std::fs::remove_dir_all(&dir);
        // unpack via the same loop by writing through zip crate directly
        let file = std::fs::File::open(epub).unwrap();
        let mut archive = zip::ZipArchive::new(file).unwrap();
        let dir_str = dir.to_string_lossy().into_owned();
        for i in 0..archive.len() {
            let mut entry = archive.by_index(i).unwrap();
            let name = entry.name().to_string();
            if name.contains("..") || name.is_empty() {
                continue;
            }
            let safe = name.trim_start_matches('/').to_string();
            let outpath = Path::new(&dir_str).join(&safe);
            if entry.is_dir() {
                std::fs::create_dir_all(&outpath).unwrap();
            } else {
                if let Some(p) = outpath.parent() {
                    std::fs::create_dir_all(p).unwrap();
                }
                std::io::copy(&mut entry, &mut std::fs::File::create(&outpath).unwrap()).unwrap();
            }
        }
        let chapters = parse_epub(&dir).expect("parse_epub failed");
        assert!(!chapters.is_empty(), "spine should not be empty");
        let with_titles = chapters.iter().filter(|c| !c.title.is_empty()).count();
        println!("chapters={} titled={}", chapters.len(), with_titles);
        let first = chapters.first().unwrap();
        println!("first: {} -> {}", first.title, first.href);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
