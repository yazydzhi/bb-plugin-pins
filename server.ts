import { randomUUID } from "node:crypto";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { CHANGED_CHANNEL, MAX_TEXT_LENGTH, truncate } from "./shared";

const EXCERPT_LENGTH = 600;

const roleSchema = z.enum(["user", "assistant"]);

const messageSchema = z
  .object({
    threadId: z.string().min(1).max(200),
    /** The message's `sourceSeqEnd`: unique per thread and stable. */
    seq: z.number().int().nonnegative(),
    /** Timeline row id; only used to mark pinned messages in the timeline. */
    rowId: z.string().min(1).max(2_000),
    role: roleSchema,
    text: z.string().max(MAX_TEXT_LENGTH),
  })
  .strict();

const pinSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  seq: z.number().int(),
  rowId: z.string(),
  role: roleSchema,
  /** The pinned selection when there is one, else the message text; cut short. */
  excerpt: z.string(),
  quoted: z.boolean(),
  threadTitle: z.string().nullable(),
  projectId: z.string().nullable(),
  threadDeleted: z.boolean(),
  createdAt: z.number().int(),
});

export type Pin = z.infer<typeof pinSchema>;

export const rpcContract = defineRpcContract({
  list: {
    input: z.object({ threadId: z.string().min(1).max(200).optional() }).strict().nullable(),
    output: z.object({ pins: z.array(pinSchema) }),
  },
  toggle: {
    input: messageSchema,
    output: z.object({ pin: pinSchema.nullable() }),
  },
  add: {
    input: messageSchema
      .extend({ quote: z.string().min(1).max(MAX_TEXT_LENGTH).optional() })
      .strict(),
    output: z.object({ pin: pinSchema }),
  },
  remove: {
    input: z.object({ id: z.string().min(1) }).strict(),
    output: z.object({ removed: z.boolean() }),
  },
});

export interface PinRow {
  id: string;
  thread_id: string;
  seq: number;
  row_id: string;
  role: "user" | "assistant";
  text: string;
  quote: string | null;
  thread_title: string | null;
  project_id: string | null;
  thread_deleted: number;
  created_at: number;
}

// Append-only: the index of a statement is its migration id.
const MIGRATIONS = [
  `CREATE TABLE pins (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    row_id TEXT NOT NULL,
    role TEXT NOT NULL,
    text TEXT NOT NULL,
    quote TEXT,
    thread_title TEXT,
    project_id TEXT,
    thread_deleted INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    UNIQUE (thread_id, seq)
  )`,
];

export function toPin(row: PinRow): Pin {
  return {
    id: row.id,
    threadId: row.thread_id,
    seq: row.seq,
    rowId: row.row_id,
    role: row.role,
    excerpt: truncate(row.quote ?? row.text, EXCERPT_LENGTH),
    quoted: row.quote !== null,
    threadTitle: row.thread_title,
    projectId: row.project_id,
    threadDeleted: row.thread_deleted === 1,
    createdAt: row.created_at,
  };
}

export default async function plugin(bb: BbPluginApi) {
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);

  const selectAll = db.prepare<[], PinRow>(
    "SELECT * FROM pins ORDER BY created_at DESC, rowid DESC",
  );
  const selectByThread = db.prepare<[string], PinRow>(
    "SELECT * FROM pins WHERE thread_id = ? ORDER BY seq ASC",
  );
  const selectByMessage = db.prepare<[string, number], PinRow>(
    "SELECT * FROM pins WHERE thread_id = ? AND seq = ?",
  );
  const insertRow = db.prepare<[Omit<PinRow, "thread_deleted">]>(
    `INSERT OR IGNORE INTO pins
      (id, thread_id, seq, row_id, role, text, quote, thread_title, project_id, created_at)
     VALUES
      (@id, @thread_id, @seq, @row_id, @role, @text, @quote, @thread_title, @project_id, @created_at)`,
  );
  const updateQuote = db.prepare<[string, number, string]>(
    "UPDATE pins SET quote = ?, created_at = ? WHERE id = ?",
  );
  const deleteById = db.prepare<[string]>("DELETE FROM pins WHERE id = ?");
  const markThreadDeleted = db.prepare<[string]>(
    "UPDATE pins SET thread_deleted = 1 WHERE thread_id = ? AND thread_deleted = 0",
  );
  const refreshThread = db.prepare<
    [{ threadId: string; title: string | null; projectId: string }]
  >(
    `UPDATE pins SET thread_title = @title, project_id = @projectId
     WHERE thread_id = @threadId
       AND (thread_title IS NOT @title OR project_id IS NOT @projectId)`,
  );

  const publishChange = () => bb.realtime.publish(CHANGED_CHANNEL, null);

  async function describeThread(threadId: string) {
    try {
      const thread = await bb.sdk.threads.get({ threadId });
      return {
        title: thread.title ?? thread.titleFallback ?? null,
        projectId: thread.projectId,
      };
    } catch (error) {
      bb.log.warn(`Could not read thread ${threadId}: ${String(error)}`);
      return { title: null, projectId: null };
    }
  }

  function messageRow(threadId: string, seq: number): PinRow {
    const row = selectByMessage.get(threadId, seq);
    if (row === undefined) throw new Error("The pin could not be saved.");
    return row;
  }

  async function create(
    message: z.infer<typeof messageSchema>,
    quote: string | null,
  ): Promise<PinRow> {
    const thread = await describeThread(message.threadId);
    // A concurrent pin of the same message wins; both callers get its row.
    insertRow.run({
      id: randomUUID(),
      thread_id: message.threadId,
      seq: message.seq,
      row_id: message.rowId,
      role: message.role,
      text: message.text,
      quote,
      thread_title: thread.title,
      project_id: thread.projectId,
      created_at: Date.now(),
    });
    return messageRow(message.threadId, message.seq);
  }

  bb.rpc.register(rpcContract, {
    list(input) {
      const rows =
        input?.threadId === undefined
          ? selectAll.all()
          : selectByThread.all(input.threadId);
      return { pins: rows.map(toPin) };
    },
    async toggle(message) {
      const existing = selectByMessage.get(message.threadId, message.seq);
      if (existing !== undefined) {
        deleteById.run(existing.id);
        publishChange();
        return { pin: null };
      }
      const row = await create(message, null);
      publishChange();
      return { pin: toPin(row) };
    },
    async add({ quote, ...message }) {
      const existing = selectByMessage.get(message.threadId, message.seq);
      if (existing === undefined) {
        await create(message, quote ?? null);
      } else if (quote !== undefined) {
        updateQuote.run(quote, Date.now(), existing.id);
      }
      publishChange();
      return { pin: toPin(messageRow(message.threadId, message.seq)) };
    },
    remove({ id }) {
      const removed = deleteById.run(id).changes > 0;
      if (removed) publishChange();
      return { removed };
    },
  });

  bb.events.on("thread.deleted", ({ thread }) => {
    if (markThreadDeleted.run(thread.id).changes > 0) publishChange();
  });

  // Titles are usually generated after the first turn, so refresh the saved
  // title whenever a thread goes idle.
  bb.events.on("thread.idle", ({ thread }) => {
    const result = refreshThread.run({
      threadId: thread.id,
      title: thread.title ?? thread.titleFallback ?? null,
      projectId: thread.projectId,
    });
    if (result.changes > 0) publishChange();
  });
}
