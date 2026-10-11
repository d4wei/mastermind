---
status: living
updated: 2026-10-10
exit: naming choices are accepted or rejected and adopted terms live with their owning features
---
# Terminology review

These are naming proposals for the application at `e5c501d`, not adopted labels or schema changes.
The exercise covers distinct concepts in the UI, agent instructions, configuration, file formats,
implementation contracts, and design documents. Related inflections and synonyms are grouped.
Ordinary verbs and third-party names are included in the retain inventory rather than given new
names. Internal variables that introduce no distinct concept are outside this vocabulary review.

For each family, test the name in context: can a new reader predict what changes, distinguish it
from neighboring concepts, and understand it in English or Simplified Chinese? A permanent name
should describe behavior, not the conversation that produced it. Public labels can be short while
technical names identify the precise operation or data being discussed.

## Recommended changes at a glance

| Current wording | Proposed public wording | 简体中文 |
| --- | --- | --- |
| Comfort language | Translation language | 译文语言 |
| UI language | Interface language | 界面语言 |
| Repo language | Project language | 项目语言 |
| Source, as an editor mode | Markdown | Markdown |
| Author tag, in Settings | Comment name | 评论署名 |
| Prepared translation, in notices | Translation | 译文 |
| Edits, as a review search filter | Suggested edits | 修改建议 |
| Original thread, in resolved history | Discussion | 讨论 |
| Base / Local / Latest disk / Result | See the comparison exercise below | 见版本比较 |
| Session, in document errors | Open document | 已打开的文档 |
| Typeface | Font preset | 字体预设 |
| Code color | Syntax colors | 语法配色 |
| Content width | Reading width | 阅读宽度 |
| Smart open | Open selected files | 打开所选文件 |
| Ablation | Removal and refactoring | 移除与重构 |
| Wrapper, in product descriptions | Desktop app | 桌面应用 |

The recommendations below explain alternatives and preserve distinctions that a bulk replacement
would lose. In particular, project language is a policy; it is not a document's detected language.

## 1. Language roles

Evidence: [preferences][preferences], [settings][settings], [translation format][translation],
[language rulings][decisions], and [open repository configuration][direction].

### Personal translation preference

`comfortLang` selects the language of an available translation; `null` means original-only reading.
It does not generate a translation or change labels and menus.

Candidates: **Translation language**, **Preferred reading language**, **Reading language**.
Recommend **Translation language / 译文语言**. It identifies the affected feature. Reading language
could mean the original document's language, while comfort is a personal motivation rather than a
setting's effect. Preferred adds length without resolving a distinct ambiguity.

Try: “Translation language: 简体中文.” Helper: “Use available translations in this language.”
Use **Original only / 仅原文** for the null option instead of a contextless Off.
Proposed personal config key: `translationLanguage`; retain `null` as the original-only value.

### Interface language

`uiLang` controls labels and notices independently of document content.
Candidates: **Interface language**, **App language**, **UI language**.
Recommend **Interface language / 界面语言**; it names the affected surface without an acronym.
Try: “Interface language: English. Translation language: 简体中文.”
The technical phrase UI language and existing `uiLang` key remain understandable; no key rename is
needed merely to spell out its UI label.

### Original and translated languages

`sourceLang` and `targetLang` are explicit codes for one translation. They are not inferred from the
last comment, interface setting, or repository identity.
Candidates for prose: **Original language**, **Document language**, **Source language**.
Recommend **Original language / 原文语言** in explanations and retain **source language / 源语言**
and **target language / 目标语言** in translation APIs and CLI flags.
Document language can overstate the uniformity of a mixed-language file.

Try: “Translate this document from English to 简体中文.” A translation's target language can differ
from another reader's personal preference. `targetLang` therefore remains distinct from the
proposed personal `translationLanguage` setting.

### Repository communication policy

The settled role concerns communication and bookkeeping across a repository; storage and discovery
are not implemented. It does not declare every file to be written in that language.
Candidates: **Project language**, **Repository language**, **Working language**.
Recommend **Project language / 项目语言** for a future public setting, qualified in its explanation:
“Language for project communication and records.” Use **repository language policy** in technical
contracts so its scope remains explicit. Working language could mean a person's preference.

This label does not authorize expanding the setting beyond a repository. If that scope distinction
is considered essential in the label itself, **Repository language / 仓库语言** is the alternative.
Do not call it Default document language unless a later ruling gives it that behavior.

