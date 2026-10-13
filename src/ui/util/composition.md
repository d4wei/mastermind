# Composer keyboard composition

`composition.ts` keeps comment-composer dismissal and submit shortcuts out of input-method
composition. It tracks the textarea's composition lifecycle and checks the native keyboard event's
`isComposing` flag. Blur or textarea detachment clears a composition that did not emit an end event.

The legacy `keyCode` check covers a final IME key after `compositionend`, when WebKit can report
`isComposing` as false. WebKit's [event-order report][ordering] describes that ordering, and its
[Chinese Pinyin cancellation report][cancellation] records the legacy IME key value during
cancellation. The [UI Events specification][events] describes the intended composition/key order.

Composing keys retain the browser's default IME behavior. Composer handlers stop their propagation
so a window-level Escape handler cannot dismiss the draft. Ordinary keys after composition retain
the existing shortcuts. The guard does not change how the browser commits or cancels marked text.

[ordering]: https://bugs.webkit.org/show_bug.cgi?id=165004
[cancellation]: https://bugs.webkit.org/show_bug.cgi?id=31902
[events]: https://www.w3.org/TR/uievents/#events-composition-key-events
