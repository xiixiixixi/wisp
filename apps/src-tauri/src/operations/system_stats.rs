//! Live system metrics for the home dashboard (CPU / memory / disk).

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{LazyLock, Mutex};
use sysinfo::System;
use tauri::command;

#[derive(Debug, Clone, serde::Serialize)]
pub struct SystemStats {
    /// Global CPU usage in percent (0–100)
    pub cpu_usage: f32,
    /// Physical memory totals in bytes
    pub mem_total: u64,
    pub mem_used: u64,
    /// Root volume in bytes
    pub disk_total: u64,
    pub disk_available: u64,
}

static SYS: LazyLock<Mutex<System>> = LazyLock::new(|| Mutex::new(System::new()));
static CPU_PRIMED: AtomicBool = AtomicBool::new(false);

fn root_volume() -> PathBuf {
    if cfg!(target_os = "windows") {
        PathBuf::from("C:\\")
    } else {
        PathBuf::from("/")
    }
}

fn read_stats() -> SystemStats {
    {
        let mut sys = SYS.lock().unwrap_or_else(|e| e.into_inner());
        sys.refresh_memory();
        sys.refresh_cpu_usage();
        // CPU usage is a delta between two samples; the very first read is
        // always 0%, so take one extra delayed sample on the first call.
        if !CPU_PRIMED.swap(true, Ordering::Relaxed) {
            drop(sys);
            std::thread::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL);
            SYS.lock()
                .unwrap_or_else(|e| e.into_inner())
                .refresh_cpu_usage();
        }
    }

    let (cpu_usage, mem_total, mem_used) = {
        let sys = SYS.lock().unwrap_or_else(|e| e.into_inner());
        (
            sys.global_cpu_usage().clamp(0.0, 100.0),
            sys.total_memory(),
            sys.used_memory(),
        )
    };

    let disks = sysinfo::Disks::new_with_refreshed_list();
    let root = root_volume();
    let (disk_total, disk_available) = disks
        .list()
        .iter()
        .find(|d| d.mount_point() == root)
        .map(|d| (d.total_space(), d.available_space()))
        .unwrap_or((0, 0));

    SystemStats {
        cpu_usage,
        mem_total,
        mem_used,
        disk_total,
        disk_available,
    }
}

/// Live system metrics for the home dashboard. Safe to poll frequently.
#[command]
pub async fn get_system_stats() -> Result<SystemStats, String> {
    tokio::task::spawn_blocking(read_stats)
        .await
        .map_err(|e| e.to_string())
}

/// One row of the「最吃性能」leaderboard on the home dashboard.
#[derive(Debug, Clone, serde::Serialize)]
pub struct TopProcess {
    pub pid: u32,
    pub name: String,
    /// CPU usage in percent (0–100 per core basis, sysinfo semantics)
    pub cpu_usage: f32,
    /// Resident memory in bytes
    pub memory: u64,
}

fn read_top_processes() -> Vec<TopProcess> {
    let mut sys = SYS.lock().unwrap_or_else(|e| e.into_inner());
    sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
    // Process CPU is also a delta between samples — like read_stats, the
    // first sample after (re)discovery reads low, which is fine for a
    // polled leaderboard: values converge within one poll tick.
    std::thread::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL);
    sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);

    let mut rows: Vec<TopProcess> = sys
        .processes()
        .values()
        .filter(|p| p.cpu_usage() > 0.1 || p.memory() > 256 * 1024 * 1024)
        .map(|p| TopProcess {
            pid: p.pid().as_u32(),
            name: p.name().to_string_lossy().into_owned(),
            cpu_usage: p.cpu_usage(),
            memory: p.memory(),
        })
        .collect();
    // Rank by CPU first, memory as the tiebreaker — "最吃性能" reads as
    // CPU load with memory as the secondary signal.
    rows.sort_by(|a, b| {
        b.cpu_usage
            .partial_cmp(&a.cpu_usage)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(b.memory.cmp(&a.memory))
    });
    rows.truncate(8);
    rows
}

/// The heaviest processes right now, for the home 性能 leaderboard.
#[command]
pub async fn get_top_processes() -> Result<Vec<TopProcess>, String> {
    tokio::task::spawn_blocking(read_top_processes)
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn returns_sane_stats() {
        let stats = read_stats();
        assert!(stats.cpu_usage >= 0.0 && stats.cpu_usage <= 100.0);
        assert!(stats.mem_total > 0);
        assert!(stats.mem_used <= stats.mem_total);
        assert!(stats.disk_total > 0);
        assert!(stats.disk_available <= stats.disk_total);
    }
}