## 2. Views and language switching

Read/Source currently switches rendered text and the Markdown editor. Original/translated reading
is a different choice. See [the toolbar][toolbar].

Candidates for the editor: **Source**, **Markdown source**, **Markdown**.
Recommend **Read / 阅读** and **Markdown / Markdown** as the short mode labels. Use **Markdown
source / Markdown 源文本** in explanatory prose. This avoids using source for both an editor and
one side of translation; 源码 also suggests program code.

Keep **Original / 原文** and **Translation / 译文** for document language views. Show a language name
when the available translation is known. Reading language remains a useful description of this
view choice, not another name for the persistent translation preference.

Try: “Open Markdown to edit the original text.” / “切换到 Markdown 编辑原文。”
Try: “Show original.” / “显示原文。”

## 3. Translations and their lifecycle

Evidence: [translation format][translation], [local storage][prepared], and
[reading behavior][view].

Candidates for the reader-facing object: **Translation**, **Prepared translation**, **Saved
translation**. Recommend **Translation / 译文** in the UI. Agent instructions can say **prepare a
translation / 准备译文** because they describe the work. Saved translation can imply a separate
reviewable document; the current file is a derived reading aid.

Replace 预备翻译, which sounds unfinished, with 译文. “No translation is available in this language.
Showing the original.” / “暂无此语言的译文，显示原文。”

For developers, use **translation file** for the JSON on disk and **translation data** for its
validated in-memory value. **Prepared translation artifact** is accurate when discussing the whole
build/read pipeline, but plain artifact adds no information in a user message.

Distinguish these states instead of overloading fresh:

| Meaning | Public wording | Technical wording |
| --- | --- | --- |
| No saved translation for the requested language | Translation unavailable | Missing file |
| Translation input changed | Translation needs updating | Fingerprint mismatch |
| Translation cannot be read or validated | Could not load translation | Read/validation failure |
| Agent generated the whole translation again | Newly prepared translation | Fresh preparation |
| Stored input matches current input | Translation matches the document | Matching fingerprint |

Matching does not establish translation quality or that the agent considered every dependency.
Do not label it Verified translation, Up to date with the project, or Approved translation.

Candidates for `publishTranslation`: **publish**, **save**, **write**.
Recommend **save translation / 保存译文** in instructions and **savePreparedTranslation** if the
internal function is renamed. The operation validates and replaces a local file; publish suggests
a remote audience. The existing CLI `--save` already uses the clearer verb.

## 4. Translation structure and freshness checks

These names belong in implementation and agent documentation, not ordinary reading controls.

| Current terms | Proposed canonical term | Meaning |
| --- | --- | --- |
| Block | Translation block | A segmented source unit; lists split into items |
| Literal/context block | Context block | Included as context, not offered for translation |
| Block ID | Translation block ID | Position-based ID within one preparation |
| Projection, narrative | Translation input | Ordered content used to prepare and validate |
| Source hash, fingerprint | Translation fingerprint | Hash of that input, not raw file bytes |
| Translation snapshot | Prepared translation | Complete data from one preparation |
| Translated selection | Quoted translated passage | Exact selected text retained in feedback |

Candidates for narrative: **translation input**, **translation projection**, **document content**.
Recommend translation input in prose and **translation projection** for the transformation itself.
Narrative sounds prose-only, but code and metadata also affect the fingerprint.

Candidates for source hash: **document hash**, **translation fingerprint**, **content version**.
Recommend translation fingerprint: comments, resolved history, and line-ending differences can leave
it unchanged. A document hash would imply hashing all source bytes. Proposed serialized field:
`translationFingerprint`, subject to the format-change checkpoint below.

Try: “Prepare every translation block again; block IDs belong to this translation input.”
Keep **Markdown block** for parser structure and **selected passage** for text the reader selects.
Do not promise a persistent block identity or character-by-character translation alignment.

## 5. Names, signatures, and agent roles

Evidence: [author defaults][preferences] and [public protocol][protocol].

Candidates for the Settings field: **Comment name**, **Comment signature**, **Author tag**.
Recommend **Comment name / 评论署名**. The reader supplies a name; the app writes an `@name:`
signature. Author can be mistaken for the document's author, and tag sounds like a category.
Comment signature is accurate but can suggest a full signature block.

Try: “Comment name: Alex. Your comments will be signed @Alex.”
Keep **author tag** in protocol documentation and `authorTag` in code: there it names actual syntax.
A signature records attribution, not an authenticated identity.

