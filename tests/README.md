# Regression checks

The suite follows behavior across layers. Pure document tests check source offsets, exact splices,
malformed markup, line endings, and translation validation. DOM tests check renderer selection,
composition, review controls, and real CodeMirror history. Store tests exercise document-owned
buffers, save and read races, conflict recovery, and shutdown using a fake host.

Host adapters own native command adaptation; Rust tests check the native filesystem
implementation. [Desktop checks](../tools/desktop/README.md) cover process
startup, OS transports, packages, and installed webviews beyond unit tests.

Small helpers under `helpers/` share React mounting, input events, Markdown rendering, and host
setup. Each test keeps its own source bytes, timing decisions, and expected result visible.

[Manual interactions](manual/review-interactions.md) covers visual and native input checks. Use
copies of that document or the reading samples in `fixtures/` for exploratory checks. The fixture
files are preserved source samples, not an automatically executed parser corpus; the automated
source-preservation cases carry explicit inputs and expected bytes in their tests.
