# Font packs

`font_packs.rs` fetches the resource packs the app does not bundle: the faces of Traditional
Chinese, Hong Kong, and Korean text, which `DECISIONS.md` (2026-11-09) allows as the app's one
network use. The renderer decides when a pack is needed, as the
[font contract](../../ui/theme/fonts.md) says; this module only answers `font_pack(name)`.

## The request

[`themes/fonts/packs/manifest.json`](../../themes/fonts/README.md#resource-packs) is compiled into
the binary. Each entry names an exact package version, its fixed address (the npm registry's tarball
for that version, an `https://registry.npmjs.org/` URL), the registry's `sha512` integrity, and the
woff2 files to keep. The renderer passes a pack name only, and an unknown name is refused; the host
sends one GET to that entry's address with the HTTP client's default headers. Nothing about a
document, a path, or the reader is in it, and the address does not vary.

No redirect is followed: a 3xx, like any status but 200, fails the request. The body is capped at
`MAX_BYTES`, by its declared length and again while reading, and the whole exchange at `TIMEOUT`.
The body is held in memory and checked against the integrity before anything is written. Only then
are the kept files copied out of the tarball's `package/files/` into a hidden directory beside the
cache entry, which is renamed into place once every kept file is present; other archive entries,
links, and names outside the list are skipped. A partial pack is therefore never at the entry's
path, and a failure removes the hidden directory. A hidden directory a crashed run left is removed
at the pack's next download.

## The cache

Packs live in `font-packs/` under Tauri's application cache directory:
`~/Library/Caches/<identifier>/` on macOS, `$XDG_CACHE_HOME/<identifier>/` or
`~/.cache/<identifier>/` on Linux, and `%LOCALAPPDATA%\<identifier>\` on Windows, where the
identifier is the bundle identifier in `tauri.conf.json`. Each pack's directory is named by pack and
version, so a new pin never reads an older pack's files. A directory holding every kept file is
answered at once, with no request, including one an earlier launch fetched.

## Outcomes

`font_pack` replies `ready` with the pack's directory, ending in the platform's separator; `offline`
when the network did not answer (no route, refused connection, unresolved host, a timeout, or a
connection lost mid-body); or `failed` when it answered with something refused (a status other than
200, a redirect, an oversize body, a hash mismatch, or an archive lacking a kept file). Concurrent
requests for one pack wait on one download and share its outcome. A failure is not remembered: the
next request downloads again, and the host never retries on its own. The download runs on a blocking
thread outside the [document lanes](worker.md), since it waits on the network rather than the
filesystem.

The renderer reads the files through Tauri's asset protocol, whose scope in `tauri.conf.json` admits
only `*.woff2` one level inside `$APPCACHE/font-packs/`; the content security policy adds the asset
protocol's origins to `font-src` alone, and `connect-src` stays closed to the network.

`font_packs.rs` tests each outcome against a local server on `127.0.0.1`, concurrent requests, a
cached pack found at startup, and that a partial pack is never visible.
