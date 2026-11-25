// Pure helpers shared by the UI and the tests.

export interface PinLike {
  id: string;
  threadId: string;
  seq: number;
  createdAt: number;
  threadTitle: string | null;
  excerpt: string;
}

/** Markdown flattened into readable plain text for a one-line snippet. */
export function plainText(markdown: string): string {
  const prose = flatten(
    markdown.replace(/^[ \t]*(`{3,}|~{3,}).*\n[\s\S]*?^[ \t]*\1[ \t]*$/gm, " "),
  );
  return prose === "" ? flatten(markdown) : prose;
}

function flatten(markdown: string): string {
  return markdown
    .replace(/^\s*(```|~~~).*$/gm, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<\/?[a-zA-Z][^>]*>/g, " ")
    .replace(/^\s{0,3}(?:#{1,6}|>+|[-*+]|\d+[.)])\s+/gm, "")
    .replace(/(\*\*|__|~~)(.+?)\1/g, "$2")
    .replace(/\*(\S(?:.*?\S)?)\*/g, "$1")
    .replace(/`+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** One line for the bar or a list row; assistant replies are markdown. */
export function snippet(
  text: string,
  isMarkdown: boolean,
  maxLength = 200,
): string {
  const line = isMarkdown ? plainText(text) : text.replace(/\s+/g, " ").trim();
  if (line.length <= maxLength) return line;
  return `${line.slice(0, maxLength - 1).trimEnd()}…`;
}

/** Pins of one thread in conversation order (oldest message first). */
export function threadPins<T extends PinLike>(
  pins: readonly T[],
  threadId: string,
): T[] {
  return pins
    .filter((pin) => pin.threadId === threadId)
    .sort((a, b) => a.seq - b.seq || a.createdAt - b.createdAt);
}

/**
 * Index of the pin the bar shows. The bar follows its pin by id, so a new pin
 * added elsewhere does not move it; when its pin is gone the bar falls back to
 * the newest one, like Telegram.
 */
export function currentIndex(
  pins: readonly { id: string }[],
  shownId: string | null,
): number {
  if (pins.length === 0) return -1;
  const found = pins.findIndex((pin) => pin.id === shownId);
  return found >= 0 ? found : pins.length - 1;
}

/** The next index in `direction`, wrapping around the ends. */
export function stepIndex(index: number, count: number, direction: 1 | -1) {
  if (count === 0) return -1;
  return (index + direction + count) % count;
}

/** Panel listing: newest pin first, optionally one thread, optionally searched. */
export function filterPins<T extends PinLike>(
  pins: readonly T[],
  options: { threadId: string | null; query: string },
): T[] {
  const needle = options.query.trim().toLocaleLowerCase();
  return pins
    .filter((pin) => options.threadId === null || pin.threadId === options.threadId)
    .filter(
      (pin) =>
        needle === "" ||
        pin.excerpt.toLocaleLowerCase().includes(needle) ||
        (pin.threadTitle ?? "").toLocaleLowerCase().includes(needle),
    )
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** How long ago a pin was made: `now`, `5m`, `3h`, `2d`, then a date. */
export function formatAge(createdAt: number, now: number): string {
  const minutes = Math.floor((now - createdAt) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(createdAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
