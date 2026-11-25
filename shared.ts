/** Longest message text a pin keeps; the rest of a longer message is cut. */
export const MAX_TEXT_LENGTH = 20_000;

/** Realtime channel the server publishes on after every write. */
export const CHANGED_CHANNEL = "changed";

/** The message action's title; the host also renders it as the button's aria-label. */
export const PIN_ACTION_TITLE = "Pin";

export const PANEL_TAB_ID = "pins";

/** Plugin id as installed (`bb-plugin-pins` without the prefix). */
export const PLUGIN_ID = "pins";

/** Cut `text` to at most `length` UTF-16 units without splitting a surrogate pair. */
export function truncate(text: string, length: number): string {
  if (text.length <= length) return text;
  const cut = text.slice(0, length);
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
}
