// Live calendar feeds for the Story Lead Board.
//
// Some venues publish their events only as a Google Calendar (or another
// .ics feed). This function fetches those feeds on Cloudflare's side, skips
// meetings and private bookings, and returns upcoming events in the same shape
// as public/events.json so the board can show them alongside the curated list.
//
// To add a venue: add an entry to FEEDS. For a public Google Calendar, the
// feed address is
//   https://calendar.google.com/calendar/ical/<calendar id, with @ as %40>/public/basic.ics
// The calendar id is the src= value in the venue's embedded calendar link.

const FEEDS = [
  {
    key: "well",
    name: "The Well Collaborative",
    town: "Claremont",
    mi: 0,
    venue: "The Well, 72 Pleasant St.",
    page: "https://www.thewellcollaborativenh.org/home/events",
    ics: "https://calendar.google.com/calendar/ical/ca66a7f6e2e9232e07990e837cbd6454b8b177efb43e5405a96e706252f6d66b%40group.calendar.google.com/public/basic.ics",
  },
];

const DAYS_AHEAD = 45;
const CACHE_SECONDS = 1800; // fetch each feed at most every 30 minutes
const TZ = "America/New_York";

// Titles that are meetings, bookings or admin, not story material.
const SKIP = /\b(meeting|mtg|board|committee|commission|council|private|closed|rental|rented|reserved|hold|staff|office hours|set ?up|clean ?up|tentative|aa|na|al-anon)\b/i;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": `public, max-age=300` },
  });

// ---------- tiny iCalendar reader ----------

function parseIcs(text) {
  const lines = text.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/);
  const events = [];
  let cur = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") { cur = {}; continue; }
    if (line === "END:VEVENT") { if (cur) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const i = line.indexOf(":");
    if (i < 0) continue;
    const [name, ...params] = line.slice(0, i).split(";");
    const p = {};
    for (const kv of params) { const [k, v] = kv.split("="); p[k.toUpperCase()] = v; }
    const value = line.slice(i + 1);
    const key = name.toUpperCase();
    if (key === "EXDATE") (cur.EXDATE = cur.EXDATE || []).push(...value.split(","));
    else cur[key] = { value, p };
  }
  return events;
}

const unescape = s => String(s || "").replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1").trim();

// Turn an iCal date value into {date:"YYYY-MM-DD", min: minutes after midnight in Claremont | null}
function localParts(prop) {
  if (!prop) return null;
  const v = prop.value;
  if (/^\d{8}$/.test(v) || prop.p.VALUE === "DATE") {
    return { date: `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`, min: null };
  }
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!m) return null;
  if (!m[7] && (!prop.p.TZID || prop.p.TZID === TZ)) {
    return { date: `${m[1]}-${m[2]}-${m[3]}`, min: +m[4] * 60 + +m[5] };
  }
  // UTC (or another zone, treated as UTC offset-free) -> Claremont time
  const utc = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const o = Object.fromEntries(f.formatToParts(utc).map(x => [x.type, x.value]));
  return { date: `${o.year}-${o.month}-${o.day}`, min: +o.hour * 60 + +o.minute };
}

