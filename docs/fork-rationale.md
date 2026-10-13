---
status: historical
updated: 2026-10-13
---
# Project origins

This document preserves the design rationale inherited from Kevin Ding's
[Jingquank/Mastermind](https://github.com/Jingquank/Mastermind) at `3687c91` (v0.2.1, MIT).
Historical rationale may receive factual or link corrections; it does not govern current behavior.
Current constraints live in [DECISIONS.md](../DECISIONS.md), and the application is described in
[README.md](../README.md). Implementation history is retained in Git.

## What upstream got right

The retained design commitments come from the original [product brief][upstream-product] and
[design guide][upstream-design]. The current [product overview](product.md) and
[theme contract](../themes/README.md) describe this application.

[upstream-product]: https://github.com/Jingquank/Mastermind/blob/3687c91/PRODUCT.md
[upstream-design]: https://github.com/Jingquank/Mastermind/blob/3687c91/DESIGN.md

- **"The file on disk is the protocol."** A plan and its CriticMarkup feedback travel together.
  Upstream also appends a hand-back summary. A reviewer or agent can participate with a text editor;
  the review does not depend on an account, a service, or a second store of discussion state.
- **"Reviewer-grade reading experience" and "the document column is sacred."** Typography,
  reading measure, and the margin rail serve long sessions of thinking about a document. Keep
  the quiet reading surface, keyboard shortcuts, and restrained chrome; reviewing with several
  collaborators does not require a dashboard or another toolbar.
- **"Swiss International, in service of reading."** Keep flat surfaces, hairline rules, generous
  spacing, and theme tokens. Accent belongs to controls; review marks carry semantic color in the
  document. The optional code-color preference remains an explicit exception. User-selectable
  fonts and themes support different readers without changing the document's content.
- **"Marks are the data."** Review actions hang off source spans, and accepting a mark is an exact
  splice. Keep byte-preserving source edits without a Markdown serializer rewriting unrelated text.
  Upstream's setup prose also promises a revision diff, but the current code has removed rounds and
  snapshots; that promise is not a shipped capability. The public protocol permits author-tagged
  replies from people and agents.
- **"Local, fast, silent" and the hand-back loop as "the product's spine."** Upstream's per-file
  session, summary, and stdout signal make completion explicit. Keep the underlying principle that
  agents consume files without driving the UI. This application uses continuous saving instead of
  explicit hand-back, as recorded in `DECISIONS.md`.

The original [behaviors plan][upstream-behaviors] adds integration rationale worth retaining:

[upstream-behaviors]:
  https://github.com/Jingquank/Mastermind/blob/3687c91/mastermind-behaviors-plan.md

- **"CLI does everything deterministic."** Skills ask the person, supply language judgment, and
  call shared primitives. Keep the thin harness adapters and shared browser-safe registries so
  different coding agents do not grow divergent implementations of configuration or cache keys.
- **"The agent is the translator."** Offline cache preparation avoids asking one process to drive
  a review and answer its own live translation requests. Hash-keyed blocks reuse unchanged work;
  shared segmentation and target-language selection keep CLI-written entries compatible with the
  browser. Retain agent preparation and optional translated reading. This application uses fresh
  snapshots instead of cached-block reuse and opens files independently of translation.
- **One preferred/secondary language pair.** Setup and the reading toggle share `langPair`, avoiding
  competing preferences. Retain consistent language configuration and optional translated reading;
  `DECISIONS.md` defines repository and optional translation languages in place of a symmetric pair.
- **Portable, reversible provisioning.** Upstream's shared installer and marked global blocks make
  installation reversible across harnesses. Retain portability and clear removal guidance; the
  harness installation ruling in `DECISIONS.md` assigns installation to the invoking harness.

These inherited principles inform the application; current constraints live in `DECISIONS.md`.
