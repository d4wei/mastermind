# Product terminology

This is the authoritative English and Simplified Chinese vocabulary for mastermind, adopted
2026-10-10. Use it in product copy, onboarding, documentation, and new or revised implementation.
It defines names and their meanings; feature contracts remain with their owning modules.
Implementation may still contain earlier labels and identifiers until adoption is complete.

Public labels describe what a reader sees or does. Technical names distinguish the precise operation
or data being discussed. Names must stand on their own without the development conversation.

## Public labels

| Earlier wording | Canonical public wording | 简体中文 |
| --- | --- | --- |
| Comfort language | Translation language | 译文语言 |
| UI language | Interface language | 界面语言 |
| Repo language | Project language | 项目语言 |
| Source, as an editor mode | Markdown | Markdown |
| Author tag, Name, in Settings | Your name | 你的名字 |
| Prepared translation, in notices | Translation | 译文 |
| Edits, as a review search filter | Suggested edits | 修改建议 |
| Original thread, in resolved history | Discussion | 讨论 |
| Base, in conflict comparison | Base version | 基准版本 |
| Local, in conflict comparison | Your edits | 你的编辑 |
| Latest disk, in conflict comparison | File on disk | 磁盘文件 |
| Result, in conflict comparison | Merge result | 合并结果 |
| Session, in document errors | Open document | 已打开的文档 |
| Typeface | Font preset | 字体预设 |
| Code color | Code color scheme | 代码配色 |
| Content width | Text width | 正文宽度 |
| Smart open | Open selected files | 打开所选文件 |
| Ablation | Removal and refactoring | 移除与重构 |
| Wrapper, in product descriptions | Desktop app | 桌面应用 |

The definitions below preserve distinctions across features. Project language is a communication
policy; it is not a document's detected language.

## 1. Language roles

Evidence: [preferences][preferences], [settings][settings], [translation format][translation],
[language rulings][decisions], and [open repository configuration][direction].

### Personal translation preference

`translationLanguage` selects an available translation; `null` means original-only reading.
It does not generate a translation or change labels and menus.

Use **Translation language / 译文语言** for the personal preference that selects an available
translation. Keep it distinct from the original document's language and the interface language.

Example: “Translation language: 简体中文.” Helper: “Use available translations in this language.”
Use **Original only / 仅原文** for the null option instead of a contextless Off.
Preference persistence is defined in [the native setup contract][preferences].

### Interface language

`uiLang` controls labels and notices independently of document content.
Use **Interface language / 界面语言** for labels and menus.
Example: “Interface language: English. Translation language: 简体中文.”
The technical phrase UI language and existing `uiLang` key remain understandable; no key rename is
needed merely to spell out its UI label.

### Original and translated languages

`sourceLang` and `targetLang` are explicit codes for one translation. They are not inferred from the
last comment, interface setting, or repository identity.
Use **Original language / 原文语言** in explanations and retain **source language / 源语言** and
**target language / 目标语言** in translation APIs and CLI flags. These identify the languages of a
translation operation; they do not assert that every passage in a file uses one language.

Example: “Translate this document from English to 简体中文.” A translation's target language can differ
from another reader's personal preference. `targetLang` therefore remains distinct from the
personal `translationLanguage` setting.

### Repository communication policy

The settled role concerns communication and bookkeeping across a repository; storage and discovery
are not implemented. It does not declare every file to be written in that language.
Use **Project language / 项目语言** with the explanation “Language for project communication and
records.” Use **repository language policy** in technical contracts so its scope remains explicit.
The scope remains one repository. Storage, discovery, and defaults remain governed by
[DIRECTION.md][direction]; adopting this label does not implement the setting.

## 2. Views and language switching

Read/Markdown switches rendered text and the Markdown editor. Original/translated reading
is a different choice. See [the toolbar][toolbar].

Use **Read / 阅读** and **Markdown / Markdown** as the short mode labels. Use **Markdown
source / Markdown 源文本** in explanatory prose. This avoids using source for both an editor and
one side of translation; 源码 also suggests program code.

Keep **Original / 原文** and **Translation / 译文** for document language views. Show a language name
when the available translation is known. Reading language remains a useful description of this
view choice, not another name for the persistent translation preference.

Example: “Open Markdown to edit the original text.” / “切换到 Markdown 编辑原文。”
Example: “Show original.” / “显示原文。”

## 3. Translations and their lifecycle

Evidence: [translation format][translation], [local storage][prepared], and
[reading behavior][view].

Use **Translation / 译文** in the UI and **prepare a translation / 准备译文** in agent instructions.
The translation is a derived reading aid; review feedback stays in the original Markdown file.

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

