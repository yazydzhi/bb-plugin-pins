// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { openMessage, threadPath } from "./navigation";
import type { Pin } from "./server";

function pin(overrides: Partial<Pin> = {}): Pin {
  return {
    id: "p1",
    threadId: "thr_one",
    seq: 10,
    rowId: "r10",
    role: "assistant",
    excerpt: "Keep **one** pin per message.",
    quoted: false,
    threadTitle: "Saved title",
    projectId: "proj_one",
    threadDeleted: false,
    createdAt: Date.now(),
    ...overrides,
  };
}

const sidebarThread = {
  id: "thr_one",
  projectId: "proj_one",
  title: "Live title",
  titleFallback: null,
  displayTitle: "Live title",
  href: "/projects/proj_one/threads/thr_one",
} as PluginSidebarThread;

const headerProps = { threadId: "thr_one", projectId: "proj_one", environment: null };

afterEach(() => {
  window.history.replaceState(null, "", "/");
  document.head.querySelectorAll("style[data-pins-markers]").forEach((el) => el.remove());
  vi.unstubAllGlobals();
});

describe("registrations", () => {
  it("adds the message action, header row, panel tab, new-thread panel and overlay", async () => {
    const app = await loadPluginApp(() => import("./app"));
    expect(app.messageActions.map((a) => a.title)).toEqual(["Pin"]);
    expect(app.threadHeaderRows).toHaveLength(1);
    expect(app.tabs.map((t) => t.id)).toEqual(["pins"]);
    expect(app.newThreadPanelActions.map((a) => a.id)).toEqual(["pins"]);
    expect(app.appOverlays).toHaveLength(1);
  });
});

describe("Pin message action", () => {
  it("toggles the message and adds a selection as its quote", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const requests: { url: string; body: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        requests.push({ url, body: JSON.parse(String(init.body)) });
        return new Response(JSON.stringify({ ok: true, result: { pin: pin() } }));
      }),
    );
    const context = {
      threadId: "thr_one",
      message: {
        id: "r1",
        threadId: "thr_one",
        role: "assistant" as const,
        text: "Full answer",
        sourceSeqEnd: 10,
        experimental_messageSeq: 10,
      },
      experimental_panel: { openTab: () => true },
    } as never;
    const action = app.messageActions[0]!;
    await action.run(context);
    await action.run({ ...(context as object), selectedText: "  answer " } as never);

    const base = { threadId: "thr_one", seq: 10, rowId: "r1", role: "assistant", text: "Full answer" };
    expect(requests).toEqual([
      { url: "/api/v1/plugins/pins/rpc/toggle", body: base },
      { url: "/api/v1/plugins/pins/rpc/add", body: { ...base, quote: "answer" } },
    ]);
  });
});

describe("pins bar", () => {
  it("takes no space without pins", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const slot = renderSlot(app.threadHeaderRows[0]!, headerProps, {
      rpc: { list: () => ({ pins: [] }) },
    });
    await vi.waitFor(() => expect(slot.inspection.rpcCalls).toHaveLength(1));
    expect(slot.container.querySelector(".pins-bar")).toBeNull();
    slot.lifecycle.unmount();
  });

  it("shows the newest pin, a counter and arrows that wrap around", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const pins = [
      pin({ id: "a", seq: 1, excerpt: "First" }),
      pin({ id: "b", seq: 2, excerpt: "Second" }),
      pin({ id: "c", seq: 3, excerpt: "Third" }),
    ];
    const slot = renderSlot(app.threadHeaderRows[0]!, headerProps, {
      rpc: { list: () => ({ pins }) },
    });
    await slot.findByText("Third");
    expect(slot.getByText("3/3")).toBeTruthy();
    fireEvent.click(slot.getByRole("button", { name: "Next pin" }));
    expect(slot.getByText("First")).toBeTruthy();
    expect(slot.getByText("1/3")).toBeTruthy();
    fireEvent.click(slot.getByRole("button", { name: "Previous pin" }));
    expect(slot.getByText("3/3")).toBeTruthy();
    slot.lifecycle.unmount();
  });

  it("hides the counter and arrows for a single pin, and unpins", async () => {
    const app = await loadPluginApp(() => import("./app"));
    let pins = [pin()];
    const slot = renderSlot(app.threadHeaderRows[0]!, headerProps, {
      rpc: {
        list: () => ({ pins }),
        remove: () => {
          pins = [];
          return { removed: true };
        },
      },
    });
    await slot.findByText("Keep one pin per message.");
    expect(slot.queryByRole("button", { name: "Next pin" })).toBeNull();
    fireEvent.click(slot.getByRole("button", { name: "Unpin" }));
    await slot.behavior.emitRealtime("changed", null);
    await vi.waitFor(() => expect(slot.container.querySelector(".pins-bar")).toBeNull());
    expect(slot.inspection.rpcCalls.map((c) => c.method)).toContain("remove");
    slot.lifecycle.unmount();
  });

  it("jumps to the pinned message through the router's history entry", async () => {
    window.history.replaceState({ usr: null, key: "start", idx: 3 }, "", "/");
    const app = await loadPluginApp(() => import("./app"));
    const slot = renderSlot(app.threadHeaderRows[0]!, headerProps, {
      rpc: { list: () => ({ pins: [pin()] }) },
      sidebarThreads: { threads: [sidebarThread] },
    });
    fireEvent.click(await slot.findByText("Keep one pin per message."));
    expect(window.location.pathname).toBe("/projects/proj_one/threads/thr_one");
    expect(window.history.state).toMatchObject({
      usr: { searchMessageSeq: 10, searchThreadId: "thr_one" },
      idx: 4,
    });
    slot.lifecycle.unmount();
  });

  it("falls back to plain thread navigation outside the router", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const slot = renderSlot(app.threadHeaderRows[0]!, headerProps, {
      rpc: { list: () => ({ pins: [pin()] }) },
    });
    fireEvent.click(await slot.findByText("Keep one pin per message."));
    expect(slot.inspection.navigateCalls).toEqual([{ method: "toThread", threadId: "thr_one" }]);
    slot.lifecycle.unmount();
  });
});