The prose currently alternates among preparing agent, prep agent, session agent, invoking agent,
and receiving agent. Do not turn these into permanent jobs or assume they are all the same process.
Candidates: **your agent**, **invoking agent**, **agent preparing the document**.
Recommend **your agent / 你的智能体** in product copy. Use **invoking agent** for the tool caller,
**agent preparing the document** for translation preparation, and **agent reading the feedback**
for later review. A different agent can read the same file.

Try: “The agent preparing the document also prepares its translation.”
Try: “When an agent reads feedback, it treats resolved discussions as history.”
Use **coding-agent tool / 编程智能体工具** publicly and **agent harness** technically for the
software that hosts the agent and installs skills. It is distinct from mastermind's native host.

## 6. Review marks and proposed edits

Evidence: [CriticMarkup model][marks], [public protocol][protocol], and [UI labels][labels].

Keep **CriticMarkup** as the format's proper name and **review mark / 评审标记** as the generic
construct. Its kinds remain insertion, deletion, substitution, highlight, and comment.
Use **suggested edit / 修改建议** for an unaccepted insertion, deletion, or replacement; in the
protocol, proposed edit is an equivalent description rather than a different object.

Candidates for the search filter currently called Edits: **Edits**, **Suggestions**, **Suggested
edits**. Recommend Suggested edits; edits alone could include changes already applied to the file.
Keep **Accept / 接受**, **Reject / 拒绝**, and **Suggest deletion / 建议删除** as actions.

Try: “Find in suggested edits.” / “在修改建议中查找。”
Technical `suggestion` and `CriticKind` need no rename. A UI-only edit proposal and a CriticMarkup
mark already stored in the file have different persistence states; the term suggestion does not
establish whether either has been accepted.

Keep **highlight / 高亮**. Explain **comment anchor** in developer docs as the source passage
associated with a discussion. Use **commented passage / 评论所指文本** for readers. Distinguish a
highlight anchor from a translated comment's source-block association.

## 7. Comments, discussions, and resolution

Candidates for a comment plus replies: **Discussion**, **Thread**, **Conversation**.
Recommend **discussion / 讨论** in product copy, **comment thread / 评论串** in parser and storage
contracts. Conversation risks confusion with the agent chat. Keep Comment and Reply for individual
messages and the action of adding one.

Candidates for completing a discussion: **Resolve**, **Mark resolved**, **Archive**.
Recommend **Resolve / 标为已解决** as the action and **Resolved discussions / 已解决的讨论** as the
panel title. Archive describes storage, not whether the discussion is finished. Resolution does
not accept a proposed edit. Keep **Delete comment / 删除评论** for removing one comment.

Try: “Resolve moves this discussion to the document's resolved history.”
Try: “Delete comment removes this comment; undo restores it.”
The existing Resolved shorthand can remain where space is limited.

Use **discussion** instead of Original thread in the history panel; **quoted passage / 引用片段**
instead of the vague Context label. Context can remain in the serialized record, whose exact
meaning is defined in [the archive contract][archive].

Technical distinctions to keep:

- **Resolved-discussion record:** one encoded record at the file tail.
- **In-file archive:** the collection of those records; not a second feedback store.
- **Review undo history:** temporary previous buffer values, not resolved discussions.
- **Version history:** older document versions, for example Git history; not a shipped history UI.
- **Point comment:** a comment without a highlighted anchor. Publicly say comment on this block;
  paragraph comment is too narrow for headings, lists, and tables.

Hidden means omitted from rendered reading. It does not mean private or inaccessible in Markdown.
Keep the stored `mastermind:resolved-thread v1` and `translated-selection v1` markers unchanged.

## 8. Conflicting versions and saving

Evidence: [comparison state][store] and [file writes][files]. Both the app buffer and disk are
local, so Local does little to distinguish them. Latest disk can become false after another edit.

| Current heading | Proposed heading | 简体中文 |
| --- | --- | --- |
| Base | Base version | 基准版本 |
| Local | Your edits | 你的编辑 |
| Latest disk | File on disk | 磁盘文件 |
| Result | Merge result | 合并结果 |

Candidates for Base: **Base version**, **Last saved version**, **Before edits**.
Recommend Base version with “The version loaded or saved before these conflicting changes.”
Last saved version can imply the latest disk contents or that the app itself saved it. The base
may have come from opening or reloading a file.

