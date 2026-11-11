import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { llm, models, reasoningParams } from "./llm.ts";
import { MAX_CALLS, runWebSearch, webSearchTool, type TurnContext } from "../tool/web_search.ts";

const MAX_ROUNDS = 6;

export type TurnEvent =
  | { type: "text"; delta: string }
  | { type: "tool"; query: string; url?: string };

export interface ToolCallLog { query: string; url?: string; ms: number }

export interface TurnResult {
  text: string;
  toolCalls: ToolCallLog[];
  usage: { input: number; output: number };
  finish: string;
}

/** One reasoning loop: the model decides whether to search, we run the calls in parallel, repeat until it answers. */
export async function runTurn(opts: {
  system: string;
  history: ChatCompletionMessageParam[];
  ctx: TurnContext;
  onEvent?: (e: TurnEvent) => void;
}): Promise<TurnResult> {
  const messages: ChatCompletionMessageParam[] = [{ role: "system", content: opts.system }, ...opts.history];
  const toolCalls: ToolCallLog[] = [];
  const usage = { input: 0, output: 0 };

  for (let round = 0; ; round++) {
    // out of rounds or searches: the model must answer now
    const mustAnswer = round >= MAX_ROUNDS - 1 || opts.ctx.calls >= MAX_CALLS;
    const stream = llm().chat.completions.stream({
      model: models.main,
      messages,
      tools: [webSearchTool],
      tool_choice: mustAnswer ? "none" : "auto",
      stream_options: { include_usage: true },
      ...reasoningParams(),
    });
    stream.on("content.delta", ({ delta }) => opts.onEvent?.({ type: "text", delta }));
    const completion = await stream.finalChatCompletion();
    usage.input += completion.usage?.prompt_tokens ?? 0;
    usage.output += completion.usage?.completion_tokens ?? 0;

    const choice = completion.choices[0];
    const msg = choice?.message;
    const calls = (msg?.tool_calls ?? []).filter((c) => c.type === "function");
    if (!calls.length || mustAnswer) {
      let text = msg?.content?.trim() || "";
      if (choice?.finish_reason === "length") text += "\n\n_(The answer was cut off because it hit the length limit.)_";
      if (choice?.finish_reason === "content_filter") text ||= "I can't help with that request.";
      if (!text) text = "Sorry, I couldn't produce an answer. Please try again.";
      return { text, toolCalls, usage, finish: choice?.finish_reason ?? "unknown" };
    }

    messages.push({ role: "assistant", content: msg.content ?? null, tool_calls: calls });
    const results = await Promise.all(
      calls.map(async (c) => {
        let args: { query?: string; url?: string };
        try {
          args = JSON.parse(c.function.arguments || "{}");
        } catch {
          return "Error: the tool arguments were not valid JSON. Call web_search again with {\"query\": \"...\"}.";
        }
        opts.onEvent?.({ type: "tool", query: String(args.query ?? ""), url: args.url });
        const t0 = Date.now();
        const out = await runWebSearch(args, opts.ctx);
        toolCalls.push({ query: String(args.query ?? ""), url: args.url, ms: Date.now() - t0 });
        return out;
      }),
    );
    calls.forEach((c, i) => messages.push({ role: "tool", tool_call_id: c.id, content: results[i] }));
  }
}
