import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-" });
td.use(gfm);
td.remove(["script", "style", "nav", "header", "footer", "aside", "form", "iframe", "noscript", "svg", "button", "template"] as TurndownService.Filter);
td.addRule("image", { filter: "img", replacement: () => "" });
// keep link text, drop URLs: they eat the character budget, and the facts live in the text
td.addRule("link", { filter: "a", replacement: (content) => content });

export function toMarkdown(body: string, contentType: string): { title?: string; markdown: string } {
  if (!/html|xml/i.test(contentType) && !/^\s*</.test(body)) return { markdown: body.trim() };
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(body)?.[1]?.replace(/\s+/g, " ").trim();
  const markdown = td.turndown(body).replace(/\n{3,}/g, "\n\n").trim();
  return { title: title ? decodeEntities(title) : undefined, markdown };
}

function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");
}
