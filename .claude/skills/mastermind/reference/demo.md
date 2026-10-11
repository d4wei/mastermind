# Welcome to mastermind

This is a demo document. mastermind renders Markdown **and** your review marks,
and can show a prepared translation in your optional translation language.

## What you're looking at

The file on disk is the single source of truth — no database, no cloud. An agent
writes a plan here; you mark it up; it reads the same file back.

> People and agents can both leave author-tagged comments. The file carries the discussion;
> saved edits need no separate hand-back action.

## How to review

- **Comment on a passage** — select some text (or hover a paragraph and use the
  button on its right) and choose *Comment*. The passage is highlighted and your
  note rides along. {==This sentence carries a comment.==}{>>@alice: Is this example clear?<<}
  {>>@codex: Yes; this reply stays beside the question.<<}
- **Suggest a deletion** — select text or a whole block and choose *Suggest
  deletion*. It stays visible but {--struck through--}, so you can see what's queued
  for the agent. Changed your mind? Click the struck-through text to undo it.

Use **Resolve** when a discussion is finished: it moves into the file's hidden archive and remains
available in **Resolved**. **Delete comment** removes just that comment without keeping a record.
Use Undo to reverse either action.

## A small table and some code

| Surface  | Purpose      |
| -------- | ------------ |
| Read     | review marks |
| Markdown | source text  |

```ts
function greet(name: string): string {
  return `Hello, ${name}`
}
```

If a translation has been prepared, toggle to your translation language. Select a translated passage
to comment on its original block; the comment keeps the selected translation as context.
