// Injectable clock: a per-request override (dev panel, evals) beats NOW in the env, which beats the real time.
export function now(override?: string): Date {
  for (const s of [override, process.env.NOW]) {
    if (!s) continue;
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

export function safeZone(tz?: string): string {
  if (tz) {
    try {
      new Intl.DateTimeFormat("en-GB", { timeZone: tz });
      return tz;
    } catch {}
  }
  return "UTC";
}

/** "Wed 11 Nov 2026, 10:14" in the given zone. */
export function formatDateTime(d: Date, tz: string): string {
  const p = parts(d, tz);
  return `${p.weekday} ${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute}`;
}

function parts(d: Date, tz: string) {
  const out: Record<string, string> = {};
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, weekday: "short", day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  for (const { type, value } of fmt.formatToParts(d)) out[type] = value;
  return out as { weekday: string; day: string; month: string; year: string; hour: string; minute: string };
}

/** Days from `back` before today to `ahead` after, each with its weekday, today marked. */
export function calendar(d: Date, tz: string, back = 21, ahead = 14): string {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(d).split("-").map(Number);
  const noon = Date.UTC(ymd[0], ymd[1] - 1, ymd[2], 12); // noon UTC never crosses a date line when stepping days
  const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
  const days: string[] = [];
  for (let i = -back; i <= ahead; i++) {
    const label = fmt.format(new Date(noon + i * 86_400_000)).replace(",", "");
    days.push(i === 0 ? `${label} (today)` : label);
  }
  const lines: string[] = [];
  for (let i = 0; i < days.length; i += 7) lines.push(days.slice(i, i + 7).join(", "));
  return lines.join("\n");
}

/** Convert a wall-clock time in `tz` to a UTC Date. */
export function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, tz: string): Date {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(guess));
  const g = (t: string) => Number(p.find((x) => x.type === t)!.value);
  const asZoned = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"));
  return new Date(guess - (asZoned - guess));
}