describe("pins panel", () => {
  const panel = async () => {
    const app = await loadPluginApp(() => import("./app"));
    return app.tabs[0]!;
  };

  it("lists pins of all threads newest first, with live thread titles", async () => {
    const tab = await panel();
    const slot = renderSlot(tab as never, { threadId: "thr_one", environment: null, params: null }, {
      rpc: {
        list: () => ({
          pins: [
            pin({ id: "old", createdAt: 1, excerpt: "Older" }),
            pin({ id: "new", createdAt: 9, threadId: "thr_gone", threadTitle: "Old title", excerpt: "Newer", role: "user" }),
          ],
        }),
      },
      sidebarThreads: { threads: [sidebarThread] },
    });
    await slot.findByText("Newer");
    const texts = Array.from(slot.container.querySelectorAll("li .pins-text"), (e) => e.textContent);
    expect(texts).toEqual(["Newer", "Older"]);
    expect(slot.getByText("Live title")).toBeTruthy();
    expect(slot.getByText("Old title")).toBeTruthy();
    slot.lifecycle.unmount();
  });

  it("filters by search and by This thread", async () => {
    const tab = await panel();
    const slot = renderSlot(tab as never, { threadId: "thr_one", environment: null, params: null }, {
      rpc: {
        list: () => ({
          pins: [
            pin({ id: "a", excerpt: "Alpha" }),
            pin({ id: "b", threadId: "thr_two", excerpt: "Beta" }),
          ],
        }),
      },
    });
    await slot.findByText("Beta");
    fireEvent.click(slot.getByRole("button", { name: "This thread" }));
    expect(slot.queryByText("Beta")).toBeNull();
    fireEvent.click(slot.getByRole("button", { name: "This thread" }));
    fireEvent.change(slot.getByPlaceholderText("Search"), { target: { value: "bet" } });
    expect(slot.queryByText("Alpha")).toBeNull();
    expect(slot.getByText("Beta")).toBeTruthy();
    slot.lifecycle.unmount();
  });

  it("removes a pin", async () => {
    const tab = await panel();
    const slot = renderSlot(tab as never, { threadId: "thr_one", environment: null, params: null }, {
      rpc: { list: () => ({ pins: [pin()] }), remove: () => ({ removed: true }) },
    });
    await slot.findByText("Keep one pin per message.");
    fireEvent.click(slot.getByRole("button", { name: "Remove pin" }));
    await vi.waitFor(() =>
      expect(slot.inspection.rpcCalls.some((c) => c.method === "remove")).toBe(true),
    );
    slot.lifecycle.unmount();
  });
});

describe("timeline markers", () => {
  it("keeps one style element for pinned rows while mounted", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const slot = renderSlot(app.appOverlays[0]!, {}, {
      rpc: { list: () => ({ pins: [pin({ rowId: "r1" }), pin({ id: "x", seq: 2, rowId: "gone", threadDeleted: true })] }) },
    });
    await vi.waitFor(() =>
      expect(document.querySelectorAll("style[data-pins-markers]")).toHaveLength(1),
    );
    const css = document.querySelector("style[data-pins-markers]")?.textContent;
    expect(css).toContain('[data-timeline-row-id="r1"]');
    expect(css).not.toContain("gone");
    slot.lifecycle.unmount();
    expect(document.querySelector("style[data-pins-markers]")).toBeNull();
  });
});

describe("navigation", () => {
  it("builds personal and project thread paths", () => {
    expect(threadPath("thr_1", "p", true)).toBe("/threads/thr_1");
    expect(threadPath("thr_1", "proj_2", false)).toBe("/projects/proj_2/threads/thr_1");
  });

  it("replays the pushed entry as a history pop, and declines outside the router", () => {
    window.history.replaceState({ usr: null, key: "a", idx: 0 }, "", "/");
    const listener = vi.fn();
    window.addEventListener("popstate", listener);
    expect(openMessage("/threads/thr_1", "thr_1", 7)).toBe(true);
    window.removeEventListener("popstate", listener);
    expect(listener).toHaveBeenCalledTimes(1);
    window.history.replaceState(null, "", "/");
    expect(openMessage("/threads/thr_1", "thr_1", 7)).toBe(false);
  });
});
