use std::path::Path;

/// `font_packs.rs` compiles in the pack manifest, which `tools/fonts/vendor-fonts.mts` generates at
/// install rather than the repository committing it.
const PACK_MANIFEST: &str = "../themes/fonts/packs/manifest.json";

fn main() {
    println!("cargo::rerun-if-changed={PACK_MANIFEST}");
    if !Path::new(PACK_MANIFEST).is_file() {
        println!(
            "cargo::error=themes/fonts/packs/manifest.json is missing: it is generated from the pinned font packages. Run `npm ci`, or `npm run fonts:vendor` after an install that skipped scripts, at the repository root."
        );
        return;
    }
    tauri_build::build()
}