Use **save translation / 保存译文** in instructions and **savePreparedTranslation** as the canonical
name for the operation that validates and replaces a local file. Keep the existing CLI `--save`
flag.

## 4. Translation structure and freshness checks

These names belong in implementation and agent documentation, not ordinary reading controls.

| Earlier terms | Canonical technical term | Meaning |
| --- | --- | --- |
| Block | Translation block | A segmented source unit; lists split into items |
| Literal/context block | Context block | Included as context, not offered for translation |
| Block ID | Translation block ID | Position-based ID within one preparation |
| Projection, narrative | Translation input | Ordered content used to prepare and validate |
| Source hash, fingerprint | Translation fingerprint | Hash of that input, not raw file bytes |
| Translation snapshot | Prepared translation | Complete data from one preparation |
| Translated selection | Quoted translated passage | Exact selected text retained in feedback |

Use **translation input** for the content and **translation projection** for the transformation
that produces it. Code and metadata also affect the fingerprint; input is not limited to prose.

Use **translation fingerprint** for the hash: comments, resolved history, and line-ending
differences can leave it unchanged. It does not hash all source bytes. The canonical field name is
`translationFingerprint`; changing the serialized field requires the format-change checkpoint below.

Example: “Prepare every translation block again; block IDs belong to this translation input.”
Keep **Markdown block** for parser structure and **selected passage** for text the reader selects.
Do not promise a persistent block identity or character-by-character translation alignment.

## 5. Names, signatures, and agent roles

Evidence: [author defaults][preferences] and [public protocol][protocol].

This Settings field supplies the name shown beside comments and written into their `@name:`
signatures in Markdown. It does not name a comment or require an account.

Use **Your name / 你的名字** in Settings. During onboarding ask **What should we call you? / 怎么称呼你？**
Use the helper **This name appears beside your comments. / 这个名字会显示在你的评论旁。**
A person may enter a name or nickname; the wording does not request a legal name or unique username.

Example: “Your name: Alex.” A comment is attributed to Alex and stored with `@Alex:`.
Keep **author tag** in protocol documentation and `authorTag` in code: there it names actual syntax.
A signature records attribution, not an authenticated identity.

Use **your agent / 你的智能体** in product copy. Use **invoking agent** for the tool caller,
**agent preparing the document** for translation preparation, and **agent reading the feedback**
for later review. These describe responsibilities, not permanent jobs or a requirement to use the
same process. A different agent can read the same file.

Example: “The agent preparing the document also prepares its translation.”
Example: “When an agent reads feedback, it treats resolved discussions as history.”
Use **coding-agent tool / 编程智能体工具** publicly and **agent harness** technically for the
software that hosts the agent and installs skills. It is distinct from mastermind's native host.

## 6. Review marks and proposed edits

Evidence: [CriticMarkup model][marks], [public protocol][protocol], and [UI labels][labels].

Keep **CriticMarkup** as the format's proper name and **review mark / 评审标记** as the generic
construct. Its kinds remain insertion, deletion, substitution, highlight, and comment.
Use **suggested edit / 修改建议** for an unaccepted insertion, deletion, or replacement; in the
protocol, proposed edit is an equivalent description rather than a different object.

Use **Suggested edits / 修改建议** for the search filter over unaccepted edits.
Keep **Accept / 接受**, **Reject / 拒绝**, and **Suggest deletion / 建议删除** as actions.

Example: “Find in suggested edits.” / “在修改建议中查找。”
Technical `suggestion` and `CriticKind` need no rename. A UI-only edit proposal and a CriticMarkup
mark already stored in the file have different persistence states; the term suggestion does not
establish whether either has been accepted.

Keep **highlight / 高亮**. Explain **comment anchor** in developer docs as the source passage
associated with a discussion. Use **commented passage / 评论所指文本** for readers. Distinguish a
highlight anchor from a translated comment's source-block association.

## 7. Comments, discussions, and resolution

Use **discussion / 讨论** for a comment plus its replies in product copy, and **comment thread /
评论串** in parser and storage contracts. Keep Comment and Reply for individual messages and the
action of adding one.

Use **Resolve / 标为已解决** as the action and **Resolved discussions / 已解决的讨论** as the panel
title. Archive describes storage; resolution means the discussion is finished. Resolution does not
accept a proposed edit. Use **Delete comment / 删除评论** for removing one comment.

Example: “Resolve moves this discussion to the document's resolved history.”
Example: “Delete comment removes this comment; undo restores it.”
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

