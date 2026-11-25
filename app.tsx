import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  definePluginApp,
  experimental_Icon as Icon,
  experimental_useSidebarThreads,
  useBbNavigate,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
  type ExperimentalThreadHeaderRowProps,
  type PluginMessageActionContext,
  type PluginNewThreadPanelProps,
  type PluginSidebarProject,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import {
  currentIndex,
  filterPins,
  formatAge,
  snippet,
  stepIndex,
  threadPins,
} from "./helpers";
import { errorText, iconButton, Notice, removePin, useJumpToPin, usePins } from "./common";
import { markerStyles } from "./markers";
import { PinsPage, usePinCountBadge } from "./page";
import { createRpcClient } from "./rpc";
import type { Pin, rpcContract } from "./server";
import {
  CHANGED_CHANNEL,
  MAX_TEXT_LENGTH,
  PANEL_TAB_ID,
  PIN_ACTION_TITLE,
  PLUGIN_ID,
  truncate,
} from "./shared";

const actionRpc = createRpcClient<typeof rpcContract>(PLUGIN_ID);

const PANEL_TAB = {
  id: PANEL_TAB_ID,
  context: { kind: "thread" },
  availability: "action",
} as const;

// ---------------------------------------------------------------- message action

async function pinMessage({
  threadId,
  message,
  selectedText,
  experimental_panel: panel,
}: PluginMessageActionContext) {
  const input = {
    threadId,
    seq: message.sourceSeqEnd,
    rowId: message.id,
    role: message.role,
    text: truncate(message.text, MAX_TEXT_LENGTH),
  };
  const quote = truncate(selectedText?.trim() ?? "", MAX_TEXT_LENGTH);
  const show = {
    label: "Show",
    onClick: () => void panel.openTab({ tab: PANEL_TAB }),
  };
  try {
    if (quote !== "") {
      await actionRpc.call("add", { ...input, quote });
      toast.success("Selection pinned", { action: show });
      return;
    }
    const { pin } = await actionRpc.call("toggle", input);
    if (pin === null) toast("Unpinned");
    else toast.success("Pinned", { action: show });
  } catch (error) {
    toast.error(`Could not update the pin: ${errorText(error)}`);
  }
}

// ---------------------------------------------------------------- header bar


