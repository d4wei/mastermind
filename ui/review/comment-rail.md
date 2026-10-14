# Comment rail interaction

Each comment card is an accessibility group containing its own Delete comment, Reply, and Resolve
buttons. Focusing any control activates the corresponding source anchor; clicking the card does the
same. The card is not an additional keyboard stop. A button role on the container would make its
descendants presentational in accessibility APIs and obscure the controls in the macOS webview.

The reply textarea keeps ordinary text-input semantics, including its submission shortcut. Action
handlers stop click propagation where activating the old anchor after a source splice would be
incorrect. Exiting cards are visual only and excluded from the accessibility tree.
