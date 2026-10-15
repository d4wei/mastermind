# Application icon

`icon.svg` is the editable source. Its block-letter M preserves the two-row character art from
Mastermind's README at `3687c91`, including the row gap and light-shade texture. The background uses
Grid's orange-red accent, converted to sRGB `#E5241B` for icon formats.

The native bundle consumes `icon.png`, `icon.icns`, and `icon.ico`. Regenerate them from the repository
root with the pinned Tauri CLI:

```sh
icon_output=$(mktemp -d)
node tools/desktop/tauri.mjs icon desktop/icons/icon.svg --output "$icon_output"
cp "$icon_output/icon.png" "$icon_output/icon.icns" "$icon_output/icon.ico" desktop/icons/
```

The CLI also generates mobile and store assets in the temporary directory; retain only the formats
listed in `desktop/tauri.conf.json`.
