fn main() {
    println!(
        "cargo:rustc-env=WISP_BRIDGE_TARGET={}",
        std::env::var("TARGET").expect("Cargo target is required")
    );
    tauri_build::build()
}
