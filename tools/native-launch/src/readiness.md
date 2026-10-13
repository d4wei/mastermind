# Document layout readiness measurement

The experimental `readiness-trace` Cargo feature adds a test-only command and initialization script.
They are inactive unless the trusted harness supplies `MM_LAUNCH_CHECK_READY_TRACE`: a JSON object
with a nonce, canonical absolute target, and absolute output path. It does not change the normal
opening protocol, emit document contents on stdout, or add UI controls. Builds without the feature
have neither the command nor the injected script.

The injected observer accepts only the native reviewer page, an original-text article containing
both fixed public fixture markers, and the document selector naming the requested canonical path.
It checks layout dimensions, awaits used-font readiness and two animation frame callbacks, then
rechecks article identity, selected document, content, and visibility. Mutations during the wait
queue one fresh attempt if the candidate changed, without waiting for another unrelated mutation.
Home, diagnostic shell,
loading, translated view, and dialogs cannot satisfy the gate. The native command checks that the
selected ID resolves to the admitted target and that the main window is visible and not minimized.
Only its configured nonce can produce a trace, and it writes at most once without replacing a file.

`measure-readiness.py` copies the public fixture to one disposable path and runs five requests,
each against a fresh endpoint and host. Python records its monotonic time immediately before
spawning the normal CLI, then stops when short polling observes the matching complete trace. It
checks the normal admission reply independently: one newly opened document and the trace's host
PID. Each host exits before the next trial; document bytes must remain unchanged.

The metric is **launcher invocation to observed document-layout readiness after two frames**.
It includes process spawn and loader work, native startup, admission, reviewer loading and mounting,
font/layout/frame waits, JavaScript-to-native invocation, trace-file write, and polling delay.
There is no conversion between Python and webview/native clocks. It is not physical first paint,
CLI acknowledgment, or an estimate of CUA latency. Fresh-process trials do not clear OS file caches.
The instrumented release build and its enabled features must accompany reported measurements.

Hidden or occluded windows can throttle animation frames, and the OS may decline focus. Font or
webview failures may prevent a signal. These produce a failed/deadline trial, never a timer-based
readiness substitute. A later image or interactive control is not part of this plain-text fixture's
readiness claim. Before running, keep the measurement window visible and set Read mode with
Original only
in native Settings. The harness does not change or enforce these preferences.

From the repository root, with both root and experiment dependencies installed, generate the
reviewer assets and build the instrumented macOS release bundle:

```sh
node --import tsx tools/native-launch/build-reviewer.mts
cd tools/native-launch
npx tauri build --config tauri.reviewer.conf.json --features readiness-trace \
  --bundles app -- --locked
python3 measure-readiness.py \
  "target/release/bundle/macos/mastermind launch check.app/Contents/MacOS/mastermind-launch-check"
```

The feature enables `reviewer`; the reviewer configuration is still required to select its assets.
The harness reports five observations and their median, range, fixture size, and executable hash.
Its tiny public fixture measures plain-text startup only. It is a different workload from the
27 KB document used for the memory observations recorded at `f638221` in [results](../results.md).
Do not compare these observations as timings for that memory workload.

Run the deterministic renderer gate checks with
`node --test tools/native-launch/check-readiness-script.cjs` from the repository root. Native
configuration, fixture markers, admission identity, and one-shot checks run in
`cargo test --all-features --locked`.

Run cleanup ownership checks with `python3 tools/native-launch/check-readiness-harness.py`.
