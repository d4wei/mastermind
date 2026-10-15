# Settings controls

`SettingsPanel` orders preferences by scope: General, Appearance, Reading, then Code. General
contains personal identity and language preferences. Reading groups font preset, size, line height,
and text width; code font and color scheme follow together. Labels follow
[the terminology reference](../../docs/terminology.md).

`LangSelect` is the shared optional translation-language picker for Settings and onboarding. One
control represents either Original only (`null`) or a language code. Its search matches the
registry's English names, native names, and codes, with custom codes offered for valid input syntax.
Only selecting an option commits a preference. Search, navigation, and dismissal do not.

The search input retains DOM focus and exposes the highlighted option through
`aria-activedescendant`; arrow keys keep that option visible. Enter selects, Escape cancels and
returns focus to the trigger, and leaving the control closes the menu. IME composition retains its
own Enter and Escape behavior. The fixed menu remains a DOM child of its control so panel
outside-click handling includes the menu.

The keyboard and focus behavior follows the
[WAI-ARIA combobox pattern](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/).
Settings and onboarding tests cover nullable choices, explicit codes, search, cancellation,
composition, and protecting onboarding choices from later suggestions.
