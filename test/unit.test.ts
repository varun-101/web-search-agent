import { test } from "node:test";
import assert from "node:assert/strict";
import { assertPublicUrl, isPrivateAddress } from "../src/tool/read/fetch.ts";
import { selectSections, splitSections, queryTerms } from "../src/tool/read/select.ts";
import { toMarkdown } from "../src/tool/read/markdown.ts";
import { checkCitations } from "../src/agent/citations.ts";
import { calendar, formatDateTime, zonedToUtc } from "../src/agent/clock.ts";
import { parseJsonObject } from "../src/agent/notes.ts";
import { parseToday, seedNotes } from "../evals/run.ts";
import type { Evidence } from "../src/tool/web_search.ts";

test("private, loopback, link-local and metadata addresses are blocked", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "0.0.0.0", "100.64.0.1", "::1", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "not-an-ip"])
    assert.equal(isPrivateAddress(ip), true, ip);
  for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "172.32.0.1"]) assert.equal(isPrivateAddress(ip), false, ip);
});

test("URL checks reject bad schemes, credentials and internal hosts", async () => {
  for (const u of ["file:///etc/passwd", "ftp://example.com", "http://user:pw@example.com", "http://localhost:3000", "http://127.0.0.1/", "http://[::1]/", "http://169.254.169.254/latest/meta-data", "nonsense"])
    await assert.rejects(assertPublicUrl(u), Error, u);
  assert.equal((await assertPublicUrl("http://8.8.8.8/")).hostname, "8.8.8.8");
});

test("section selection keeps the pricing section of a long page, in page order", () => {
  const filler = (n: number) => Array.from({ length: n }, (_, i) => `Lorem ipsum dolor sit amet ${i}, consectetur adipiscing elit.`).join(" ");
  const md = [
    "# Neon", filler(30),
    "## Customers", filler(40),
    "## Pricing", "| Plan | Price |\n|---|---|\n| Launch | $19 / month |\n| Scale | $69 / month |",
    "## Careers", filler(40),
    "## Storage pricing", "Extra storage costs $0.35 per GB-month.",
  ].join("\n\n");
  const out = selectSections(md, "Neon Launch plan price per month", 1200);
  assert.match(out, /\$19 \/ month/);
  assert.match(out, /\$0\.35 per GB/);
  assert.doesNotMatch(out, /## Careers/);
  assert.ok(out.indexOf("Launch") < out.indexOf("Storage pricing"));
  assert.ok(out.length <= 1300);
});

test("splitSections cuts a headingless wall of text", () => {
  const parts = splitSections("word ".repeat(2000));
  assert.ok(parts.length > 3 && parts.every((p) => p.length <= 3000));
  assert.deepEqual(queryTerms("What is the price of the AWS Lambda?"), ["price", "aws", "lambda"]);
});

test("HTML to markdown drops navigation and keeps tables", () => {
  const { title, markdown } = toMarkdown(
    "<html><head><title>Plans &amp; pricing</title><script>evil()</script></head><body><nav>Home About</nav><h1>Plans</h1><table><tr><th>Plan</th><th>Price</th></tr><tr><td>Pro</td><td>$20</td></tr></table><footer>(c) 2026</footer></body></html>",
    "text/html",
  );
  assert.equal(title, "Plans & pricing");
  assert.match(markdown, /\| Pro \| \$20 \|/);
  assert.doesNotMatch(markdown, /Home About|evil|\(c\) 2026/);
});

test("citation check removes numbers the tool never returned", () => {
  const ev: Evidence[] = [{ n: 1, url: "https://a.com", mode: "search" }, { n: 2, url: "https://b.com", mode: "read" }];
  const r = checkCitations("Price is $19 [1]. Also [2, 7]. Made up [9]. See [link](https://x.com).", ev);
  assert.equal(r.text, "Price is $19 [1]. Also [2]. Made up. See [link](https://x.com).");
  assert.deepEqual(r.removed, [7, 9]);
  assert.deepEqual(r.cited.map((e) => e.n), [1, 2]);
});

test("calendar marks today and labels weekdays in the user's zone", () => {
  const d = new Date("2026-11-11T10:14:00Z");
  const cal = calendar(d, "Europe/London");
  assert.match(cal, /Wed 11 Nov \(today\)/);
  assert.match(cal, /Tue 3 Nov/);
  assert.match(cal, /Wed 21 Oct/); // 21 days back
  assert.match(cal, /Wed 25 Nov/); // 14 days ahead
  // 23:30 UTC on the 10th is already the 11th in Sydney
  assert.match(calendar(new Date("2026-11-10T23:30:00Z"), "Australia/Sydney"), /Wed 11 Nov \(today\)/);
  assert.equal(formatDateTime(d, "Europe/London"), "Wed 11 Nov 2026, 10:14");
  assert.equal(zonedToUtc(2026, 11, 9, 8, 20, "Australia/Sydney").toISOString(), "2026-11-08T21:20:00.000Z");
});

test("eval helpers parse dates and split history into notes", () => {
  assert.deepEqual(parseToday("Wednesday 11 November 2026, 10:15"), { now: "2026-11-11T10:15:00.000Z", timeZone: "Europe/London" });
  assert.deepEqual(parseToday("Wednesday 11 November 2026, 10:00 (user in Los Angeles, PST, UTC-8)"), { now: "2026-11-11T18:00:00.000Z", timeZone: "America/Los_Angeles" });
  assert.deepEqual(
    parseToday("Thursday 12 November 2026, 07:45 Sydney time (Wednesday 11 November, 20:45 UTC)"),
    { now: "2026-11-11T20:45:00.000Z", timeZone: "Australia/Sydney" },
  );
  // 01:10 happens twice that night in New York; the stated UTC time picks the EST one
  assert.deepEqual(
    parseToday("Sunday 1 November 2026, 01:10 EST (New York; clocks went back from 02:00 EDT to 01:00 EST ten minutes ago; 06:10 UTC)"),
    { now: "2026-11-01T06:10:00.000Z", timeZone: "America/New_York" },
  );
  const notes = seedNotes("Tue 3 Nov 2026: user asked about Postgres. Mon 9 Nov 2026: user shortlisted 5 CRM tools.");
  assert.equal(notes.length, 2);
  assert.match(notes[1].text, /^Mon 9 Nov 2026/);
  assert.deepEqual(seedNotes("none"), []);
  assert.deepEqual(parseJsonObject('Sure! {"note": "x", "edits": {}} done'), { note: "x", edits: {} });
});
