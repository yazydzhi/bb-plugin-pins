import { describe, expect, it } from "vitest";
import {
  currentIndex,
  filterPins,
  groupPins,
  formatAge,
  plainText,
  snippet,
  stepIndex,
  threadPins,
  type PinLike,
} from "./helpers";
import { markerStyles } from "./markers";

function pin(overrides: Partial<PinLike> = {}): PinLike {
  return {
    id: "p",
    threadId: "t1",
    seq: 1,
    createdAt: 1,
    threadTitle: "Title",
    excerpt: "text",
    ...overrides,
  };
}

describe("snippet", () => {
  it("flattens markdown for assistant text", () => {
    expect(plainText("## Result\n\n- Use **SQLite** and [docs](https://x.dev)\n```ts\nconst a = 1;\n```")).toBe(
      "Result Use SQLite and docs",
    );
    expect(snippet("**bold**\n\nnext", true)).toBe("bold next");
  });

  it("keeps plain user text as typed, on one line", () => {
    expect(snippet("2*3*4 and **not bold**\n\nnext", false)).toBe("2*3*4 and **not bold** next");
  });

  it("cuts to the limit with an ellipsis", () => {
    expect(snippet("a".repeat(50), false, 10)).toBe(`${"a".repeat(9)}…`);
  });
});

describe("carousel", () => {
  const pins = [pin({ id: "a", seq: 5 }), pin({ id: "b", seq: 1 }), pin({ id: "c", seq: 3, threadId: "t2" })];

  it("orders a thread's pins by message order", () => {
    expect(threadPins(pins, "t1").map((p) => p.id)).toEqual(["b", "a"]);
  });

  it("follows the shown pin by id and falls back to the newest", () => {
    const ordered = threadPins(pins, "t1");
    expect(currentIndex(ordered, "b")).toBe(0);
    expect(currentIndex(ordered, null)).toBe(1);
    expect(currentIndex(ordered, "gone")).toBe(1);
    expect(currentIndex([], "a")).toBe(-1);
  });

  it("steps and wraps around", () => {
    expect(stepIndex(0, 3, 1)).toBe(1);
    expect(stepIndex(2, 3, 1)).toBe(0);
    expect(stepIndex(0, 3, -1)).toBe(2);
    expect(stepIndex(0, 0, 1)).toBe(-1);
  });
});

describe("filterPins", () => {
  const pins = [
    pin({ id: "old", createdAt: 1, excerpt: "Кэш не работает" }),
    pin({ id: "new", createdAt: 9, threadId: "t2", threadTitle: "Other" }),
  ];

  it("lists newest first", () => {
    expect(filterPins(pins, { threadId: null, query: "" }).map((p) => p.id)).toEqual(["new", "old"]);
  });

  it("filters by thread and by text or title, ignoring case", () => {
    expect(filterPins(pins, { threadId: "t1", query: "" }).map((p) => p.id)).toEqual(["old"]);
    expect(filterPins(pins, { threadId: null, query: " КЭШ " }).map((p) => p.id)).toEqual(["old"]);
    expect(filterPins(pins, { threadId: null, query: "other" }).map((p) => p.id)).toEqual(["new"]);
    expect(filterPins(pins, { threadId: null, query: "zzz" })).toEqual([]);
  });
});

describe("formatAge", () => {
  it("formats how long ago", () => {
    const now = new Date(2026, 8, 22, 12).getTime();
    expect(formatAge(now - 20_000, now)).toBe("now");
    expect(formatAge(now - 5 * 60_000, now)).toBe("5m");
    expect(formatAge(now - 3 * 3_600_000, now)).toBe("3h");
    expect(formatAge(now - 2 * 86_400_000, now)).toBe("2d");
  });
});

describe("markerStyles", () => {
  it("targets the Pin button of pinned rows and escapes ids", () => {
    const css = markerStyles(['row"}body{x:y']);
    expect(css).toContain('[data-timeline-row-id="row\\"}body{x:y"]');
    expect(css).toContain('button[aria-label="Pin"]');
    expect(markerStyles([])).toBe("");
  });
});

describe("groupPins", () => {
  const mk = (id: string, threadId: string, createdAt: number, excerpt: string, extra = {}) => ({
    id, threadId, seq: 1, createdAt, excerpt, threadTitle: `saved ${threadId}`, threadDeleted: false, ...extra,
  });
  const pins = [
    mk("a1", "t1", 5, "Alpha cache"),
    mk("b1", "t2", 9, "Beta"),
    mk("a2", "t1", 1, "Alpha old"),
    mk("d1", "t3", 99, "Gone", { threadDeleted: true }),
  ];
  const titleOf = (pin: { threadId: string }) => `Thread ${pin.threadId}`;

  it("groups by thread, newest activity first, deleted threads last", () => {
    const groups = groupPins(pins, titleOf, "");
    expect(groups.map((g) => [g.title, g.pins.map((p) => p.id)])).toEqual([
      ["Thread t2", ["b1"]],
      ["Thread t1", ["a1", "a2"]],
      ["Deleted threads", ["d1"]],
    ]);
  });

  it("searches pin text and group titles", () => {
    expect(groupPins(pins, titleOf, "CACHE").map((g) => g.pins.map((p) => p.id))).toEqual([["a1"]]);
    expect(groupPins(pins, titleOf, "thread t1")[0]!.pins).toHaveLength(2);
    expect(groupPins(pins, titleOf, "zzz")).toEqual([]);
  });
});
