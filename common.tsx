import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  experimental_useSidebarThreads,
  useBbNavigate,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
  type PluginSidebarProject,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { openMessage, threadPath } from "./navigation";
import type { Pin, rpcContract } from "./server";
import { CHANGED_CHANNEL } from "./shared";

// Hooks and bits shared by the bar, the panel tab and the Pins page.

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function usePins(threadId: string | null) {
  const rpc = useRpc<typeof rpcContract>();
  const [pins, setPins] = useState<Pin[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);

  const refetch = useCallback(() => {
    const request = ++latest.current;
    rpc.call("list", threadId === null ? null : { threadId }).then(
      (result) => {
        if (request !== latest.current) return;
        setPins(result.pins);
        setError(null);
      },
      (cause: unknown) => {
        if (request === latest.current) setError(errorText(cause));
      },
    );
  }, [rpc, threadId]);

  useEffect(() => {
    refetch();
  }, [refetch]);
  // The server publishes after every write, from any window.
  useRealtime(CHANGED_CHANNEL, refetch);
  const connection = useRealtimeConnectionState();
  const previous = useRef(connection);
  useEffect(() => {
    if (previous.current === "reconnecting" && connection === "connected") {
      refetch();
    }
    previous.current = connection;
  }, [connection, refetch]);

  return { rpc, pins, error };
}

function fallbackPath(
  pin: Pin,
  projects: ReadonlyMap<string, PluginSidebarProject>,
): string | null {
  if (pin.projectId === null) return null;
  return threadPath(
    pin.threadId,
    pin.projectId,
    projects.get(pin.projectId)?.isPersonal ?? false,
  );
}

/** Jump to a pinned message, in this thread or another one. */
export function useJumpToPin() {
  const sidebar = experimental_useSidebarThreads();
  const navigate = useBbNavigate();
  const threads = useMemo(
    () => new Map(sidebar.threads.map((thread) => [thread.id, thread])),
    [sidebar.threads],
  );
  const projects = useMemo(
    () => new Map(sidebar.projects.map((project) => [project.id, project])),
    [sidebar.projects],
  );
  const jump = useCallback(
    (pin: Pin, split = false) => {
      if (split) {
        // A split opens the thread only; the router state cannot carry a scroll target.
        navigate.toThread(pin.threadId, { split: true });
        return;
      }
      const href = threads.get(pin.threadId)?.href ?? fallbackPath(pin, projects);
      if (href === null || !openMessage(href, pin.threadId, pin.seq)) {
        navigate.toThread(pin.threadId);
      }
    },
    [threads, projects, navigate],
  );
  return { jump, threads, projects };
}

export async function removePin(rpc: ReturnType<typeof useRpc<typeof rpcContract>>, pin: Pin) {
  try {
    await rpc.call("remove", { id: pin.id });
  } catch (cause) {
    toast.error(`Could not unpin: ${errorText(cause)}`);
  }
}

export const iconButton =
  "pins-button inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-[var(--state-hover)] hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export function Notice({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="px-3 py-6 text-center text-xs leading-relaxed text-muted-foreground">
      {children}
    </p>
  );
}

