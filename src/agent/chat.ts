import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { now as clockNow, safeZone } from "./clock.ts";
import { buildSystemPrompt } from "./prompt.ts";
import { runTurn, type ToolCallLog, type TurnEvent } from "./loop.ts";
import { checkCitations } from "./citations.ts";
import { enqueueNoteUpdate, loadConversation, loadNotes, saveConversation, sortNotes, type Conversation } from "./notes.ts";
import { newTurnContext, type Evidence } from "../tool/web_search.ts";

export interface ChatRequest {
  dataDir: string;
  conversationId: string;
  message: string;
  timeZone?: string;
  now?: string;
  onEvent?: (e: TurnEvent) => void;
  writeNote?: boolean;
}

export interface ChatResponse {
  text: string;
  sources: Evidence[];
  toolCalls: ToolCallLog[];
  removedCitations: number[];
  ms: number;
  usage: { input: number; output: number };
  /** resolves when the memory note for this conversation has been rewritten */
  noteWritten: Promise<void>;
}

export async function chat(req: ChatRequest): Promise<ChatResponse> {
  const t0 = Date.now();
  const now = clockNow(req.now);
  const tz = safeZone(req.timeZone);
  const conv: Conversation = (await loadConversation(req.dataDir, req.conversationId)) ?? {
    id: req.conversationId, startedAt: now.toISOString(), timeZone: tz, messages: [], sources: [],
  };

  // this conversation is already in the messages, so its own note stays out of the prompt
  const notes = sortNotes((await loadNotes(req.dataDir)).filter((n) => n.conversationId !== conv.id));
  const history: ChatCompletionMessageParam[] = [
    ...conv.messages.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: req.message },
  ];
  const ctx = newTurnContext(now, tz, Math.max(0, ...conv.sources.map((s) => s.n)) + 1);
  const turn = await runTurn({ system: buildSystemPrompt(now, tz, notes), history, ctx, onEvent: req.onEvent });

  const checked = checkCitations(turn.text, [...conv.sources, ...ctx.evidence]);
  if (checked.removed.length) console.warn(`[citations] removed unknown source numbers: ${checked.removed.join(", ")}`);

  const at = now.toISOString();
  conv.messages.push(
    { role: "user", content: req.message, at },
    { role: "assistant", content: withSourceList(checked.text, checked.cited), at },
  );
  const known = new Set(conv.sources.map((s) => s.n));
  conv.sources.push(...checked.cited.filter((s) => !known.has(s.n)));
  await saveConversation(req.dataDir, conv);

  const noteWritten = req.writeNote === false ? Promise.resolve() : enqueueNoteUpdate(req.dataDir, conv, now);
  noteWritten.catch(() => {}); // logged by the queue; callers may ignore it
  return {
    text: checked.text, sources: checked.cited, toolCalls: turn.toolCalls, removedCitations: checked.removed,
    ms: Date.now() - t0, usage: turn.usage, noteWritten,
  };
}

/** The stored reply keeps its sources, so later turns and the note writer can see the URLs. */
function withSourceList(text: string, cited: Evidence[]): string {
  if (!cited.length) return text;
  return `${text}\n\nSources:\n${cited.map((s) => `[${s.n}] ${s.title ?? s.url}: ${s.url}${s.mode === "read" ? " (read directly)" : ""}`).join("\n")}`;
}
