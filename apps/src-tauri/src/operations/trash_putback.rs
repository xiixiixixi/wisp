//! Put-back metadata (“放回原处”) for trash items.
//!
//! Sources, in priority order:
//! 1. Wisp's own ledger (`~/.Trash/.wisp-putback.json`), written whenever Wisp
//!    itself trashes an item. The `trash` crate performs a Finder-style move
//!    but records no put-back information, so without the ledger items trashed
//!    from Wisp could be put back neither by Finder nor by Wisp.
//! 2. Finder's `~/.Trash/.DS_Store` `ptbL`/`ptbN` records for items Finder
//!    trashed. Both the modern framing
//!    `[u32 BE len][UTF-16BE name][key][b"ustr"][u32 BE len][UTF-16BE value]`
//!    and the classic framing (NUL byte after the name) are scanned; the
//!    parser is deliberately tolerant because the container format has
//!    changed across macOS releases (verified against a real macOS 26 store).
//! 3. Freedesktop `.trashinfo` sidecars on Linux.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// Hidden sidecar inside the trash folder; filtered from listings.
#[cfg(target_os = "macos")]
const LEDGER_FILE: &str = ".wisp-putback.json";

/// Longest name/value we accept while scanning (UTF-16 code units).
const MAX_UTF16_UNITS: usize = 4096;

// ── .DS_Store put-back scanner (pure, compiled everywhere for tests) ────────

fn read_be_u32(data: &[u8], pos: usize) -> Option<u32> {
    let end = pos.checked_add(4)?;
    if end > data.len() {
        return None;
    }
    let bytes: [u8; 4] = data[pos..end].try_into().ok()?;
    Some(u32::from_be_bytes(bytes))
}

fn read_ustr(data: &[u8], pos: usize) -> Option<String> {
    let units = read_be_u32(data, pos)? as usize;
    if units == 0 || units > MAX_UTF16_UNITS {
        return None;
    }
    let end = pos.checked_add(4)?.checked_add(units.checked_mul(2)?)?;
    if end > data.len() {
        return None;
    }
    let text: Vec<u16> = data[pos + 4..end]
        .chunks_exact(2)
        .map(|pair| u16::from_be_bytes([pair[0], pair[1]]))
        .collect();
    String::from_utf16(&text).ok()
}

/// Recover the record name that ends at `key_pos`. Modern stores place
/// `[u32 BE len][UTF-16BE name]` directly before the key; classic stores add a
/// NUL byte between name and key. The length prefix must match the byte
/// distance exactly, which makes false positives vanishingly rare.
fn name_before_key(data: &[u8], key_pos: usize) -> Option<String> {
    let classic = key_pos > 0 && data[key_pos - 1] == 0x00;
    for units in (1..=255usize).rev() {
        let attempts = [key_pos.checked_sub(4 + units * 2)];
        let attempts = if classic {
            [attempts[0], key_pos.checked_sub(5 + units * 2)]
        } else {
            [attempts[0], None]
        };
        for start in attempts.into_iter().flatten() {
            if read_be_u32(data, start) != Some(units as u32) {
                continue;
            }
            if let Some(name) = read_ustr(data, start) {
                return Some(name);
            }
        }
    }
    None
}

/// Finder stores the data volume under `/System/Volumes/Data` while user paths
/// reach it through firmlinks from `/`; report the user-visible spelling.
fn normalize_firmlink(path: String) -> String {
    const DATA_PREFIX: &str = "/System/Volumes/Data/";
    match path.strip_prefix(DATA_PREFIX) {
        Some(rest) => format!("/{}", rest),
        None => path,
    }
}

fn scan_key_records(data: &[u8], key: &[u8; 4]) -> Vec<(String, String)> {
    let mut records = Vec::new();
    let mut cursor = 0;
    while let Some(found) = data[cursor..].windows(4).position(|w| w == *key) {
        let pos = cursor + found;
        cursor = pos + 1;
        // Value must be a string record: [key]["ustr"][u32 len][UTF-16BE].
        if data.len() < pos + 8 || &data[pos + 4..pos + 8] != b"ustr" {
            continue;
        }
        let Some(value) = read_ustr(data, pos + 8) else {
            continue;
        };
        let Some(name) = name_before_key(data, pos) else {
            continue;
        };
        records.push((name, value));
    }
    records
}

