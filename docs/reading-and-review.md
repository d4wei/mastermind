---
status: living
updated: 2026-10-15
exit: The chosen comment design ships and its contract moves beside the implementation.
---

# Reading and review refinement

The reading rhythm, scrollbar, Suggest change action, comment targets, and empty home are now
specified beside their implementations in [the layout contract](../ui/app/layout.md) and
[the native adapter](../ui/desktop/README.md). The remaining design choice is the comment card.

## Comment-card comparison

Prepare three interactive takes using identical English and Chinese content, single comments, and
replies. All use compact interface typography, a secondary quoted passage, and an overflow action
for deletion. Resolve belongs to the discussion; Delete comment belongs to an individual message.
No invented timestamps, avatars, accounts, or permissions are implied by the file format.

- **A — Compact card:** author and actions in the header, a small quote, message, and reply footer.
  The closest fit to familiar document review. Recommended starting point.
- **B — Margin note:** minimal enclosure, a vertical active indicator, and a quiet action row.
  Less visual weight beside prose; weaker separation in a crowded discussion margin.
- **C — Conversation:** quote at the top, messages separated into a compact thread, and an always
  visible reply field. More inviting for discussion, with a taller footprint.

[Google Docs][google-comments] puts deletion in More and resolution at the thread level.
[Notion][notion-comments] distinguishes passage comments from page discussions. These are
interaction references; the comparison will retain mastermind's file-based attribution and review protocol.

Choose a card treatment after viewing the interactive comparison in the development conversation.

[google-comments]: https://support.google.com/docs/answer/65129
[notion-comments]: https://www.notion.com/help/comments-mentions-and-reminders
