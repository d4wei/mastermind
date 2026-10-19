# Reading presentation

`Renderer.tsx` renders the parsed Markdown tree while retaining source offsets for review edits.
Each table sits inside a labeled, keyboard-focusable horizontal scroll region. The table retains
its header/cell semantics and source positions; overflow does not widen the reading column or move
document controls. Print rendering exposes the full table rather than clipping the scroll region.

Fenced code passes its explicit language to `highlight.ts` only when a Code color scheme is enabled.
The tokenizer recognizes aliases for its supported language families; it does not detect languages
from code content. Missing or unsupported labels remain plain. The current tokenizer approximates
syntax rather than using complete language grammars; YAML is currently unsupported. Token text
concatenates to the original block text, including line endings. Coloring never changes the source.