/// Map trashed-item name → original absolute path from a `.DS_Store` blob.
pub fn parse_ds_store_putback(data: &[u8]) -> HashMap<String, String> {
    let mut directories: HashMap<String, String> = HashMap::new();
    let mut file_names: HashMap<String, String> = HashMap::new();
    for (name, dir) in scan_key_records(data, b"ptbL") {
        directories.insert(name, dir);
    }
    for (name, file) in scan_key_records(data, b"ptbN") {
        file_names.insert(name, file);
    }

    directories
        .into_iter()
        .map(|(name, dir)| {
            let file = file_names.get(&name).cloned().unwrap_or_else(|| name.clone());
            let mut original = String::new();
            if !dir.starts_with('/') {
                original.push('/');
            }
            original.push_str(&dir);
            if !original.ends_with('/') {
                original.push('/');
            }
            original.push_str(&file);
            (name, normalize_firmlink(original))
        })
        .collect()
}

// ── Freedesktop .trashinfo (pure, compiled everywhere for tests) ────────────

fn percent_decode(encoded: &str) -> String {
    let bytes = encoded.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = |b: u8| (b as char).is_ascii_hexdigit();
            if hex(bytes[i + 1]) && hex(bytes[i + 2]) {
                let value =
                    u8::from_str_radix(std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or(""), 16)
                        .unwrap_or(b'%');
                out.push(value);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

/// Parse a `.trashinfo` sidecar into `(original absolute path, deletion timestamp)`.
pub fn parse_trashinfo(content: &str) -> Option<(String, u64)> {
    let mut path: Option<String> = None;
    let mut deletion_date: Option<u64> = None;
    for line in content.lines() {
        if let Some(value) = line.strip_prefix("Path=") {
            path = Some(percent_decode(value));
        } else if let Some(value) = line.strip_prefix("DeletionDate=") {
            deletion_date = chrono::NaiveDateTime::parse_from_str(value.trim(), "%Y-%m-%dT%H:%M:%S")
                .ok()
                .map(|stamp| stamp.and_utc().timestamp().max(0) as u64);
        }
    }
    let path = path?;
    if !path.starts_with('/') {
        return None;
    }
    Some((path, deletion_date.unwrap_or(0)))
}

// ── macOS ledger + lookup ────────────────────────────────────────────────────

#[cfg(target_os = "macos")]
fn ledger_path() -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join(".Trash").join(LEDGER_FILE))
}

