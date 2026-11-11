import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { chat } from "./agent/chat.ts";
import { DEFAULT_DATA_DIR, loadNotes, sortNotes, validId } from "./agent/notes.ts";
import { noteHeader } from "./agent/prompt.ts";
import { now as clockNow } from "./agent/clock.ts";
import { models } from "./agent/llm.ts";

const PORT = Number(process.env.PORT) || 3000;
const busy = new Set<string>();

async function readBody(req: IncomingMessage, limit = 64 * 1024): Promise<any> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error("request body too large"), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw Object.assign(new Error("invalid JSON"), { status: 400 });
  }
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}

async function handleChat(req: IncomingMessage, res: ServerResponse) {
  const body = await readBody(req);
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!validId(body.conversationId)) return json(res, 400, { error: "conversationId must be 1-64 letters, digits, - or _" });
  if (!message || message.length > 8000) return json(res, 400, { error: "message must be 1-8000 characters" });
  if (busy.has(body.conversationId)) return json(res, 409, { error: "still answering the previous message" });

  busy.add(body.conversationId);
  res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache", connection: "keep-alive" });
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  try {
    const r = await chat({
      dataDir: DEFAULT_DATA_DIR,
      conversationId: body.conversationId,
      message,
      timeZone: typeof body.timeZone === "string" ? body.timeZone : undefined,
      now: typeof body.now === "string" && body.now ? body.now : undefined,
      onEvent: (e) => send(e.type, e),
    });
    send("done", { text: r.text, sources: r.sources, toolCalls: r.toolCalls, ms: r.ms });
    r.noteWritten.then(() => send("memory", {}), () => {}).finally(() => res.end());
  } catch (err) {
    console.error("[chat]", err);
    send("error", { message: (err as Error).message });
    res.end();
  } finally {
    busy.delete(body.conversationId);
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "GET" && url.pathname === "/") {
      const html = await readFile(path.resolve("public/index.html"));
      return void res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(html);
    }
    if (req.method === "POST" && url.pathname === "/api/chat") return await handleChat(req, res);
    if (req.method === "GET" && url.pathname === "/api/notes") {
      const notes = sortNotes(await loadNotes(DEFAULT_DATA_DIR));
      return json(res, 200, notes.map((n) => ({ id: n.id, header: noteHeader(n), text: n.text, updatedAt: n.updatedAt })));
    }
    if (req.method === "GET" && url.pathname === "/api/config") {
      return json(res, 200, { now: process.env.NOW ? clockNow().toISOString() : null, model: models.main });
    }
    json(res, 404, { error: "not found" });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    if (status === 500) console.error(err);
    if (!res.headersSent) json(res, status, { error: (err as Error).message });
    else res.end();
  }
});

server.listen(PORT, () => console.log(`Chat agent on http://localhost:${PORT} (model ${models.main})`));
