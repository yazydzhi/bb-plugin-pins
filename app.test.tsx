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
    expect(app.navPanels.map((n) => [n.id, n.path, n.title])).toEqual([["pins", "pins", "Pins"]]);
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

describe("pins page", () => {
  const nav = async () => (await loadPluginApp(() => import("./app"))).navPanels[0]!;
  const sidebar = {
    threads: [sidebarThread],
    projects: [{ id: "proj_one", name: "Alpha project", isPersonal: false, href: "/", settingsHref: "/" }],
  };
  const two = () => ({
    pins: [
      pin({ id: "a", excerpt: "Alpha text", createdAt: 1 }),
      pin({ id: "b", threadId: "thr_two", threadTitle: "Second thread", projectId: null, excerpt: "Beta text", createdAt: 9 }),
      pin({ id: "c", threadId: "thr_gone", threadDeleted: true, excerpt: "Orphan", createdAt: 5 }),
    ],
  });

  it("groups pins by thread with project and count, deleted threads last", async () => {
    const slot = renderSlot(await nav(), { subPath: "" }, { rpc: { list: two }, sidebarThreads: sidebar as never });
    await slot.findByText("Beta text");
    const titles = Array.from(slot.container.querySelectorAll(".pins-group-title"), (e) => e.textContent);
    expect(titles).toEqual(["Second thread", "Live title", "Deleted threads"]);
    expect(slot.getByText("Alpha project")).toBeTruthy();
    expect(slot.container.querySelector(".pins-group-count")?.textContent).toBe("1");
    expect((slot.getByText("Orphan").closest("button") as HTMLButtonElement).disabled).toBe(true);
    slot.lifecycle.unmount();
  });

  it("collapses a group and searches across text and thread titles", async () => {
    const slot = renderSlot(await nav(), { subPath: "" }, { rpc: { list: two }, sidebarThreads: sidebar as never });
    await slot.findByText("Beta text");
    fireEvent.click(slot.getByText("Second thread"));
    expect(slot.queryByText("Beta text")).toBeNull();
    fireEvent.change(slot.getByPlaceholderText("Search pins and threads"), { target: { value: "second" } });
    expect(slot.getByText("Beta text")).toBeTruthy();
    expect(slot.queryByText("Alpha text")).toBeNull();
    fireEvent.change(slot.getByPlaceholderText("Search pins and threads"), { target: { value: "nothing" } });
    expect(slot.getByText("No pins match “nothing”.")).toBeTruthy();
    slot.lifecycle.unmount();
  });

  it("shows the empty state", async () => {
    const slot = renderSlot(await nav(), { subPath: "" }, { rpc: { list: () => ({ pins: [] }) } });
    expect(await slot.findByText("No pins yet — use the pin button on a message.")).toBeTruthy();
    slot.lifecycle.unmount();
  });

  it("removes a pin", async () => {
    const slot = renderSlot(await nav(), { subPath: "" }, {
      rpc: { list: () => ({ pins: [pin()] }), remove: () => ({ removed: true }) },
    });
    await slot.findByText("Keep one pin per message.");
    fireEvent.click(slot.getByRole("button", { name: "Remove pin" }));
    await vi.waitFor(() =>
      expect(slot.inspection.rpcCalls.some((c) => c.method === "remove")).toBe(true),
    );
    slot.lifecycle.unmount();
  });

  it("jumps from the plugin route, and opens a split on Cmd-click", async () => {
    window.history.replaceState({ usr: null, key: "start", idx: 2 }, "", "/plugins/pins/pins");
    const slot = renderSlot(await nav(), { subPath: "" }, {
      rpc: { list: () => ({ pins: [pin()] }) },
      sidebarThreads: sidebar as never,
    });
    const row = await slot.findByText("Keep one pin per message.");
    fireEvent.click(row);
    expect(window.location.pathname).toBe("/projects/proj_one/threads/thr_one");
    expect(window.history.state).toMatchObject({ usr: { searchMessageSeq: 10, searchThreadId: "thr_one" }, idx: 3 });
    fireEvent.click(row, { metaKey: true });
    expect(slot.inspection.navigateCalls).toContainEqual(
      expect.objectContaining({ method: "toThread", threadId: "thr_one" }),
    );
    slot.lifecycle.unmount();
  });

  it("badges the total pin count, and nothing when empty", async () => {
    const registration = await nav();
    const Probe = () => {
      const badge = registration.experimental_useBadge!();
      return <span data-testid="badge">{badge === null ? "none" : `${badge.count}|${badge.label}`}</span>;
    };
    const full = renderSlot({ ...registration, component: Probe } as never, { subPath: "" }, { rpc: { list: two } });
    await vi.waitFor(() => expect(full.getByTestId("badge").textContent).toBe("3|3 pins"));
    full.lifecycle.unmount();
    const empty = renderSlot({ ...registration, component: Probe } as never, { subPath: "" }, { rpc: { list: () => ({ pins: [] }) } });
    expect(empty.getByTestId("badge").textContent).toBe("none");
    empty.lifecycle.unmount();
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