#[cfg(target_os = "macos")]
fn load_ledger() -> HashMap<String, String> {
    ledger_path()
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

#[cfg(target_os = "macos")]
fn save_ledger(entries: &HashMap<String, String>) {
    if let Some(path) = ledger_path() {
        if let Ok(json) = serde_json::to_string(entries) {
            let _ = std::fs::write(path, json);
        }
    }
}

/// Best-effort: after trashing `original`, record where the item landed so
/// “放回原处” can restore it. Conflicting renames by the system are not
/// resolvable here, so a miss simply skips the ledger entry.
#[cfg(target_os = "macos")]
pub fn record_putback(original: &str) {
    let Some(name) = Path::new(original).file_name() else {
        return;
    };
    let Some(trash_root) = dirs::home_dir().map(|home| home.join(".Trash")) else {
        return;
    };
    let candidate = trash_root.join(name);
    if !candidate.exists() {
        return;
    }
    let mut ledger = load_ledger();
    ledger.insert(
        candidate.to_string_lossy().to_string(),
        original.to_string(),
    );
    save_ledger(&ledger);
}

/// Resolve the original location for an item sitting at `trash_path`.
#[cfg(target_os = "macos")]
pub fn lookup_original(trash_path: &Path) -> Option<String> {
    let key = trash_path.to_string_lossy().to_string();
    if let Some(original) = load_ledger().get(&key) {
        return Some(original.clone());
    }
    let name = trash_path.file_name()?.to_string_lossy().to_string();
    let store = dirs::home_dir().map(|home| home.join(".Trash").join(".DS_Store"))?;
    let data = std::fs::read(store).ok()?;
    parse_ds_store_putback(&data).get(&name).cloned()
}

#[cfg(target_os = "macos")]
pub fn remove_ledger_entry(trash_path: &Path) {
    let key = trash_path.to_string_lossy().to_string();
    let mut ledger = load_ledger();
    if ledger.remove(&key).is_some() {
        save_ledger(&ledger);
    }
}

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn frame_record(name: &str, key: &[u8; 4], value: &str, classic: bool) -> Vec<u8> {
        let name_units: Vec<u16> = name.encode_utf16().collect();
        let value_units: Vec<u16> = value.encode_utf16().collect();
        let mut out = Vec::new();
        out.extend_from_slice(&(name_units.len() as u32).to_be_bytes());
        for unit in name_units {
            out.extend_from_slice(&unit.to_be_bytes());
        }
        if classic {
            out.push(0x00);
        }
        out.extend_from_slice(key);
        out.extend_from_slice(b"ustr");
        out.extend_from_slice(&(value_units.len() as u32).to_be_bytes());
        for unit in value_units {
            out.extend_from_slice(&unit.to_be_bytes());
        }
        out
    }

    #[test]
    fn parses_modern_ptbl_ptbn_pair() {
        let mut data = vec![0u8; 64];
        data.extend(frame_record("报告.pdf", b"bwsp", "junk", false));
        data.extend(frame_record("报告.pdf", b"ptbL", "Users/tc/Desktop/", false));
        data.extend(frame_record("报告.pdf", b"ptbN", "报告-final.pdf", false));
        data.extend(frame_record("照片.png", b"ptbL", "/Users/tc", false));

        let map = parse_ds_store_putback(&data);
        assert_eq!(
            map.get("报告.pdf").map(String::as_str),
            Some("/Users/tc/Desktop/报告-final.pdf")
        );
        // ptbL without a trailing slash is normalized; missing ptbN falls
        // back to the record name itself.
        assert_eq!(
            map.get("照片.png").map(String::as_str),
            Some("/Users/tc/照片.png")
        );
    }

    #[test]
    fn strips_data_volume_firmlink_prefix() {
        let mut data = Vec::new();
        data.extend(frame_record("a.txt", b"ptbL", "System/Volumes/Data/Users/tc/", false));
        data.extend(frame_record("a.txt", b"ptbN", "a.txt", false));
        let map = parse_ds_store_putback(&data);
        assert_eq!(map.get("a.txt").map(String::as_str), Some("/Users/tc/a.txt"));
    }

    #[test]
    fn parses_classic_nul_terminated_names() {
        let mut data = Vec::new();
        data.extend(frame_record("old.txt", b"ptbL", "Users/tc/Documents/", true));
        data.extend(frame_record("old.txt", b"ptbN", "old.txt", true));
        let map = parse_ds_store_putback(&data);
        assert_eq!(
            map.get("old.txt").map(String::as_str),
            Some("/Users/tc/Documents/old.txt")
        );
    }

    #[test]
    fn ignores_values_that_are_not_strings() {
        // ptbL followed by a non-ustr type must be skipped, not crash.
        let mut data = Vec::new();
        data.extend(frame_record("x.txt", b"ptbL", "Users/tc/", false));
        data.extend_from_slice(b"ptbLlong\x00\x00\x00\x05");
        let map = parse_ds_store_putback(&data);
        assert_eq!(map.get("x.txt").map(String::as_str), Some("/Users/tc/x.txt"));
    }

    #[test]
    fn decodes_trashinfo_sidecar() {
        let info = "[Trash Info]\nPath=/home/tc/%E6%8A%A5%E5%91%8A.pdf\nDeletionDate=2026-10-16T09:30:00\n";
        let (path, ts) = parse_trashinfo(info).expect("sidecar should parse");
        assert_eq!(path, "/home/tc/报告.pdf");
        assert!(ts > 1_700_000_000);
    }

    #[test]
    fn rejects_relative_trashinfo_paths() {
        assert!(parse_trashinfo("[Trash Info]\nPath=relative/path\n").is_none());
    }
}
