# Marketing site

This directory contains the inherited upstream Mastermind landing page. Its package-install links,
review-loop copy, language setup, screenshots, and skill examples describe that upstream release;
they are not release or setup guidance for this fork. The fork's current usage is documented in the
[root README](../README.md) and [agent setup](../assets/agent/README.md).

The site is a separate static Astro package with Preact islands for the terminal and mark
playground. [The page](src/pages/index.astro) composes bilingual content from `src/data/`, with
screenshots in `src/assets/shots/`. [Astro configuration](astro.config.mjs) defines the
integrations; the scripts in [package.json](package.json) run development, build, and preview from
this directory.

The inherited visual concept presents the page as a Markdown document being reviewed. Its modular
grid and restrained typography keep that document legible, while CriticMarkup colors identify the
review marks. Site styles and tokens live in `src/styles/`, and bundled fonts live in
`public/fonts/`. The current styles and page interactions include reduced-motion handling. These are
descriptions of the existing site, rather than personal design preferences or constraints on the
fork's application.
