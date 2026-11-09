# Outside presses

`outside-press.ts` holds the one rule for "close or deselect when the reader presses elsewhere":
the slide-over panels, Find, the compact outline's heading list, and the selected discussion all go
through `useOutsidePress`.

A floating layer spreads `LAYER` onto its root: slide-over panels, the Find bar, the selection
toolbar, the translated-selection composer, the notification stack, and the close dialog. Radix
menus, popovers, and tooltips need no mark; their popper wrapper counts as a layer. A press is
outside a layer when it lands neither in the layer's element, nor on a surface its `inside` names,
nor in another floating layer. A floating layer owns its presses, so opening a menu or pressing a
notification leaves a panel, Find, and the discussion as they were. The exception is a layer nested
with the one asking, either way round: the narrow comments panel holds the rail, so the discussion
names that panel as its `host`, and a press on the panel's empty space deselects it as the wide
rail's would.

While the close dialog or an inert root is up, `modalOpen()` is true and no press is outside
anything; the same guard keeps Find and the session view's shortcuts away from the dialog. A press
on a control that the press itself removed counts as inside what held it.

`press` layers react at pointerdown in the capture phase and never prevent the press's default, so
the press's own selection or action proceeds. The discussion uses `click`, which ignores a press
that travels into a drag, so selecting text keeps it. `tests/outside-press.test.tsx` checks the
rule; each consumer's tests check its behavior.
