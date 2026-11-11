import { download } from "./fetch.ts";
import { toMarkdown } from "./markdown.ts";
import { selectSections } from "./select.ts";
import { withFixture } from "../search/fixtures.ts";

export const MIN_TEXT = 500;
const CHALLENGE = /just a moment|checking your browser|enable javascript and cookies|cf-chl|captcha|access denied/i;

export interface PageRead { url: string; title?: string; text: string }

/** Download a page now and keep the sections relevant to `query`. Throws when the page can't be read usefully. */
export async function readPage(url: string, query: string): Promise<PageRead> {
  const page = await withFixture("read", { url }, async () => {
    const d = await download(url);
    return { finalUrl: d.finalUrl, ...toMarkdown(d.body, d.contentType) };
  });
  if (page.markdown.length < MIN_TEXT) throw new Error(`page had only ${page.markdown.length} characters of text, probably built by JavaScript`);
  if (page.markdown.length < 3000 && CHALLENGE.test(page.markdown)) throw new Error("page returned a bot check");
  return { url: page.finalUrl, title: page.title, text: selectSections(page.markdown, query) };
}
