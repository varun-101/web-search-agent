# Design

## The idea

Search finds pages, reading a page checks it, and memory keeps the URL. So "has the price changed since Tuesday?" becomes: find Tuesday's note, re-read the page it links to, compare.

## How it works

1. **Prompt.** Rules, today's date in the user's time zone, a five-week calendar, and every memory note, oldest first.
2. **One model, one tool.** The model decides when to call `web_search`, runs independent calls in parallel, then answers. Limit: 8 calls per reply.
3. **`web_search`.** Give it a query and it searches (Exa, with Tavily as backup). Give it a URL and it downloads that page now and keeps the parts that match the query. If the page can't be read, it searches that site instead and says so.
4. **Citation check.** Every `[n]` in the answer must point to a source the tool really returned; anything else is removed.
5. **Memory.** After each reply, a second model call updates a dated note for the conversation: what was asked, the facts given with their URLs, decisions, and relative dates turned into real ones. Asking it to forget something removes it from every note.

## Why

- **The sample questions are about remembering past chats and checking whether old answers still hold**, so memory is the core. With only one tool allowed, memory goes in the prompt, not behind a second tool.
- **Code stores and checks; the model judges.** An earlier design had code parse dates, pick past conversations and decide when facts were stale. On paper it failed about 23 of 60 test cases, mostly in those parts. Now code just shows a calendar and the model reads "last Tuesday" against it.
- **Reading the page now is the only way to know a price is current.** Search indexes can be days old.
- **Fetching URLs safely.** The server only fetches public addresses (no internal IPs or credentials), checks every redirect, and stops at 10 seconds or 2 MB. Web text is labelled as content, not instructions.
- **Any OpenAI-compatible API**, so the model is a setting.

## Rejected

- **Memory as a second tool:** breaks the one-tool rule.
- **A provider's built-in search:** results can't be stored, replayed or checked.
- **A vector database:** dated notes in the prompt are enough for weeks of use.
- **A planner or sub-agents:** slower, and they lose the user's intent.
- **Returning whole pages:** too much text; we keep the relevant sections.

## Results

60 test cases (examiner, adversarial, search quality, everyday users), each graded 0 to 2 by an LLM judge, with a "trap" to avoid. Model: `gpt-6.1-sol`.

| Run | Score | Traps | Avg time |
|---|---|---|---|
| First | 83 / 120 (69%) | 6 | 13.9 s |
| After tuning | 99 / 120 (83%) | 2 | 13.8 s |

Between runs we fixed an eval bug (every case ran on London time) and told the judge what the test memory held. We also added prompt rules: do what you can before asking, timestamp live figures, and treat "contact sales" prices as estimates. Part of the gain is fairer grading.

The main remaining weakness: the agent answers the literal question and stops. It skips the obvious next fact (the next game, when a museum reopens). In one case it calculated with a remembered rate it should have re-checked.

## With another week

- Add "what will they need next?" and "re-check before calculating" rules, then measure.
- Watch a shortlist and open the next chat with what changed.
- Compress notes once they outgrow the prompt.
- A second way to read pages built by JavaScript.
- Seed the tests with full transcripts instead of one-line summaries.