| Earlier heading | Canonical heading | 简体中文 |
| --- | --- | --- |
| Base | Base version | 基准版本 |
| Local | Your edits | 你的编辑 |
| Latest disk | File on disk | 磁盘文件 |
| Result | Merge result | 合并结果 |

Explain **Base version** as “The version loaded or saved before these conflicting changes.” The
base may have come from opening or reloading a file; the app need not have saved it.

Explain **Merge result** as “Edit this text to combine the changes.” It starts as a copy of Your
edits; no automatic merge has happened. The label must not imply a computed merge.

Use **Compare versions / 比较版本**, **Refresh versions / 刷新版本**, **Use disk version / 采用磁盘版本**,
and **Save merge result / 保存合并结果**. The first three comparison panes are captured versions;
“Your edits” does not promise a live view while editing the merge result.

Example: “Saving paused. Compare your edits with the file on disk.”
Example: “The versions changed. Refresh them before saving the merge result.”
Keep **autosave / 自动保存** and **saving paused / 保存已暂停**. In notices use unsaved changes rather
than dirty buffer; technical clean/dirty buffer terminology remains useful.

## 9. Document lifetime, sessions, and drafts

Evidence: [document sessions][sessions], [state ownership][store], and [lifetime ruling][decisions].

Use **open document / 已打开的文档** when lifecycle matters, otherwise document. A current
server session is a per-file registry object; the intended app session is the app's whole lifetime.
Use **document session** only for that existing server object and **app session** for app lifetime.
Use **document buffer** for unsaved in-memory text, and **review state** for the broader state.

Example: “This document is no longer open. Open the file again.”
Use **Restore open files / 恢复已打开的文件** for the deferred public capability, and **review-state
restoration** for its technical scope. Naming does not decide which buffers, positions, or panels
persist; restoration remains deferred in [DIRECTION.md][direction].

Use **merge result / 合并结果** for the retained editable conflict comparison. Blank-draft creation
is retired; do not introduce an untitled-document workflow through terminology changes.

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

Qualify snapshot where several kinds meet. A version does not necessarily contain captured text;
a comparison snapshot does.

Do not automatically rename `version` inside a clearly typed response or every `source` parameter.
Rename misleading boundary fields deliberately; preserve byte-preserving round trip as an invariant,
not a feature brand. Fingerprint and disk version token are different checks.

## 11. File opening, navigation, and the desktop runtime

Use **Open selected files / 打开所选文件** for the operation and **agent-selected files** when
explaining selection responsibility. The agent chooses files using its judgment; the app has no
separate smart selection algorithm. Keep `open` as the concise typed command.

Use **Open files / 打开的文件**, **Outline / 大纲**, and **Filename / 文件名** for document navigation.
**Repository / 仓库** means a version-controlled project, not any folder. The workspace tree is
retired; describe opening files rather than introducing a renamed workspace product.

Use **desktop app / 桌面应用** publicly and **Tauri host / Tauri 宿主** in architecture docs.
Keep **native host**, **host bridge**, and **IPC** as technical terms, defined on first use. The
bridge carries specific document operations between the web interface and privileged local code.

Desktop errors describe the failed operation and its recovery action. **Browser development
preview / 浏览器开发预览** names the foreground developer tool; it is not a background app service.
Daemon and its lifecycle commands are historical terms.

## 12. Appearance and layout

Evidence: [settings][settings], [font presets][fonts], [code color schemes][colors], and
[themes][themes].

Use **Font preset / 字体预设**: it selects heading and body font families, heading weight, and
heading letter spacing. For example, the Bricolage preset uses Bricolage Grotesque for headings and
Inter for body text. Some presets use the same family for both. If the feature later selects only a
font, label it Font. Use `fontPreset` for the preference, `FontPreset` for its type, and
`FONT_PRESETS` for the registry. The preference migration is defined in
[the configuration contract][preferences].

Use **Code color scheme / 代码配色**. The choice is among code color palettes or Off. The
established feature name is [syntax highlighting][syntax-highlighting], but this control selects its
palette. Name code explicitly to distinguish its colors from review highlights.
Keep named palettes Soft, Vivid, Warm, with 柔和、鲜明、暖色.

Use **Text width / 正文宽度**: the control sets the maximum width of the central document
column. Editors use different labels: Obsidian calls its limit
[Readable line length][obsidian-width], while Typora calls the column dimension
[Width of Writing Area][typora-width]. Text width describes
this app's setting directly; it does not imply paper dimensions or a hard line-wrap character count.
Keep Font size, Line height, Theme, Appearance, Film grain, Texture, and System default.
For grain textures use 细腻、柔和、粗糙; 粗粝 is unusually literary for a setting.

