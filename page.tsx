import { useMemo, useState } from "react";
import type { MouseEvent, ReactNode } from "react";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { formatAge, groupPins, snippet } from "./helpers";
import {
  iconButton,
  Notice,
  removePin,
  useJumpToPin,
  usePins,
} from "./common";
import type { Pin } from "./server";

/** Badge on the sidebar entry: how many pins there are, nothing when none. */
export function usePinCountBadge() {
  const { pins } = usePins(null);
  const count = pins?.length ?? 0;
  if (count === 0) return null;
  return { count, label: count === 1 ? "1 pin" : `${count} pins` };
}

function PinRow({
  pin,
  now,
  onOpen,
  onRemove,
}: {
  pin: Pin;
  now: number;
  onOpen: (event: MouseEvent) => void;
  onRemove: () => void;
}) {
  const text = snippet(pin.excerpt, pin.role === "assistant" && !pin.quoted, 400);
  return (
    <li className="pins-row group flex items-start gap-1">
      <button
        type="button"
        onClick={onOpen}
        disabled={pin.threadDeleted}
        title={pin.threadDeleted ? undefined : "Go to message (Cmd/Ctrl-click opens a split)"}
        className="flex min-w-0 flex-1 items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-[var(--state-hover)] focus-visible:bg-[var(--state-hover)] focus-visible:outline-none disabled:cursor-default disabled:hover:bg-transparent"
      >
        <Icon
          name={pin.role === "user" ? "User" : "Bot"}
          fallback="Pin"
          className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <span className={`pins-text line-clamp-3 min-w-0 flex-1 text-sm leading-5 text-foreground ${pin.quoted ? "border-l-2 border-border pl-2" : ""}`}>
          {text === "" ? "No text" : text}
        </span>
        <span className="pins-age shrink-0 text-xs leading-5 tabular-nums text-muted-foreground">
          {formatAge(pin.createdAt, now)}
        </span>
      </button>
      <button
        type="button"
        aria-label="Remove pin"
        title="Remove pin"
        className={`${iconButton} mt-1.5`}
        onClick={onRemove}
      >
        <Icon name="Trash2" className="size-3.5" aria-hidden="true" />
      </button>
    </li>
  );
}

export function PinsPage() {
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const { rpc, pins, error } = usePins(null);
  const { jump, threads, projects } = useJumpToPin();
  const searching = query.trim() !== "";

  const groups = useMemo(
    () =>
      pins === null
        ? null
        : groupPins(
            pins,
            (pin) => threads.get(pin.threadId)?.displayTitle ?? pin.threadTitle ?? "Untitled thread",
            query,
          ),
    [pins, threads, query],
  );
  const now = Date.now();

  const toggle = (key: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  let body: ReactNode;
  if (groups === null) {
    body = <Notice>{error ?? "Loading pins…"}</Notice>;
  } else if (groups.length === 0) {
    body = (
      <Notice>
        {searching
          ? `No pins match “${query.trim()}”.`
          : "No pins yet — use the pin button on a message."}
      </Notice>
    );
  } else {
    body = groups.map((group) => {
      // A search opens every group that matched.
      const open = searching || !collapsed.has(group.key);
      const projectId = group.pins[0]?.projectId ?? null;
      const project = group.deleted || projectId === null ? undefined : projects.get(projectId);
      return (
        <section key={group.key} className="pins-group">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => toggle(group.key)}
            className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left hover:bg-[var(--state-hover)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <Icon
              name={open ? "ChevronDown" : "ChevronRight"}
              className="size-3.5 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <span className="pins-group-title min-w-0 truncate text-sm font-medium text-foreground">
              {group.title}
            </span>
            {project === undefined ? null : (
              <span className="pins-group-project min-w-0 shrink truncate text-xs text-muted-foreground">
                {project.name}
              </span>
            )}
            <span className="pins-group-count ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
              {group.pins.length}
            </span>
          </button>
          {open ? (
            <ul className="mt-0.5 flex flex-col gap-px pl-4">
              {group.pins.map((pin) => (
                <PinRow
                  key={pin.id}
                  pin={pin}
                  now={now}
                  onOpen={(event) => jump(pin, event.metaKey || event.ctrlKey)}
                  onRemove={() => void removePin(rpc, pin)}
                />
              ))}
            </ul>
          ) : null}
        </section>
      );
    });
  }

  return (
    <div className="pins-page h-full min-h-0 overflow-y-auto p-4 md:p-5">
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <label className="relative block">
          <span className="sr-only">Search pins</span>
          <Icon name="Search" className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search pins and threads"
            className="h-9 w-full rounded-md border border-border bg-transparent pl-8 pr-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none"
          />
        </label>
        <div className="space-y-2">{body}</div>
      </div>
    </div>
  );
}
