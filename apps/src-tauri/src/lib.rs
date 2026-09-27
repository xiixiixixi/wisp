pub mod error;
pub mod utils;

pub mod agent;
pub mod ai;
pub mod airdrop;
pub mod app_menu;
pub mod backup;
pub mod chatgpt_bridge;
pub mod document_extractor;
pub mod duplicate_finder;
pub mod extensions;
pub mod file_lib;
pub mod file_organizer;
pub mod file_watcher;
pub mod git;
pub mod google_drive;
pub mod mcp_host;
pub mod mcp_server;
pub mod mouse_navigation;
#[cfg(target_os = "macos")]
pub mod native_material;
pub mod operations;
pub mod mem0;
pub mod pi_bridge;
pub mod project_memory;
pub mod pty;
pub mod secure_credentials;
pub mod shortcuts;
pub mod storage;
pub mod sync;
pub mod text_editing;
pub mod weather;
pub mod webview_tabs;

#[cfg(windows)]
pub mod windows_recycle_bin;