Candidates for Result: **Merge result**, **Merged version**, **Result**.
Recommend Merge result with “Edit this text to combine the changes.” It starts as a copy of Your
edits; no automatic merge has happened. Do not call it Suggested merge or imply a merged result
was computed by the app.

Use **Compare versions / 比较版本**, **Refresh versions / 刷新版本**, **Use disk version / 采用磁盘版本**,
and **Save merge result / 保存合并结果**. The first three comparison panes are captured versions;
“Your edits” does not promise a live view while editing the merge result.

Try: “Saving paused. Compare your edits with the file on disk.”
Try: “The versions changed. Refresh them before saving the merge result.”
Keep **autosave / 自动保存** and **saving paused / 保存已暂停**. In notices use unsaved changes rather
than dirty buffer; technical clean/dirty buffer terminology remains useful.

## 9. Document lifetime, sessions, and drafts

Evidence: [document sessions][sessions], [state ownership][store], and [lifetime ruling][decisions].

Candidates for the public object: **Document**, **Review session**, **Open document**.
Recommend **open document / 已打开的文档** when lifecycle matters, otherwise document. A current
server session is a per-file registry object; the intended app session is the app's whole lifetime.
Use **document session** only for that existing server object and **app session** for app lifetime.
Use **document buffer** for unsaved in-memory text, and **review state** for the broader state.

Try: “This document is no longer open. Open the file again.”
For the deferred feature, candidates are Session restoration, Resume review, and Restore open
files. Recommend **Restore open files / 恢复已打开的文件** for the narrow public capability, with
**review-state restoration** as the technical scope under discussion. That wording does not decide
which buffers, positions, or panels will persist; restoration remains deferred.

Untitled draft means the temporary file created by `new`; conflict draft means a retained editable
comparison. Recommend **untitled document / 未命名文档** if describing the first and **merge result**
for the second. Do not rename draft-only code ahead of its approved removal.

## 10. Version, revision, snapshot, and source

Keep the ordinary engineering vocabulary, but qualify it where several kinds meet:

| Unqualified term | Qualified term | What it identifies |
| --- | --- | --- |
| Source | Document buffer | Current in-memory Markdown, normalized to LF |
| Source | Disk contents | Bytes read from the file |
| Version | Disk version token | File identity and content used to guard a write |
| Revision | Buffer revision | Counter guarding asynchronous buffer operations |
| Version | Editor reset counter | `externalVersion`, which remounts the editor |
| Version | Format version | Version of a serialized schema |
| Revision | Git revision | A commit or other Git reference |
| Snapshot | Comparison snapshot | Captured content used in conflict comparison |
| Range/span | Source range / mark span | UTF-16 positions, including defined delimiters |
| Splice | Source splice | Replace an exact range without re-rendering Markdown |

Candidates for snapshot: keep it qualified, replace every occurrence with version, or invent a
new product object. Recommend qualification. Version does not necessarily contain the captured text,
and a new noun would add vocabulary without a new capability.

Do not automatically rename `version` inside a clearly typed response or every `source` parameter.
Rename misleading boundary fields deliberately; preserve byte-preserving round trip as an invariant,
not a feature brand. Fingerprint and disk version token are different checks.

## 11. File opening, navigation, and the desktop runtime

Smart open currently means the agent chooses files using its judgment; there is no separate smart
selection algorithm in the app. Candidates: Smart open, Review selected files, Open selected files.
Recommend **Open selected files / 打开所选文件** for the operation and **agent-selected files** when
explaining selection responsibility. Keep `open` as the concise typed command.

Keep **Files / 文件**, **Recent / 最近**, **Outline / 大纲**, **file tree / 文件树**, and **Filename /
文件名**. Use **workspace / 工作区** only for the existing rooted tree feature; **repository / 仓库**
means a version-controlled project and is not a synonym for any folder. The workspace is scheduled
for removal, so new product copy should describe opening files, not a renamed workspace product.

Candidates for the container: **Desktop app**, **Desktop wrapper**, **App-mode container**.
Recommend **desktop app / 桌面应用** publicly and **Tauri host / Tauri 宿主** in architecture docs.
Keep **native host**, **host bridge**, and **IPC** as technical terms, defined on first use. The
bridge carries specific document operations between the web interface and privileged local code.

Current save errors mention a daemon, including untranslated English in Chinese notices. Use
**local file service / 本地文件服务** in current recovery guidance; retain daemon for developer
commands describing the existing background process. Desktop wording should describe a save failure
and recovery action without inventing a replacement background service.

