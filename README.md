# Search agent with memory

A chat agent with one tool, `web_search`, and dated memory of past conversations. Search finds pages, reading a page checks it, and memory keeps the URL so the next check goes straight back to the same page. `DESIGN.md` explains the design and the eval results; `docs/architecture.html` steps through one question, box by box (open it in a browser).

## Run

```
npm install
cp .env.example .env   # add OPENAI_API_KEY and EXA_API_KEY at least
npm run dev            # http://localhost:3000
```

Works with any OpenAI-compatible Chat Completions endpoint: set `OPENAI_BASE_URL`, `MAIN_MODEL` and `NOTE_MODEL`.

## Other scripts

- `npm run search -- "neon pricing"` or `npm run search -- "Launch plan price" --url https://neon.com/pricing`: try the tool by hand.
- `npm run eval [-- EX-01 ADV-03] [--no-judge]`: run the 60 test cases in `evals/test-cases.json`. Each sets the clock to the case's date and seeds the memory from its history. Results land in `evals/results/`.
- `SEARCH_MODE=record npm run eval` saves every search and page read to `evals/fixtures/`; `SEARCH_MODE=replay` reruns from them offline; `SEARCH_MODE=cache` replays what's recorded and records anything new (use it after prompt edits).
- `npm test`: unit tests for URL safety, section selection, citations, calendar and eval helpers.

## Layout

```
src/server.ts            HTTP server, SSE streaming
src/agent/               prompt builder, model loop, citation check, notes, clock
src/tool/web_search.ts   tool schema, search vs read mode, numbering
src/tool/search/         Exa, Tavily failover, record/replay fixtures
src/tool/read/           safe fetch, HTML to markdown, relevant-section selection
public/index.html        chat page, "What I remember" panel, dev clock
evals/                   test cases, runner and judge
data/                    memory notes and transcripts (gitignored)
```
