---
status: living
updated: 2026-10-29
exit: Ship the selection contract, move it beside the implementation, and delete this design.
---

# Reliable review selections

A reader should be able to select ordinary rendered prose without understanding Markdown syntax.
The selection toolbar must distinguish an unsupported target from an interaction that failed.

Positional source provenance, formatting-aware fragment planning, selection coverage with exclusion
reasons, and structural verification of review edits have shipped; their contract lives in
[selection mapping](../ui/modes/reading/selection.md) and
[review boundaries](../document/markdown/scan.md). This design keeps the remaining work.

## Remaining findings

- **Multi-fragment comments:** only the first fragment anchors the comment. The composer now says
  so; a quoted-passage fallback would let one comment cover the whole selection.
- **Opaque blocks and generated text:** code blocks, raw HTML, frontmatter, and display labels are
  explained but cannot receive any comment. The current protocol cannot encode active inline marks
  inside them, and they have no quoted alternative yet.
- **Existing discussions:** a selection inside an existing discussion is explained, but the toolbar
  does not yet offer to open that discussion for a reply.
- **Native boundaries:** the fixture matrix runs in jsdom. Native WebKit selection boundaries, fast
  drags, and keyboard selection still need checking against it.

## Quoted comments

When no single exact comment highlight exists, offer an explicitly labeled quoted-passage comment,
attached at a verified nearby block. Retain the entire quote, not just the first fragment.

- **Partial code:** offer an explicit whole-span selection or a comment with the exact selected
  quote.
- **Opaque block:** offer a quoted comment only when a valid adjacent attachment exists; otherwise
  offer Copy.
- **Generated text or unknown mapping:** offer Copy and retain the selection. Offer Markdown
  navigation only when a reliable containing source location exists.
- **Existing discussion:** offer to open it for a reply. Do not nest highlights.

Quoted comments are a proposal, not a shipped fallback. Settle their public in-file representation
before implementation: reuse existing quote-handling machinery where appropriate, preserve literal
quotes safely, and make attribution and attachment understandable to an agent reading the file.
A fallback must not reintroduce a private database channel. Do not attach a comment before leading
frontmatter or assume every opaque block has a legal neighboring attachment.

## Implementation plan

1. Add the local fallback UI and the agreed quoted-comment representation. Keep comments and
   suggestions separately available. Preserve drafts through failures and focus changes; provide
   English and Chinese explanations without exposing internal parser terms.
2. Validate the fallback at both ends as the shipped marks are: the markup reparses as intended,
   unrelated Markdown structure stays intact, and removing it restores the original bytes.
3. Verify in native WebKit with the reported selection shapes and fast interactions. Run all tests,
   both typechecks, and the desktop build before replacing the live instance. Graduate the
   remaining contracts into module docs and delete this plan.

## Review points

The recommended fallback is a comment retaining the exact quote, attached at a verified block,
rather than widening the selection automatically. The representation and attachment behavior need
agreement before building it.
