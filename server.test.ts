import { describe, expect, it } from "vitest";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import plugin, { toPin, type Pin, type PinRow } from "./server";
import { CHANGED_CHANNEL, MAX_TEXT_LENGTH } from "./shared";

function message(overrides: Record<string, unknown> = {}) {
  return {
    threadId: "thr_one",
    seq: 42,
    rowId: "r42",
    role: "assistant",
    text: "Use **SQLite** for the `pins` table.",
    ...overrides,
  };
}

async function setup(
  getThread: (args: { threadId: string }) => Promise<unknown> = async ({
    threadId,
  }) =>
    makeThreadResponse({ id: threadId, title: "Закрепы", projectId: "proj_one" }),
) {
  const { bb, harness } = createFakePluginHost({
    pluginId: "pins",
    sdk: { threads: { get: getThread as never } },
  });
  await plugin(bb);
  const list = async (input: unknown = null) =>
    ((await harness.behavior.callRpc("list", input)) as { pins: Pin[] }).pins;
  const call = async <T>(method: string, input: unknown) =>
    (await harness.behavior.callRpc(method, input)) as T;
  return { harness, list, call };
}

describe("pin storage", () => {
  it("toggles a message on with a thread snapshot, then off", async () => {
    const { harness, list, call } = await setup();

    const added = await call<{ pin: Pin | null }>("toggle", message());
    expect(added.pin).toMatchObject({
      threadId: "thr_one",
      seq: 42,
      rowId: "r42",
      role: "assistant",
      quoted: false,
      threadTitle: "Закрепы",
      projectId: "proj_one",
      threadDeleted: false,
    });
    expect(await list()).toHaveLength(1);

    expect((await call<{ pin: Pin | null }>("toggle", message())).pin).toBeNull();
    expect(await list()).toEqual([]);
    expect(
      harness.inspection.realtimeSignals.filter((s) => s.channel === CHANGED_CHANNEL),
    ).toHaveLength(2);
    await harness.lifecycle.dispose();
  });

  it("allows several pins per thread and filters by thread", async () => {
    const { harness, list, call } = await setup();
    await call("toggle", message({ seq: 1 }));
    await call("toggle", message({ seq: 2 }));
    await call("toggle", message({ seq: 3, threadId: "thr_two" }));

    expect((await list()).map((pin) => pin.seq).sort()).toEqual([1, 2, 3]);
    expect((await list({ threadId: "thr_one" })).map((pin) => pin.seq)).toEqual([1, 2]);
    expect(await list({ threadId: "thr_none" })).toEqual([]);
    await harness.lifecycle.dispose();
  });

  it("keeps one pin per message; a selection becomes its quote", async () => {
    const { harness, list, call } = await setup();
    await call("toggle", message());
    await call("add", { ...message(), quote: "SQLite" });
    await call("add", message());

    const pins = await list();
    expect(pins).toHaveLength(1);
    expect(pins[0]).toMatchObject({ excerpt: "SQLite", quoted: true });
    await harness.lifecycle.dispose();
  });

  it("pins a message once when pinned twice at the same time", async () => {
    const { harness, list, call } = await setup();
    const results = await Promise.all([
      call<{ pin: Pin }>("add", message()),
      call<{ pin: Pin }>("add", message()),
    ]);
    expect(await list()).toHaveLength(1);
    expect(results[0].pin.id).toBe(results[1].pin.id);
    await harness.lifecycle.dispose();
  });

  it("removes by id and reports whether anything was removed", async () => {
    const { harness, list, call } = await setup();
    const { pin } = await call<{ pin: Pin }>("add", message());
    expect(await call("remove", { id: pin.id })).toEqual({ removed: true });
    expect(await call("remove", { id: pin.id })).toEqual({ removed: false });
    expect(await list()).toEqual([]);
    await harness.lifecycle.dispose();
  });

  it("still pins when the thread cannot be read", async () => {
    const { harness, list, call } = await setup(async () => {
      throw new Error("not found");
    });
    await call("toggle", message());
    expect(await list()).toMatchObject([{ threadTitle: null, projectId: null }]);
    await harness.lifecycle.dispose();
  });

  it("rejects message text past the stored limit", async () => {
    const { harness } = await setup();
    await expect(
      harness.behavior.callRpc("toggle", message({ text: "x".repeat(MAX_TEXT_LENGTH + 1) })),
    ).rejects.toThrow();
    await harness.lifecycle.dispose();
  });
});

describe("thread lifecycle", () => {
  it("flags pins of a deleted thread but keeps their text", async () => {
    const { harness, list, call } = await setup();
    await call("toggle", message());
    await harness.behavior.emitThreadEvent("thread.deleted", {
      thread: makeThreadResponse({ id: "thr_one" }),
    });
    expect(await list()).toMatchObject([
      { threadDeleted: true, excerpt: message().text },
    ]);
    await harness.lifecycle.dispose();
  });

  it("refreshes the saved title once when the thread goes idle", async () => {
    const { harness, list, call } = await setup();
    await call("toggle", message());
    const signals = harness.inspection.realtimeSignals.length;
    const idle = {
      thread: makeThreadResponse({ id: "thr_one", title: "Renamed", projectId: "proj_one" }),
      lastAssistantText: null,
    };
    await harness.behavior.emitThreadEvent("thread.idle", idle);
    await harness.behavior.emitThreadEvent("thread.idle", idle);

    expect(await list()).toMatchObject([{ threadTitle: "Renamed" }]);
    expect(harness.inspection.realtimeSignals.length).toBe(signals + 1);
    await harness.lifecycle.dispose();
  });
});

describe("toPin", () => {
  const row: PinRow = {
    id: "p1",
    thread_id: "t",
    seq: 1,
    row_id: "r",
    role: "user",
    text: "Plain",
    quote: null,
    thread_title: null,
    project_id: null,
    thread_deleted: 0,
    created_at: 1,
  };

  it("cuts long excerpts without splitting a surrogate pair", () => {
    expect(toPin({ ...row, text: `${"a".repeat(599)}😀tail` }).excerpt).toBe("a".repeat(599));
  });

  it("prefers the quote", () => {
    expect(toPin({ ...row, quote: "Sel" })).toMatchObject({ excerpt: "Sel", quoted: true });
  });
});
