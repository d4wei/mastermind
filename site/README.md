# Marketing site

This directory contains the landing page from Kevin Ding's
[Jingquank/Mastermind](https://github.com/Jingquank/Mastermind) at `3687c91` (v0.2.1). Its install
links, review-loop copy, language setup, screenshots, and skill examples describe that release.
For the application in this repository, use the [root README](../README.md) and
[agent setup](../assets/agent/README.md).

The site is a separate static Astro package with Preact islands for the terminal and mark
playground. [The page](src/pages/index.astro) composes bilingual content from `src/data/`, with
screenshots in `src/assets/shots/`. [Astro configuration](astro.config.mjs) defines the
integrations; the scripts in [package.json](package.json) run development, build, and preview from
this directory.

The inherited visual concept presents the page as a Markdown document being reviewed. Its modular
grid and restrained typography keep that document legible, while CriticMarkup colors identify the
review marks. Site styles and tokens live in `src/styles/`, and bundled fonts live in
`public/fonts/`. The current styles and page interactions include reduced-motion handling.
