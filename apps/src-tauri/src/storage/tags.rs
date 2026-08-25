// File tags backed by Finder's native tag store.
//
// macOS keeps per-file tags in the extended attribute
// `com.apple.metadata:_kMDItemUserTags` as a binary plist array of
// "TagName\n<ColorIndex>" strings (0 none, 1 gray, 2 green, 3 purple,
// 4 blue, 5 yellow, 6 red, 7 orange). Reading and writing that same
// store makes Wisp's tags fully interoperable with Finder, Spotlight
// and every other file manager — there is no private tag database.
//
// The global tag palette is read from Finder's own preferences
// (com.apple.finder.plist → UserTags), falling back to the seven
// standard colours, so the picker shows exactly what Finder shows.
//
// On non-macOS targets there is no Finder tag store; the read commands
// return empty results and writes fail gracefully.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Cursor;

/// A Finder-style tag: a name plus a colour.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct FileTag {
    pub name: String,
    pub color: String, // hex colour derived from the Finder colour index
}

const USER_TAGS_XATTR: &str = "com.apple.metadata:_kMDItemUserTags";

// Finder colour indices → macOS system colours.
const COLOR_TABLE: [(u8, &str); 7] = [
    (1, "#98989D"), // gray
    (2, "#30D158"), // green
    (3, "#BF5AF2"), // purple
    (4, "#0A84FF"), // blue
    (5, "#FFD60A"), // yellow
    (6, "#FF453A"), // red
    (7, "#FF9F0A"), // orange
];

// Finder's standard palette, in the order Finder's settings show it.
const STANDARD_TAGS: [( &str, u8); 7] = [
    ("Red", 6),
    ("Orange", 7),
    ("Yellow", 5),
    ("Green", 2),
    ("Blue", 4),
    ("Purple", 3),
    ("Gray", 1),
];

fn color_hex_for_index(index: u8) -> String {
    COLOR_TABLE
        .iter()
        .find(|(i, _)| *i == index)
        .map(|(_, hex)| hex.to_string())
        .unwrap_or_else(|| "#98989D".to_string())
}

pub fn index_for_color_hex(hex: &str) -> u8 {
    let lower = hex.trim().to_lowercase();
    COLOR_TABLE
        .iter()
        .find(|(_, h)| h.to_lowercase() == lower)
        .map(|(i, _)| *i)
        .unwrap_or(0)
}

/// Split a stored tag string into (name, colour index).
fn parse_tag_string(s: &str) -> (String, u8) {
    match s.rfind('\n') {
        Some(pos) => {
            let name = s[..pos].to_string();
            let idx = s[pos + 1..].trim().parse::<u8>().unwrap_or(0);
            (name, idx)
        }
        None => (s.to_string(), 0),
    }
}

fn encode_tag_string(name: &str, index: u8) -> String {
    if index == 0 {
        name.to_string()
    } else {
        format!("{}\n{}", name, index)
    }
}

/// Read the raw tag strings from a file's Finder-tag extended attribute.
pub fn read_tag_strings(path: &str) -> Result<Vec<String>, String> {
    let bytes = xattr::get(path, USER_TAGS_XATTR)
        .map_err(|e| format!("Failed to read tags: {}", e))?;
    let bytes = match bytes {
        Some(b) => b,
        None => return Ok(Vec::new()),
    };
    let value = plist::Value::from_reader(Cursor::new(&bytes))
        .map_err(|e| format!("Failed to parse tag plist: {}", e))?;
    match value {
        plist::Value::Array(items) => Ok(items
            .into_iter()
            .filter_map(|v| v.as_string().map(str::to_string))
            .collect()),
        _ => Ok(Vec::new()),
    }
}