function PinsBar({ threadId }: ExperimentalThreadHeaderRowProps) {
  const { rpc, pins } = usePins(threadId);
  const { jump } = useJumpToPin();
  const [shownId, setShownId] = useState<string | null>(null);
  const known = useRef<ReadonlySet<string>>(new Set());

  const ordered = useMemo(
    () => threadPins(pins ?? [], threadId),
    [pins, threadId],
  );

  // A pin added since the last list becomes the one shown.
  useEffect(() => {
    if (pins === null) return;
    const added = ordered.filter((pin) => !known.current.has(pin.id));
    if (known.current.size > 0 && added.length > 0) {
      setShownId(added[added.length - 1]!.id);
    }
    known.current = new Set(ordered.map((pin) => pin.id));
  }, [pins, ordered]);

  const index = currentIndex(ordered, shownId);
  const pin = ordered[index];
  if (pin === undefined) return null;
  const step = (direction: 1 | -1) =>
    setShownId(ordered[stepIndex(index, ordered.length, direction)]!.id);

  return (
    <div
      role="region"
      aria-label="Pinned messages"
      className="pins-bar flex min-h-8 w-full items-center gap-1.5 border-b border-border bg-background px-3 py-1 text-xs"
    >
      <Icon name="Pin" className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <Icon
        name={pin.role === "user" ? "User" : "Bot"}
        fallback="Pin"
        className="size-3.5 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <button
        type="button"
        title="Go to pinned message"
        onClick={() => jump(pin)}
        className="pins-snippet min-w-0 flex-1 truncate rounded-md px-1 py-0.5 text-left text-foreground hover:bg-[var(--state-hover)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        {snippet(pin.excerpt, pin.role === "assistant" && !pin.quoted) || "No text"}
      </button>
      {ordered.length > 1 ? (
        <>
          <span className="pins-counter shrink-0 tabular-nums text-muted-foreground">
            {index + 1}/{ordered.length}
          </span>
          <button type="button" aria-label="Previous pin" title="Previous pin" className={iconButton} onClick={() => step(-1)}>
            <Icon name="ChevronUp" className="size-3.5" aria-hidden="true" />
          </button>
          <button type="button" aria-label="Next pin" title="Next pin" className={iconButton} onClick={() => step(1)}>
            <Icon name="ChevronDown" className="size-3.5" aria-hidden="true" />
          </button>
        </>
      ) : null}
      <button
        type="button"
        aria-label="Unpin"
        title="Unpin"
        className={iconButton}
        onClick={() => void removePin(rpc, pin)}
      >
        <Icon name="X" className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- panel

function PinItem({
  pin,
  title,
  now,
  onOpen,
  onRemove,
}: {
  pin: Pin;
  title: string;
  now: number;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const text = snippet(pin.excerpt, pin.role === "assistant" && !pin.quoted, 400);
  return (
    <li className="pins-item group relative">
      <button
        type="button"
        onClick={onOpen}
        disabled={pin.threadDeleted}
        className="flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-[var(--state-hover)] focus-visible:bg-[var(--state-hover)] focus-visible:outline-none disabled:cursor-default disabled:hover:bg-transparent"
      >
        <span className="flex min-w-0 items-center gap-1 pr-14 text-[11px] leading-4 text-muted-foreground">
          <span className="pins-thread-title min-w-0 truncate">{title}</span>
          {pin.role === "user" ? <span className="shrink-0">· You</span> : null}
        </span>
        <span className={`pins-text line-clamp-3 text-xs leading-[1.125rem] text-foreground ${pin.quoted ? "border-l-2 border-border pl-2" : ""}`}>
          {text === "" ? "No text" : text}
        </span>
      </button>
      <span aria-hidden="true" className="pointer-events-none absolute right-2 top-1.5 text-[11px] leading-4 tabular-nums text-muted-foreground group-focus-within:invisible group-hover:invisible">
        {formatAge(pin.createdAt, now)}
      </span>
      <span className="absolute right-1 top-0.5 hidden items-center group-focus-within:flex group-hover:flex">
        <button type="button" aria-label="Remove pin" title="Remove pin" className={iconButton} onClick={onRemove}>
          <Icon name="Trash2" className="size-3.5" aria-hidden="true" />
        </button>
      </span>
    </li>
  );
}

function PinsPanel({ threadId }: { threadId: string | null }) {
  const [query, setQuery] = useState("");
  const [onlyThis, setOnlyThis] = useState(false);
  const { rpc, pins, error } = usePins(null);
  const { jump, threads } = useJumpToPin();

  const visible = useMemo(
    () =>
      pins === null
        ? null
        : filterPins(pins, { threadId: onlyThis ? threadId : null, query }),
    [pins, onlyThis, threadId, query],
  );
  const now = Date.now();

  let body: ReactNode;
  if (visible === null) {
    body = <Notice>{error ?? "Loading pins…"}</Notice>;
  } else if (visible.length === 0) {
    body = (
      <Notice>
        {query.trim() !== ""
          ? `No pins match “${query.trim()}”.`
          : onlyThis
            ? "No pins in this thread yet."
            : "No pins yet. Hover a message and click its pin icon."}
      </Notice>
    );
  } else {
    body = (
      <ul className="flex flex-col gap-px">
        {visible.map((pin) => (
          <PinItem
            key={pin.id}
            pin={pin}
            now={now}
            title={
              pin.threadDeleted
                ? "Deleted thread"
                : (threads.get(pin.threadId)?.displayTitle ?? pin.threadTitle ?? "Untitled thread")
            }
            onOpen={() => jump(pin)}
            onRemove={() => void removePin(rpc, pin)}
          />
        ))}
      </ul>
    );
  }

  return (
    <div className="pins-panel flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Search pins</span>
          <Icon name="Search" className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search"
            className="h-7 w-full rounded-md border border-border bg-transparent pl-7 pr-2 text-xs text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none"
          />
        </label>
        {threadId === null ? null : (
          <button
            type="button"
            aria-pressed={onlyThis}
            onClick={() => setOnlyThis((value) => !value)}
            className={`h-7 shrink-0 rounded-md px-2 text-[11px] leading-4 ${onlyThis ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            This thread
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">{body}</div>
    </div>
  );
}

// ---------------------------------------------------------------- timeline markers

function PinMarkers() {
  const { pins } = usePins(null);
  const css = useMemo(
    () => markerStyles((pins ?? []).filter((pin) => !pin.threadDeleted).map((pin) => pin.rowId)),
    [pins],
  );
  useEffect(() => {
    if (css === "") return;
    const style = document.createElement("style");
    style.dataset.pinsMarkers = "";
    style.textContent = css;
    document.head.append(style);
    return () => style.remove();
  }, [css]);
  return null;
}

export default definePluginApp((app) => {
  app.slots.messageAction({
    id: "pin",
    title: PIN_ACTION_TITLE,
    run: pinMessage,
  });

  app.slots.experimental_threadHeaderRow({
    id: "bar",
    order: 0,
    component: PinsBar,
  });

  app.slots.experimental_tab({
    ...PANEL_TAB,
    title: "Pins",
    icon: "Pin",
    layout: "flush",
    component: ({ threadId }: { threadId: string }) => <PinsPanel threadId={threadId} />,
  });

  app.slots.experimental_newThreadPanelAction({
    id: PANEL_TAB_ID,
    title: "Pins",
    icon: "Pin",
    layout: "flush",
    component: (_props: PluginNewThreadPanelProps) => <PinsPanel threadId={null} />,
  });

  app.slots.navPanel({
    id: "pins",
    title: "Pins",
    icon: "Pin",
    path: "pins",
    component: PinsPage,
    experimental_useBadge: usePinCountBadge,
  });

  app.slots.experimental_appOverlay({ id: "markers", component: PinMarkers });

  app.commands.register({
    id: "show-pins",
    title: "Pins: Show pinned messages",
    isAvailable: ({ threadId }) => threadId !== null,
    run: ({ experimental_panel }) => {
      experimental_panel.openTab({ tab: PANEL_TAB });
    },
  });
});
