//! `media://` custom URI scheme with real HTTP Range support.
//!
//! WKWebView's media engine needs range requests (206 Partial Content) to
//! stream; Tauri's built-in asset protocol serves plain 200s, which the
//! media stack refuses (SRC_NOT_SUPPORTED) — that is why previews had to
//! buffer whole files. This handler parses `Range: bytes=start-end`, seeks
//! the file, and answers with 206 + Content-Range so <video>/<audio> stream
//! directly from disk: instant start, arbitrary seeks, no full load.

use std::io::{Read, Seek, SeekFrom};

/// Parse `bytes=a-b` (either end optional) out of a Range header value.
fn parse_range(header: &str, len: u64) -> Option<(u64, u64)> {
    let spec = header.trim().strip_prefix("bytes=")?;
    let spec = spec.split(',').next()?.trim();
    let (start_s, end_s) = spec.split_once('-')?;
    let (start, end) = match (start_s.trim().parse::<u64>(), end_s.trim().parse::<u64>()) {
        (Ok(s), Ok(e)) => (s, e.min(len.saturating_sub(1))),
        (Ok(s), Err(_)) if s < len => (s, len - 1),
        (Err(_), Ok(suffix)) if suffix > 0 => (len.saturating_sub(suffix), len - 1),
        _ => return None,
    };
    if start > end || start >= len {
        return None;
    }
    Some((start, end))
}

pub fn register_media_protocol(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    builder.register_asynchronous_uri_scheme_protocol("media", move |_ctx, request, responder| {
        let uri = request.uri().to_string();
        eprintln!("[media-proto] uri={}", uri);
        // media://localhost/<urlencoded absolute path> (authority form keeps
        // URL parsing happy; the bare-scheme form is accepted for robustness)
        let raw = uri
            .strip_prefix("media://localhost/")
            .or_else(|| uri.strip_prefix("media://"))
            .unwrap_or(&uri);
        let path: String = raw
            .split(['?', '#'])
            .next()
            .map(urlencoding::decode)
            .and_then(|r| r.ok())
            .unwrap_or_default()
            .into_owned();

        let mut response = match std::fs::metadata(&path) {
            Ok(meta) if meta.is_file() => {
                eprintln!("[media-proto] serving path={} len={}", path, meta.len());
                let len = meta.len();
                let range = request
                    .headers()
                    .get("range")
                    .and_then(|v| v.to_str().ok())
                    .and_then(|h| parse_range(h, len));

                match range {
                    Some((start, end)) => {
                        let chunk = (end - start + 1) as usize;
                        let mut response = match std::fs::File::open(&path)
                            .and_then(|mut f| {
                                f.seek(SeekFrom::Start(start))?;
                                Ok(f)
                            }) {
                            Ok(mut file) => {
                                let mut buf = vec![0u8; chunk];
                                let mut filled = 0usize;
                                while filled < chunk {
                                    match file.read(&mut buf[filled..]) {
                                        Ok(0) => break,
                                        Ok(n) => filled += n,
                                        Err(_) => break,
                                    }
                                }
                                buf.truncate(filled);
                                tauri::http::Response::builder()
                                    .status(206)
                                    .header(
                                        "content-range",
                                        format!("bytes {start}-{end}/{len}"),
                                    )
                                    .header("accept-ranges", "bytes")
                                    .header("content-type", guess_mime(&path))
                                    .header("content-length", filled.to_string())
                                    .body(buf)
                                    .unwrap_or_else(|_| empty_response())
                            }
                            Err(_) => tauri::http::Response::builder()
                                .status(500)
                                .body(b"open/seek failed".to_vec())
                                .unwrap(),
                        };
                        response.headers_mut().insert(
                            "access-control-allow-origin",
                            "*".parse().unwrap(),
                        );
                        responder.respond(response);
                        return;
                    }
                    None => {
                        // Full-file fallback for non-range clients.
                        match std::fs::read(&path) {
                            Ok(bytes) => tauri::http::Response::builder()
                                .status(200)
                                .header("accept-ranges", "bytes")
                                .header("content-type", guess_mime(&path))
                                .header("content-length", bytes.len().to_string())
                                .body(bytes)
                                .unwrap_or_else(|_| empty_response()),
                            Err(_) => tauri::http::Response::builder()
                                .status(404)
                                .body(b"not found".to_vec())
                                .unwrap(),
                        }
                    }
                }
            }
            _ => {
                eprintln!("[media-proto] 404 for path={}", path);
                tauri::http::Response::builder()
                    .status(404)
                    .body(b"not found".to_vec())
                    .unwrap()
            }
        };
        // WKWebView blocks media from cross-origin responses without CORS
        // headers; the page itself is the only intended consumer.
        let headers = response.headers_mut();
        headers.insert("access-control-allow-origin", "*".parse().unwrap());
        responder.respond(response);
    })
}

fn empty_response() -> tauri::http::Response<Vec<u8>> {
    tauri::http::Response::builder()
        .status(500)
        .body(Vec::new())
        .unwrap()
}

fn guess_mime(path: &str) -> &'static str {
    let ext = path
        .rsplit('.')
        .next()
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "mp3" | "mp2" => "audio/mpeg",
        "m4a" | "m4b" | "m4r" | "alac" => "audio/mp4",
        "aac" => "audio/aac",
        "ac3" => "audio/ac3",
        "wav" => "audio/wav",
        "aiff" | "aif" | "aifc" => "audio/aiff",
        "caf" => "audio/x-caf",
        "flac" => "audio/flac",
        "ogg" | "oga" | "opus" => "audio/ogg",
        "wma" => "audio/x-ms-wma",
        "mp4" | "m4v" => "video/mp4",
        "mov" | "qt" => "video/quicktime",
        "webm" => "video/webm",
        "mkv" => "video/x-matroska",
        "avi" => "video/x-msvideo",
        "wmv" => "video/x-ms-wmv",
        "flv" => "video/x-flv",
        "mpg" | "mpeg" | "m1v" | "m2v" => "video/mpeg",
        "3gp" => "video/3gpp",
        "3g2" => "video/3gpp2",
        "ogv" => "video/ogg",
        "pdf" => "application/pdf",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::parse_range;

    #[test]
    fn ranges_parse() {
        assert_eq!(parse_range("bytes=0-99", 1000), Some((0, 99)));
        assert_eq!(parse_range("bytes=500-", 1000), Some((500, 999)));
        assert_eq!(parse_range("bytes=-200", 1000), Some((800, 999)));
        assert_eq!(parse_range("bytes=900-2000", 1000), Some((900, 999)));
        assert_eq!(parse_range("bytes=1000-", 1000), None);
        assert_eq!(parse_range("bytes=abc", 1000), None);
    }
}