/// Write the tag strings back to the file (removes the attribute when empty).
pub fn write_tag_strings(path: &str, strings: &[String]) -> Result<(), String> {
    if strings.is_empty() {
        // Ignore "attribute missing" — clearing an untagged file is fine.
        let _ = xattr::remove(path, USER_TAGS_XATTR);
        return Ok(());
    }
    let array = plist::Value::Array(
        strings
            .iter()
            .map(|s| plist::Value::String(s.clone()))
            .collect(),
    );
    let mut buf = Vec::new();
    plist::to_writer_binary(&mut buf, &array)
        .map_err(|e| format!("Failed to serialize tag plist: {}", e))?;
    xattr::set(path, USER_TAGS_XATTR, &buf)
        .map_err(|e| format!("Failed to write tags: {}", e))
}

pub fn strings_to_tags(strings: &[String]) -> Vec<FileTag> {
    strings
        .iter()
        .filter(|s| !s.trim().is_empty())
        .map(|s| {
            let (name, idx) = parse_tag_string(s);
            FileTag {
                name,
                color: color_hex_for_index(idx),
            }
        })
        .collect()
}

pub fn tags_to_strings(tags: &[FileTag]) -> Vec<String> {
    tags.iter()
        .map(|t| encode_tag_string(&t.name, index_for_color_hex(&t.color)))
        .collect()
}

/// The palette shown in pickers: Finder's own UserTags list when present,
/// otherwise the seven standard colours.
fn finder_palette() -> Vec<FileTag> {
    let home = std::env::var("HOME").unwrap_or_default();
    let prefs = format!("{}/Library/Preferences/com.apple.finder.plist", home);
    if let Ok(value) = plist::Value::from_file(&prefs) {
        if let Some(items) = value.as_dictionary().and_then(|d| d.get("UserTags")).and_then(|t| t.as_array()) {
            let tags: Vec<FileTag> = items
                .iter()
                .filter_map(|item| {
                    // Entries are "Name\n<index>" strings (older systems may
                    // store dicts with name/number — handle both shapes).
                    if let Some(s) = item.as_string() {
                        let (name, idx) = parse_tag_string(s);
                        if name.is_empty() {
                            return None;
                        }
                        return Some(FileTag {
                            name,
                            color: color_hex_for_index(idx),
                        });
                    }
                    if let Some(dict) = item.as_dictionary() {
                        let name = dict.get("name")?.as_string()?.to_string();
                        let idx = dict
                            .get("number")
                            .and_then(|v| v.as_real().map(|r| r as u8).or_else(|| v.as_signed_integer().and_then(|i| u8::try_from(i).ok())))
                            .unwrap_or(0);
                        return Some(FileTag {
                            name,
                            color: color_hex_for_index(idx),
                        });
                    }
                    None
                })
                .collect();
            if !tags.is_empty() {
                return tags;
            }
        }
    }
    STANDARD_TAGS
        .iter()
        .map(|(name, idx)| FileTag {
            name: name.to_string(),
            color: color_hex_for_index(*idx),
        })
        .collect()
}

// ─── Tauri commands ──────────────────────────────────────────────────────────

/// Return the tags currently assigned to a file path.
#[tauri::command]
pub async fn get_file_tags(path: String) -> Vec<FileTag> {
    strings_to_tags(&read_tag_strings(&path).unwrap_or_default())
}

/// Overwrite the tags for a file path (pass an empty Vec to clear).
#[tauri::command]
pub async fn set_file_tags(path: String, tags: Vec<FileTag>) -> Result<(), String> {
    write_tag_strings(&path, &tags_to_strings(&tags))
}

/// Return all tags for a batch of file paths in one call (avoids N+1 round trips).
#[tauri::command]
pub async fn get_file_tags_batch(paths: Vec<String>) -> HashMap<String, Vec<FileTag>> {
    let mut result = HashMap::new();
    for path in paths {
        let tags = strings_to_tags(&read_tag_strings(&path).unwrap_or_default());
        if !tags.is_empty() {
            result.insert(path, tags);
        }
    }
    result
}

/// Return the tag palette (Finder's UserTags, or the standard colours).
#[tauri::command]
pub async fn get_all_file_tags() -> Vec<FileTag> {
    finder_palette()
}

