# Notifications

`Notifications.tsx` owns the bottom-left notification stack. `NativeReviewer` provides it; every
notice portals into it and stays outside document scrolling, above panels, menus, and Find.

## Tiers

Every notification names its tier (`NotificationTier`):

- **Persistent** notices need the reader's action or attention: data at risk, conflicts, failed
  saves, refused admissions. They carry a warning symbol and popover elevation, stay until
  dismissed or resolved, and, when dismissible, have an explicit close control. A dismissed failure
  keeps an icon-only recall control (`NotificationRecall`) that reopens it, so it is never lost on
  a timer. Errors use `role="alert"`; others use `role="status"`.
- **Transient** notices only inform. They have no symbol or close control, use muted ink, and
  share the persistent tier's popover elevation. They leave after `--notice-dismiss` (a theme
  duration token), with a `--dur-base` fade. The lifetime pauses while the notice is hovered or
  holds focus and resumes with the time remaining; once the fade begins, it runs to the end.
  Reduced motion removes them without the fade. They never move focus.

The stack keeps one polite live region (`role="status"`) mounted before any notice, and transient
notices render inside it, so screen readers announce text added to an existing region. A restarted
notice re-adds its text, so a repeat with identical text is announced again. Persistent notices sit
outside that region and keep their own roles.

`Notice` manages its own dismissal for either tier. `announce(id, text)` raises a transient notice
from an event rather than from state; a later announcement with the same id replaces it in place
and restarts its lifetime, so repeated events never stack copies.

## Inventory

| Notice | Raised by | Tier |
| --- | --- | --- |
| File changed on disk, missing, unreadable, or unsaved (recovery actions) | `ConflictPanel` | Persistent, dismissible to a recall and file attention |
| File is not valid UTF-8, so read-only | `ConflictPanel` | Persistent, no close control until resolved by Save As |
| Files refused at opening | `NativeReviewer` | Persistent, dismissible |
| Files from the last session that could not be reopened | `NativeReviewer` | Persistent, dismissible to a recall |
| Native command failures, including a close refused because the file changed again | `NativeReviewer` | Persistent, dismissible to a recall |
| Setup could not load, with Retry | `NativeReviewer` | Persistent, dismissible to a recall |
| Settings could not be saved | `App` | Persistent, dismissible to a recall |
| Prepared translation stale or unavailable | `SessionView` | Transient |
| Selection trimmed, or nothing in it can be marked | `SelectionToolbar` | Transient, one notice id |
| Translated selection spans blocks | `TranslatedSelection` | Transient, the same notice id |

Feedback tied to a control stays inline rather than in this stack: composer refusals, paused
editing, stale drafts, archive failures in the rail, Find's result announcement, the render-failure
fallback, and setup field errors.