## 12. Appearance and layout

Evidence: [settings][settings], [font presets][fonts], [syntax colors][colors], and
[themes][themes].

Candidates for Typeface/type set: **Font preset**, **Font pairing**, **Typography preset**.
Recommend **Font preset / 字体预设**: it selects heading/body families and associated styling, and
some presets use the same family for both. Pairing overemphasizes two distinct fonts; typography
preset is more technical. A later implementation can rename `typeSet` to `fontPreset` together with
its registry if that improves the contract; this is not necessary for the label change.

Candidates for Code color: **Syntax colors**, **Syntax highlighting**, **Code color scheme**.
Recommend **Syntax colors / 语法配色**. The choice is among color palettes or Off; highlighting alone
can be confused with review highlights. Keep named palettes Soft, Vivid, Warm, with 柔和、鲜明、暖色.

Candidates for Content width: **Reading width**, **Text width**, **Content width**.
Recommend **Reading width / 阅读宽度** because the control sets the document column's measure.
Keep Font size, Line height, Theme, Appearance, Film grain, Texture, and System default.
For grain textures use 细腻、柔和、粗糙; 粗粝 is unusually literary for a setting.

Keep theme names **Grid**, **Nacht**, and **Sepia** and actual font-family names as proper names.
The font preset also called Grid can become **Schibsted**, matching its family and avoiding a false
association between choosing that font and changing the Grid theme. Keep its stored ID unless a
coordinated registry change is approved. No new creative preset names are needed.

Use **Comments / 评论** in visible controls, **comment sidebar / 评论侧栏** in user explanations,
and **comment rail** for the margin-layout implementation. Keep **callout / 提示块** and its
Decisions, Open questions, To-do, and Risks heading families. Keep **frontmatter** technically;
use **document metadata / 文档元数据** when introducing its purpose to a reader. Do not call raw
frontmatter Properties as if a typed property editor already exists.

Use **Block actions / 内容块操作**, not 段落操作, for an action menu that can apply to nonparagraph
blocks. Review badges should spell out localized categories rather than `3c 2e 1h`.
Try: “3 comments, 2 suggested edits, 1 highlight.” / “3 条评论、2 条修改建议、1 处高亮。”

## 13. Workflow and design-document vocabulary

Candidates for ablation: **Removal plan**, **Removal and refactoring**, **Simplification**.
Recommend **removal and refactoring / 移除与重构**: it says which work happens, whereas ablation can
mean an experiment that removes one variable to measure its effect. Simplification describes a hope.

Keep **review workflow** for the sequence of actions and **review protocol** for file syntax and
agent behavior. “The file is the protocol” remains a concise explanation when followed by the actual
meaning: the document and review feedback travel in the same Markdown file.

Use **translation preparation** instead of prep pass in durable instructions. Use **desktop
migration** for moving runtime responsibilities. Batch, track, arc, and workstream can describe a
specific plan's organization; they should not become permanent module or feature names.

Keep **Decision**, **Open question**, **Deferral**, **Gap**, and the ledger verdicts Ruled,
Measured, Ratified in their defined operating-document roles. They are not app controls. The word
Decisions in a document callout denotes a section of the reviewed document, not this repository's
binding `DECISIONS.md` ledger.

## 14. Retire vocabulary with the feature, not before it

| Term or family | Disposition |
| --- | --- |
| Hand back, completion summary, waiting review process | Historical descriptions only |
| Live translation queue, listener, separate translator | Historical removal rationale only |
| Preferred/secondary language pair | Historical configuration model only |
| New draft, draft naming, `new` | Remove with the draft workflow |
| Workspace and its badges/tree-specific session names | Remove with the workspace workflow |
| Browser-choice preference, `--in`, app-mode container | Remove with the browser launch workflow |
| `install-agents`, global injection | Remove with app-owned harness installation |
| Daemon, status, stop, health probes | Retain technically until native ownership replaces them |
| Keep mine, Reload (discard mine), Save anyway | Check callers; remove unused message keys |
| Squad, light/heavy track | Historical provenance, not current product vocabulary |

Do not turn an abandoned feature into a naming problem. The inherited marketing site describes the
original release; its Hand back text remains historical until a site refresh is explicitly scoped.
“Upstream” and “fork” remain precise in attributed provenance and contribution discussions.