const clock = min => {
  const h = Math.floor(min / 60), m = min % 60, ap = h >= 12 ? "PM" : "AM";
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${ap}`;
};
function timeText(start, end) {
  if (start.min == null) return "All day";
  if (!end || end.min == null || end.date !== start.date || end.min <= start.min) return clock(start.min);
  const a = clock(start.min), b = clock(end.min);
  return a.slice(-2) === b.slice(-2) ? `${a.slice(0, -3)}–${b}` : `${a}–${b}`;
}

const addDays = (d, n) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

// Dates an event happens on within [from, to]; simple DAILY/WEEKLY repeats are expanded.
function occurrences(ev, start, from, to) {
  const rule = ev.RRULE && Object.fromEntries(ev.RRULE.value.split(";").map(kv => kv.split("=")));
  const skip = new Set((ev.EXDATE || []).map(x => localParts({ value: x, p: {} })?.date));
  if (!rule) return start.date >= from && start.date <= to ? [start.date] : [];
  const step = rule.FREQ === "DAILY" ? 1 : rule.FREQ === "WEEKLY" ? 7 : 0;
  if (!step || (rule.BYDAY && rule.BYDAY.includes(","))) return start.date >= from && start.date <= to ? [start.date] : [];
  const every = step * (+rule.INTERVAL || 1);
  const until = rule.UNTIL ? localParts({ value: rule.UNTIL, p: {} })?.date : null;
  let count = rule.COUNT ? +rule.COUNT : Infinity;
  const out = [];
  for (let d = start.date, n = 0; n < count && d <= to && (!until || d <= until) && n < 400; d = addDays(d, every), n++) {
    if (d >= from && !skip.has(d)) out.push(d);
  }
  return out;
}

function costOf(text) {
  if (/\bfree\b/i.test(text) && !/\$\s?\d/.test(text)) return { free: 1 };
  const price = text.match(/\$\s?\d+(?:\.\d{2})?/);
  if (price) return { free: 0, cost: price[0].replace(/\s/g, "") };
  if (/donation/i.test(text)) return { free: 0, cost: "By donation" };
  return { free: 0, cost: "Check cost", costUnknown: 1 };
}

const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

function toBoard(feed, ev, from, to) {
  const title = unescape(ev.SUMMARY?.value);
  if (!title || SKIP.test(title)) return [];
  if ((ev.STATUS?.value || "").toUpperCase() === "CANCELLED") return [];
  if ((ev.CLASS?.value || "").toUpperCase() === "PRIVATE") return [];
  const start = localParts(ev.DTSTART);
  if (!start) return [];
  const end = localParts(ev.DTEND);
  const desc = unescape(ev.DESCRIPTION?.value).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const loc = unescape(ev.LOCATION?.value);
  const link = ev.URL?.value || ((desc.match(/https?:\/\/[^\s)"'<>]+/) || [])[0] || "").replace(/[.,;:!?]+$/, "") || feed.page;
  const t = timeText(start, end);
  return occurrences(ev, start, from, to).map(d => ({
    id: `${feed.key}-${d}-${slug(title)}`,
    d, t, title,
    town: feed.town, mi: feed.mi,
    venue: loc && !/^https?:/.test(loc) ? loc : feed.venue,
    ...costOf(`${title} ${desc}`),
    cat: /music|concert|band|folk|jazz|song|candlelight|tribute|dance/i.test(`${title} ${desc}`) ? "Arts" : "Community",
    angle: desc ? (desc.length > 170 ? desc.slice(0, 167).replace(/\s+\S*$/, "") + "…" : desc) : `From ${feed.name}'s public calendar.`,
    src: `${feed.name} calendar (live)`,
    url: link,
    live: 1,
  }));
}

async function loadFeed(feed, from, to) {
  const cache = caches.default;
  const key = new Request(`https://feeds.cache/${feed.key}`);
  let res = await cache.match(key);
  if (!res) {
    const up = await fetch(feed.ics, { headers: { "user-agent": "CCMC Story Lead Board (events.claremontv.org)" } });
    if (!up.ok) throw new Error(`${feed.name}: HTTP ${up.status}`);
    res = new Response(await up.text(), { headers: { "cache-control": `public, max-age=${CACHE_SECONDS}` } });
    await cache.put(key, res.clone());
  }
  return parseIcs(await res.text()).flatMap(ev => toBoard(feed, ev, from, to));
}

export async function onRequestGet() {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
  const to = addDays(today, DAYS_AHEAD);
  const results = await Promise.allSettled(FEEDS.map(f => loadFeed(f, today, to)));
  const events = [], errors = [];
  results.forEach((r, i) => (r.status === "fulfilled" ? events.push(...r.value) : errors.push(`${FEEDS[i].name} couldn't be read.`)));
  events.sort((a, b) => a.d.localeCompare(b.d));
  return json({ events, errors });
}

// Exposed for tests.
export const _test = { parseIcs, toBoard, timeText, localParts, occurrences, costOf };
