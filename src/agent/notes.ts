import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { llm, models } from "./llm.ts";
import { calendar, formatDateTime } from "./clock.ts";
import type { Evidence } from "../tool/web_search.ts";

export interface Note {
  id: string;
  conversationId: string;
  startedAt?: string; // UTC ISO; absent for seeded notes whose text carries its own date
  timeZone?: string;
  text: string;
  updatedAt?: string;
}

export interface StoredMessage { role: "user" | "assistant"; content: string; at: string }

export interface Conversation {
  id: string;
  startedAt: string;
  timeZone: string;
  messages: StoredMessage[];
  /** sources cited so far; their numbers stay valid for later turns */
  sources: Evidence[];
}

export const DEFAULT_DATA_DIR = path.resolve("data");
const ID = /^[\w-]{1,64}$/;

export function validId(id: unknown): id is string {
  return typeof id === "string" && ID.test(id);
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw err; // a corrupt file must not be silently replaced with an empty one
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2));
  await rename(tmp, file); // atomic replace, so a crash never leaves half a file
}

export const loadNotes = (dir: string) => readJson<Note[]>(path.join(dir, "notes.json"), []);
export const saveNotes = (dir: string, notes: Note[]) => writeJson(path.join(dir, "notes.json"), notes);

const convFile = (dir: string, id: string) => path.join(dir, "conversations", `${id}.json`);
export const loadConversation = (dir: string, id: string) => readJson<Conversation | null>(convFile(dir, id), null);
export const saveConversation = (dir: string, c: Conversation) => writeJson(convFile(dir, c.id), c);

/** Oldest first; seeded notes without a date keep their stored order at the front. */
export function sortNotes(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => (a.startedAt ?? "").localeCompare(b.startedAt ?? ""));
}

// One writer at a time, so two note updates never race on notes.json.
let queue: Promise<unknown> = Promise.resolve();
export function enqueueNoteUpdate(dir: string, conv: Conversation, now: Date): Promise<void> {
  const run = queue.then(() => updateNote(dir, conv, now));
  queue = run.catch((err) => console.error(`[notes] update failed for ${conv.id}: ${(err as Error).message}`));
  return run;
}

const NOTE_SYSTEM = `You keep the memory of a chat assistant. From the transcript of ONE conversation, write that conversation's memory note. In future chats the assistant will see only these notes, never the transcript, so the note must stand on its own.

Write short markdown bullets under these labels, skipping labels with nothing to say:
- **Asked:** each user question in near-original wording (quote short ones exactly).
- **Answered:** the key facts the assistant gave, with exact values (prices, plan names, dates, figures) and the source URL for each fact, taken from the Sources lists in the transcript.
- **Decisions:** shortlists, choices and their latest state. If the user changed a requirement, record the latest one and what it replaced.
- **About the user:** preferences, constraints and context (team size, budget, location, tools).
- **Dates:** every relative date converted to an absolute date with weekday, using the day the message was sent (for example "trial ends next Friday", said on Fri 6 Nov, becomes "trial ends Fri 13 Nov").
- **Open:** anything left unresolved or that the user said they would come back to.

Be faithful: no invented facts and no commentary. Never record something the user asked the assistant to forget.

Forget requests: if the user asked in this conversation to forget something, also remove it from every other note where it appears and return each changed note, rewritten in full, in "edits" keyed by its id. Otherwise "edits" is {}.

Reply with only a JSON object: {"note": "<markdown>", "edits": {"<note id>": "<full rewritten note>"}}`;

export async function updateNote(dir: string, conv: Conversation, now: Date): Promise<void> {
  const notes = await loadNotes(dir);
  const own = notes.find((n) => n.conversationId === conv.id);
  const others = notes.filter((n) => n !== own);
  const transcript = conv.messages
    .map((m) => `${m.role === "user" ? "USER" : "ASSISTANT"} (${formatDateTime(new Date(m.at), conv.timeZone)}):\n${m.content}`)
    .join("\n\n");
  const user = `Today: ${formatDateTime(now, conv.timeZone)}, ${conv.timeZone}
Calendar:
${calendar(now, conv.timeZone)}

OTHER NOTES:
${others.map((n) => `[id: ${n.id}]\n${n.text}`).join("\n\n") || "(none)"}

CURRENT NOTE FOR THIS CONVERSATION:
${own?.text ?? "(none yet)"}

TRANSCRIPT OF THIS CONVERSATION (started ${formatDateTime(new Date(conv.startedAt), conv.timeZone)}, ${conv.timeZone}):
${transcript}`;

  const res = await llm().chat.completions.create({
    model: models.note,
    messages: [{ role: "system", content: NOTE_SYSTEM }, { role: "user", content: user }],
  });
  const parsed = parseJsonObject(res.choices[0]?.message?.content ?? "");
  if (typeof parsed?.note !== "string" || !parsed.note.trim()) throw new Error("note writer returned no note");

  // re-read in case notes changed while the model was writing
  const fresh = await loadNotes(dir);
  const at = new Date().toISOString();
  const edits = parsed.edits && typeof parsed.edits === "object" ? (parsed.edits as Record<string, unknown>) : {};
  const forgotIn = new Set<string>();
  for (const n of fresh) {
    const edit = edits[n.id];
    if (n.conversationId !== conv.id && typeof edit === "string") {
      n.text = edit;
      n.updatedAt = at;
      forgotIn.add(n.conversationId);
    }
  }
  const mine = fresh.find((n) => n.conversationId === conv.id);
  if (mine) Object.assign(mine, { text: parsed.note, updatedAt: at });
  else fresh.push({ id: conv.id, conversationId: conv.id, startedAt: conv.startedAt, timeZone: conv.timeZone, text: parsed.note, updatedAt: at });
  await saveNotes(dir, fresh);
  // a forgotten item must not survive in an old raw transcript either; that conversation's note is now its only record
  for (const id of forgotIn) await rm(convFile(dir, id), { force: true });
  if (forgotIn.size) console.log(`[notes] forget applied to ${forgotIn.size} other note(s)`);
}

export function parseJsonObject(s: string): Record<string, unknown> | null {
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(s.slice(start, end + 1));
  } catch {
    return null;
  }
}