## 15. Brand and distribution identity

The product name **mastermind** is settled. **Mastermind** names Kevin Ding's original project.
Keep third-party names such as Markdown, CriticMarkup, Tauri, Electron, CodeMirror, React, and Git.
The actual package, command aliases, and config path currently retain inherited identifiers.

For eventual npm distribution, candidates include a scoped package such as `@d4wei/mastermind`
and a descriptive unscoped package such as `mastermind-review`. A scoped package preserves the
chosen display name and identifies its publisher; an unscoped name is shorter to type but adds a
second public identity. These are unverified candidates, not availability or account-ownership
claims. Desktop distribution may not require an npm package at all.

Recommend keeping **mastermind** as the display name and **open** as the launch operation; settle
package, executable, application ID, and config-directory collisions together with the desktop
launch contract. Display styling alone does not solve installation collisions.

## Retain inventory and coverage check

The exercises above cover the project-specific and overloaded concepts. The remaining terms below
have direct, ordinary meanings in their current context and need no new names.

| Family | Retain |
| --- | --- |
| Basic actions | Save, Cancel, Close, Undo, Find, Refresh, Reload, Show, Hide, More, Dismiss |
| Review | Review, Comment, Reply, Resolve, Delete comment, Accept, Reject, Highlight |
| Edit kinds | Insertion, Deletion, Substitution/replacement, Suggested edit |
| Navigation | File, Folder, Files, Recent, Outline, Filename, Selection |
| Status | Loading, Saving, Saved, Unsaved changes, Missing file, Save failed |
| Preferences | Settings, Appearance, Theme, Font size, Line height, System default |
| Grain | Film grain, Texture, Off, Low, Medium, High, Fine, Soft, Coarse |
| Language chooser | Search languages, No matching language, Custom language code |
| Markdown | Heading, Paragraph, List item, Table, Code block, Frontmatter, Callout |
| Source mechanics | Parser, Renderer, Source offset, UTF-16 range, Source splice, Line ending |
| Storage mechanics | File watcher, Disk read/write, Atomic replacement, Version token |
| Runtime | Event, Store, API, IPC, Native dialog, Window, Host bridge |
| Design | Theme token, Font family, Palette, Icon, Focus ring, Selection toolbar |
| Agent integration | Skill, Alias, Agent harness, CLI command, Flag, Standard input/output |

Sources inspected include every English/Chinese entry in [the UI dictionary][labels], the settings
and review controls, CLI commands, public skills, shared types, technical sidecars, project docs,
and inherited site terminology. This is a concept inventory, not a claim that every code identifier
must become part of the product's public vocabulary.

## Adoption sequence after review

1. Decide the proposed public names and example wording, especially language roles, comment names,
   comparison panes, and font presets. Keep accepted product semantics unchanged.
2. Change labels, accessibility text, help, documentation, and examples together. Remove unused
   labels only after checking callers. Add focused behavior checks where meaning changes.
3. Rename `comfortLang` and misleading translation boundary names only as coordinated contract
   changes: config validation/persistence, CLI, producer/consumer code, skills, and tests. A saved
   personal preference is not the same thing as an obsolete translation cache; make its treatment
   explicit instead of silently losing it.
4. Changing serialized translation keys requires an explicit format/version choice because readers
   reject unknown fields. Keep existing in-document review markers stable. If a format rename is
   not worth that cost, keep its wire name and document the canonical concept beside it.
5. Apply the new vocabulary to the desktop design as its contracts are implemented. Retire this
   review document when its choices have been resolved; retain definitions beside their features.

[preferences]: ../src/server/config.md
[settings]: ../src/ui/settings/SettingsPanel.tsx
[translation]: ../src/shared/translation.md
[decisions]: ../DECISIONS.md
[direction]: ../DIRECTION.md
[toolbar]: ../src/ui/app/TopBar.tsx
[prepared]: ../src/server/translate/prepared.md
[view]: ../src/ui/translate/README.md
[protocol]: ../.claude/skills/mastermind/reference/review-protocol.md
[marks]: ../src/shared/critic/types.ts
[labels]: ../src/ui/i18n/index.ts
[archive]: ../src/shared/review-archive.md
[store]: ../src/ui/app/store.md
[files]: ../src/server/files.md
[sessions]: ../src/server/sessions.ts
[fonts]: ../src/shared/fonts.ts
[colors]: ../src/shared/codeThemes.ts
[themes]: ../themes/README.md
