import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 5;

const blocked = new BlockList();
const V4: [string, number][] = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 3],
];
const V6: [string, number][] = [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8], ["64:ff9b::", 96]];
for (const [net, bits] of V4) blocked.addSubnet(net, bits, "ipv4");
for (const [net, bits] of V6) blocked.addSubnet(net, bits, "ipv6");

export function isPrivateAddress(ip: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) ip = mapped[1];
  const family = isIP(ip);
  if (!family) return true;
  return blocked.check(ip, family === 4 ? "ipv4" : "ipv6");
}

export class FetchError extends Error {
  constructor(message: string, readonly status?: number) { super(message); }
}
/** The URL itself is not allowed; no fallback should touch it. */
export class UrlRejected extends FetchError {}

/**
 * The server fetches whatever the model asks for, and text on web pages can steer the model,
 * so every URL (including each redirect hop) must resolve only to public addresses.
 * shortcut: fetch() resolves DNS again after this check, so DNS rebinding could slip through; pin the IP with a custom dispatcher if this runs next to sensitive internal services.
 */
export async function assertPublicUrl(raw: string | URL): Promise<URL> {
  let url: URL;
  try { url = new URL(raw); } catch { throw new UrlRejected("not a valid URL"); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new UrlRejected("only http and https URLs can be read");
  if (url.username || url.password) throw new UrlRejected("URLs with credentials are not allowed");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addrs = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (!addrs.length) throw new FetchError(`could not resolve ${host}`);
  if (addrs.some(isPrivateAddress)) throw new UrlRejected("that address is private or internal and cannot be read");
  return url;
}

export interface Download { finalUrl: string; contentType: string; body: string }

export async function download(raw: string): Promise<Download> {
  let url = await assertPublicUrl(raw);
  for (let hop = 0; ; hop++) {
    const res = await fetch(url, {
      redirect: "manual",
      headers: {
        accept: "text/markdown, text/html;q=0.9, text/plain;q=0.8",
        "user-agent": "Mozilla/5.0 (compatible; web-search-agent/0.1)",
      },
      signal: AbortSignal.timeout(10_000),
    });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      if (hop >= MAX_REDIRECTS) throw new FetchError("too many redirects");
      url = await assertPublicUrl(new URL(location, url));
      continue;
    }
    if (!res.ok) throw new FetchError(`HTTP ${res.status}`, res.status);
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType && !/^text\/|xhtml|\/xml|markdown|json/i.test(contentType)) throw new FetchError(`not a text page (${contentType})`);
    if (Number(res.headers.get("content-length")) > MAX_BYTES) throw new FetchError("page is larger than 2 MB");
    return { finalUrl: url.href, contentType, body: await readCapped(res, contentType) };
  }
}

async function readCapped(res: Response, contentType: string): Promise<string> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = res.body!.getReader();
  while (size < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  await reader.cancel().catch(() => {});
  const charset = /charset=([\w-]+)/i.exec(contentType)?.[1] ?? "utf-8";
  let decoder: TextDecoder;
  try { decoder = new TextDecoder(charset); } catch { decoder = new TextDecoder(); }
  return decoder.decode(Buffer.concat(chunks).subarray(0, MAX_BYTES));
}
