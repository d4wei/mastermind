# Three-way text merge

`mergeText(base, local, incoming)` uses the MIT-licensed `node-diff3` dependency, pinned in
`package.json` and the lockfile. The desktop asset build includes its license under `licenses/`.
Its structured region API distinguishes clean output from overlap; no conflict-marker text is
returned. Equal inputs take direct paths. Otherwise exact line tokens
retain whitespace, CRLF, and the final newline. The caller owns any line-ending normalization.

The library's default whitespace splitting is intentionally unused. Character, line, and matching
line-pair limits bound input and repeated-line work before entering its longest-common-subsequence
algorithm. Limits return `limit`, leaving the recovery UI to offer incoming adoption or saving a
copy. This is a conservative text merge, not a syntax-aware or semantic merge.

The [library API](https://github.com/bhousel/node-diff3#3-way-diff-and-merging) supplies structured
regions. Git's [three-input merge model](https://git-scm.com/docs/git-merge-file) is the
reference behavior; invoking Git would require an additional runtime. `tests/merge.test.ts` checks
separated and overlapping edits, insertions/deletions, exact whitespace, review syntax, metadata,
line endings, final newlines, and limits.
