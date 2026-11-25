import { PIN_ACTION_TITLE } from "./shared";

const FILLED_PIN_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 17v5" stroke="black" stroke-width="2" stroke-linecap="round" fill="none"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" fill="black" stroke="black" stroke-width="2" stroke-linejoin="round"/></svg>';

const FILLED_PIN = `url("data:image/svg+xml,${encodeURIComponent(FILLED_PIN_SVG)}")`;

function cssString(value: string): string {
  return value.replace(/["\\]/g, "\\$&").replace(/[\n\r\f]/g, " ");
}

/**
 * CSS that keeps the Pin button of each pinned timeline row visible and
 * filled. Rows scroll in and out of the virtualized timeline, so attribute
 * selectors follow them without observers.
 */
export function markerStyles(rowIds: readonly string[]): string {
  if (rowIds.length === 0) return "";
  const rows = rowIds
    .map((id) => `[data-timeline-row-id="${cssString(id)}"]`)
    .join(",");
  const button = `:is(${rows}) button[aria-label="${cssString(PIN_ACTION_TITLE)}"]`;
  return [
    `${button}{opacity:1!important;color:var(--foreground)!important}`,
    `${button} [data-plugin-icon-asset]{-webkit-mask-image:${FILLED_PIN}!important;mask-image:${FILLED_PIN}!important}`,
  ].join("\n");
}
