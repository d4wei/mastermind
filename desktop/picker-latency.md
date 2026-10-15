# File picker latency

Measured on macOS on 2026-10-14 using the release app, Tauri dialog 2.7.1, and rfd 0.16.0.
These are diagnostic samples, not benchmarks or cross-platform claims.

`opening::choose_files` immediately requests a parented dialog. Admission starts after selection;
the UI's opening-snapshot polling does not gate picker presentation. Timing around the command,
panel constructor, and sheet presentation localized the delay to the native dialog path.

| Path | Panel creation | Begin sheet | Total dispatch |
| --- | ---: | ---: | ---: |
| First open | 625 ms | 304 ms | 929 ms |
| Repeat open | 177 ms | 283 ms | 461 ms |
| Repeat with retained panel | <1 ms | 284 ms | 285 ms |

The experiment retained rfd's `NSOpenPanel` between calls in a temporary local dependency patch.
Its first open still cost about one second. The patch and timing instrumentation were removed;
the shipped implementation continues to use the pinned, unmodified dialog plugin.

The library does not expose panel reuse. Supporting it locally would require maintaining a native
macOS path or a dependency patch. Moving construction to startup would move the first-use cost,
not remove it. The optimization is deferred in [DIRECTION.md](../DIRECTION.md).

For a future attempt, compare first and repeated opens from both the button and native menu. Test
cancel/reopen, successful multi-file selection, repeated selection, dismissal during quit, and
unchanged admission behavior. Keep Windows and Linux on their platform picker paths.