Keep theme names and actual font-family names as proper names.
Label the font preset with stored ID `grid` **Schibsted**, matching its family and avoiding a false
association between choosing that font and changing the Grid theme. Keep its stored ID unless a
coordinated registry change is approved. No new creative preset names are needed.

Use **Comments / 评论** in visible controls, **comment sidebar / 评论侧栏** in user explanations,
and **comment rail** for the margin-layout implementation. Keep **callout / 提示块** and its
Decisions, Open questions, To-do, and Risks heading families. Keep **frontmatter** technically;
use **document metadata / 文档元数据** when introducing its purpose to a reader. Do not call raw
frontmatter Properties as if a typed property editor already exists.

Use **Block actions / 内容块操作**, not 段落操作, for an action menu that can apply to nonparagraph
blocks. Review badges should spell out localized categories rather than `3c 2e 1h`.
Example: “3 comments, 2 suggested edits, 1 highlight.” / “3 条评论、2 条修改建议、1 处高亮。”

## 13. Workflow and design-document vocabulary

Use **removal and refactoring / 移除与重构** for work that removes features and restructures code.
Reserve ablation for an experiment that removes a variable to measure its effect.

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
| New draft, draft naming, `new` | Historical descriptions only |
| Workspace and its badges/tree-specific session names | Historical descriptions only |
| Browser-choice preference, `--in`, app-mode container | Historical descriptions only |
| `install-agents`, global injection | Historical descriptions only |
| Daemon, status, stop, health probes | Historical descriptions only |
| Keep mine, Reload (discard mine), Save anyway | Retired controls; historical descriptions only |
| Squad, light/heavy track | Historical provenance, not current product vocabulary |

Do not turn an abandoned feature into a naming problem. The inherited marketing site describes the
original release; its Hand back text remains historical until a site refresh is explicitly scoped.
“Upstream” and “fork” remain precise in attributed provenance and contribution discussions.

## 15. Brand and distribution identity

The product name **mastermind** is settled. **Mastermind** names Kevin Ding's original project.
Keep third-party names such as Markdown, CriticMarkup, Tauri, Electron, CodeMirror, React, and Git.
The private npm project retains its inherited name; native executable and app identifiers remain
provisional. Repository launch commands do not establish a public distribution identity.

Use **mastermind** as the product name and **open** as the launch operation. Package, executable,
application ID, and configuration-directory collisions remain a separate decision tracked in
[DIRECTION.md][direction]. This vocabulary does not select distribution identifiers or assert
package availability.

## Other established terms

The remaining terms below retain their ordinary meanings in context.

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

## Applying the vocabulary

Apply labels, accessibility text, help, documentation, and examples together. Preserve accepted
product semantics. Remove unused message keys only after checking callers, and add behavior checks
where meaning changes. Apply the vocabulary to desktop features as they are implemented.

Coordinate identifier changes across config validation and persistence, CLI, producer/consumer code,
skills, and tests. Preserve saved personal preferences through an explicit migration or
compatibility choice; approval of vocabulary does not authorize silently losing settings.

Serialized translation keys require an explicit format/version choice because readers reject unknown
fields. Until that choice is made, retain the existing wire names and document their canonical
meanings beside the format. Keep existing in-document review markers stable. Public terminology does
not require renaming every `version`, `source`, or other identifier whose local meaning is clear.

This reference governs naming across features. Keep feature behavior and storage contracts beside
the implementation, and keep unresolved product choices in [DIRECTION.md][direction].

[preferences]: ../desktop/src/setup.md
[settings]: ../ui/settings/SettingsPanel.tsx
[translation]: ../document/translation.md
[decisions]: ../DECISIONS.md
[direction]: ../DIRECTION.md
[toolbar]: ../ui/app/TopBar.tsx
[prepared]: ../tools/translation/prepared-translations.md
[view]: ../ui/translate/README.md
[protocol]: ../.claude/skills/mastermind/reference/review-protocol.md
[marks]: ../document/critic/types.ts
[labels]: ../ui/i18n/index.ts
[archive]: ../document/review-archive.md
[store]: ../ui/documents/store.md
[files]: ../desktop/src/files.md
[sessions]: ../desktop/src/admission.rs
[fonts]: ../ui/theme/fontRegistry.ts
[colors]: ../ui/theme/codeThemes.ts
[themes]: ../themes/README.md
[syntax-highlighting]: https://code.visualstudio.com/api/language-extensions/syntax-highlight-guide
[obsidian-width]: https://obsidian.md/help/settings
[typora-width]: https://support.typora.io/Width-of-Writing-Area/