/// Remove all tags from a specific file.
#[tauri::command]
pub async fn remove_all_tags_from_file(path: String) -> Result<(), String> {
    write_tag_strings(&path, &[])
}

/// Remove a specific tag (by name) from every file that has it.
/// Uses Spotlight (mdfind) to locate the files, the same store Finder uses.
#[tauri::command]
pub async fn remove_tag_globally(tag_name: String) -> Result<(), String> {
    // Raw query form: the `tag:` keyword form breaks on some locales.
    let escaped = tag_name.replace('\'', "''");
    let output = std::process::Command::new("mdfind")
        .arg(format!("kMDItemUserTags == '*{}*'", escaped))
        .output()
        .map_err(|e| format!("Failed to run mdfind: {}", e))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    for path in stdout.lines().filter(|l| !l.is_empty()) {
        let tags = strings_to_tags(&read_tag_strings(path).unwrap_or_default());
        let remaining: Vec<FileTag> = tags.into_iter().filter(|t| t.name != tag_name).collect();
        write_tag_strings(path, &tags_to_strings(&remaining))?;
    }
    Ok(())
}

/// Add tags to multiple file paths at once. Existing tags are preserved;
/// only tags not yet present (by name) are appended.
#[tauri::command]
pub async fn batch_add_tags(paths: Vec<String>, tags: Vec<FileTag>) -> Result<(), String> {
    for path in &paths {
        let mut current = strings_to_tags(&read_tag_strings(path)?);
        for tag in &tags {
            if !current.iter().any(|t| t.name == tag.name) {
                current.push(tag.clone());
            }
        }
        write_tag_strings(path, &tags_to_strings(&current))?;
    }
    Ok(())
}

/// Remove tags (by name) from multiple file paths at once.
#[tauri::command]
pub async fn batch_remove_tags(paths: Vec<String>, tag_names: Vec<String>) -> Result<(), String> {
    for path in &paths {
        let current = strings_to_tags(&read_tag_strings(path)?);
        let remaining: Vec<FileTag> = current.into_iter().filter(|t| !tag_names.contains(&t.name)).collect();
        write_tag_strings(path, &tags_to_strings(&remaining))?;
    }
    Ok(())
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tag_string_roundtrip() {
        assert_eq!(parse_tag_string("Red\n6"), ("Red".to_string(), 6));
        assert_eq!(parse_tag_string("NoColor"), ("NoColor".to_string(), 0));
        assert_eq!(encode_tag_string("Red", 6), "Red\n6");
        assert_eq!(encode_tag_string("X", 0), "X");
    }

    #[test]
    fn color_index_hex_mapping() {
        for (idx, hex) in COLOR_TABLE {
            assert_eq!(index_for_color_hex(hex), idx);
        }
        assert_eq!(index_for_color_hex("#unknown"), 0);
    }

    #[test]
    fn plist_roundtrip() {
        let dir = std::env::temp_dir().join("wisp_tag_test_plist");
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("probe.txt");
        std::fs::write(&file, "hi").unwrap();
        let path = file.to_str().unwrap().to_string();

        let tags = vec![
            FileTag {
                name: "Red".into(),
                color: color_hex_for_index(6),
            },
            FileTag {
                name: "工作".into(),
                color: color_hex_for_index(4),
            },
        ];
        write_tag_strings(&path, &tags_to_strings(&tags)).unwrap();

        let bytes = xattr::get(&path, USER_TAGS_XATTR).unwrap().unwrap();
        // Binary plist magic
        assert_eq!(&bytes[..8], b"bplist00");

        let read_back = strings_to_tags(&read_tag_strings(&path).unwrap());
        assert_eq!(read_back.len(), 2);
        assert_eq!(read_back[0].name, "Red");
        assert_eq!(read_back[0].color, "#FF453A");
        assert_eq!(read_back[1].name, "工作");

        // Clearing removes the attribute
        write_tag_strings(&path, &[]).unwrap();
        assert!(xattr::get(&path, USER_TAGS_XATTR).unwrap().is_none());
        let _ = std::fs::remove_file(&path);
    }
}
