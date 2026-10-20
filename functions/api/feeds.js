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

// Event listing pages read as text (no feed available). Only FREE events are kept,
// and only in towns within MAX_MILES of Claremont.
// Example entry:
//   { key: "site", name: "Site Name", page: "https://site.org/calendar", pages: 3 }
// Note: GreaterUpperValley.com was tried here and refuses automated requests
// (HTTP 403), so its free events are gathered by the scheduled refresh instead.
const LISTINGS = [];

const MAX_MILES = 30;
// Approximate road miles from Claremont, NH.
const MILES = {
  claremont: 0, newport: 9, charlestown: 10, cornish: 10, "cornish flat": 10, unity: 8, acworth: 14, goshen: 12,
  plainfield: 14, meriden: 16, croydon: 13, grantham: 16, sunapee: 14, "new london": 22, springfield: 10,
  "north springfield": 12, windsor: 12, "west windsor": 15, ascutney: 9, weathersfield: 10, "perkinsville": 13,
  reading: 22, lebanon: 20, "west lebanon": 18, enfield: 25, canaan: 30, hanover: 24, etna: 23, norwich: 25,
  "white river junction": 22, wrj: 22, hartford: 22, quechee: 21, woodstock: 23, "bellows falls": 24,
  rockingham: 24, chester: 20, walpole: 25, alstead: 22, lempster: 14, washington: 20, sharon: 30, pomfret: 28,
  lyme: 34, thetford: 34, fairlee: 42, orford: 40, bradford: 45, keene: 33,
};

const DAYS_AHEAD = 45;
const CACHE_SECONDS = 1800; // fetch each feed at most every 30 minutes
const TZ = "America/New_York";

// Titles that are meetings, bookings or admin, not story material.
const SKIP = /\b(meeting|mtg|board|committee|commission|council|private|closed|rental|rented|reserved|hold|staff|office hours|set ?up|clean ?up|tentative|aa|na|al-anon|service|worship|mass|bible|prayer|rehearsals?|practice|yoga|class|lessons?|club|support group)\b/i;
// Repeating weekly/daily items (services, classes, rehearsals) are routine, not stories.
const ROUTINE_FREQ = /FREQ=(DAILY|WEEKLY)/i;

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
  // Venues often append the room ("Concert - Sanctuary"); keep it for the venue line.
  const full = unescape(ev.SUMMARY?.value);
  const room = (full.match(/\s[-–]\s(Sanctuary|Parlor|Parlour|Hall|Chapel|Room \w+|Gallery|Kitchen|Library|Basement|Vestry)$/i) || [])[1];
  const title = room ? full.slice(0, full.length - room.length).replace(/\s[-–]\s$/, "").trim() : full;
  if (!title || SKIP.test(title)) return [];
  if (ev.RRULE && ROUTINE_FREQ.test(ev.RRULE.value)) return [];
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
    venue: (loc && !/^https?:/.test(loc) ? loc : feed.venue) + (room ? ` (${room})` : ""),
    ...costOf(`${title} ${desc}`),
    cat: /music|concert|band|folk|jazz|song|candlelight|tribute|dance/i.test(`${title} ${desc}`) ? "Arts" : "Community",
    angle: desc ? (desc.length > 170 ? desc.slice(0, 167).replace(/\s+\S*$/, "") + "…" : desc) : `From ${feed.name}'s public calendar.`,
    src: `${feed.name} calendar (live)`,
    url: link,
    live: 1,
  }));
}

async function fetchCached(url) {
  const cache = caches.default;
  const key = new Request(`https://feeds.cache/${encodeURIComponent(url)}`);
  let res = await cache.match(key);
  if (!res) {
    const up = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (compatible; CCMC Story Lead Board; +https://events.claremontv.org)", accept: "text/html,text/calendar,*/*" } });
    if (!up.ok) throw new Error(`HTTP ${up.status}`);
    res = new Response(await up.text(), { headers: { "cache-control": `public, max-age=${CACHE_SECONDS}` } });
    await cache.put(key, res.clone());
  }
  return res.text();
}

async function loadFeed(feed, from, to) {
  return parseIcs(await fetchCached(feed.ics)).flatMap(ev => toBoard(feed, ev, from, to));
}

// ---------- listing pages read as text ----------

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…" };
// HTML -> trimmed text lines. Links are kept as "text ⟦href⟧" so titles keep their event URL.
function htmlLines(html, base) {
  return html
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (m, href, inner) => {
      let url = href;
      try { url = new URL(href, base).toString(); } catch {}
      return `${inner} ⟦${url}⟧`;
    })
    .replace(/<\/?(div|p|li|ul|ol|h[1-6]|br|tr|td|section|article|header|footer|time|dl|dt|dd|figure|figcaption|main|aside|nav|table)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : +e.slice(1)) : (ENTITIES[e.toLowerCase()] ?? m))
    .split("\n")
    .map(l => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
// "Oct 21, 2026 06:00 PM – 09:00 PM" (end part optional, start time optional)
const WHEN = /^([A-Za-z]{3,4})\.? (\d{1,2}),? (\d{4})(?:,? (\d{1,2}):(\d{2}) ?([AP]M))?(?: ?[–-] ?(?:[A-Za-z]{3,4}\.? \d{1,2},? \d{4} )?(\d{1,2}):(\d{2}) ?([AP]M))?/i;
const PRICE = /^(free|\$|by donation|donation|suggested|admission|tickets?|cost|\d+(\.\d\d)? ?(usd|\$)|pay what)|\b(free|\$\d)/i;
const linkOf = l => (l.match(/⟦([^⟧]+)⟧/) || [])[1] || "";
const plain = l => l.replace(/\s*⟦[^⟧]*⟧/g, "").trim();
const mins = (h, m, ap) => ((+h % 12) + (ap.toUpperCase() === "PM" ? 12 : 0)) * 60 + +m;

// Venues the calendar lists by name only.
const VENUES = {
  "claremont rec": "claremont", "csb community center": "claremont", "fiske": "claremont", "claremont opera house": "claremont",
  "visitor center green": "claremont", "broad street park": "claremont", "monadnock park": "claremont", "the well": "claremont",
  "colburn park": "lebanon", "ava gallery": "lebanon", "lebanon opera house": "lebanon", "lebanon public library": "lebanon",
  "kilton": "west lebanon", "storrs pond": "hanover", "allen street": "hanover", "fourth place": "hanover",
  "hopkins center": "hanover", "hood museum": "hanover", "howe library": "hanover", "dartmouth": "hanover", "sawtooth": "hanover",
  "etna library": "etna", "montshire": "norwich", "norwich bookstore": "norwich", "norman williams": "woodstock",
  "billings farm": "woodstock", "town hall theatre": "woodstock", "simon pearce": "quechee", "upper valley aquatic": "white river junction",
  "lyman point": "white river junction", "main street museum": "white river junction", "briggs opera house": "white river junction",
  "hotel coolidge": "white river junction", "northern stage": "white river junction", "richards free library": "newport",
  "newport opera house": "newport", "library arts center": "newport", "abbott library": "sunapee", "fort at no. 4": "charlestown",
  "saint-gaudens": "cornish", "plainfield village": "plainfield", "philip read": "plainfield", "enfield shaker": "enfield",
  "mascoma valley": "canaan", "artistree": "pomfret", "hall art": "reading",
};

function townOf(venue) {
  const v = venue.toLowerCase();
  const named = Object.keys(VENUES).find(k => v.includes(k));
  if (named) return VENUES[named];
  const m = venue.match(/([A-Za-z .']+),\s*(NH|VT|New Hampshire|Vermont)\b/);
  const cand = m ? m[1].split(/[-–,]/).pop().trim().toLowerCase() : "";
  if (cand && cand in MILES) return cand;
  return Object.keys(MILES).sort((a, b) => b.length - a.length).find(t => new RegExp(`\\b${t}\\b`).test(v)) || "";
}
const title = s => s.replace(/\b\w/g, c => c.toUpperCase());

function parseListing(lines, src, from, to) {
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const w = plain(lines[i]).match(WHEN);
    if (!w || !(w[1].slice(0, 3).toLowerCase() in MONTHS)) continue;
    const d = `${w[3]}-${String(MONTHS[w[1].slice(0, 3).toLowerCase()]).padStart(2, "0")}-${w[2].padStart(2, "0")}`;
    if (d < from || d > to) continue;
    // title: closest line above that isn't a date or a price
    let ti = i - 1;
    while (ti > 0 && (WHEN.test(plain(lines[ti])) || PRICE.test(plain(lines[ti])) && plain(lines[ti]).length < 40)) ti--;
    const name = plain(lines[ti]);
    if (!name || name.length < 3 || /^(read more|more|details|image)$/i.test(name) || SKIP.test(name)) continue;
    // optional price line, then venue line
    let j = i + 1, priceText = "";
    if (lines[j] && PRICE.test(plain(lines[j])) && !WHEN.test(plain(lines[j]))) priceText = plain(lines[j++]);
    const venue = lines[j] && !WHEN.test(plain(lines[j])) ? plain(lines[j]) : "";
    if (!/\bfree\b/i.test(priceText) || /with .*admission|admission required/i.test(priceText)) continue;
    const town = townOf(`${venue} ${name}`);
    const mi = town ? MILES[town] : null;
    if (mi != null && mi > MAX_MILES) continue; // unknown town: keep, labeled Upper Valley
    const start = w[4] ? mins(w[4], w[5], w[6]) : null;
    const end = w[7] ? mins(w[7], w[8], w[9]) : null;
    const t = start == null ? "All day"
      : timeText({ date: d, min: start }, end == null ? null : { date: d, min: end });
    out.push({
      id: `${src.key}-${d}-${slug(name)}`,
      d, t, title: name,
      town: town ? title(town) : "Upper Valley", mi: mi ?? "",
      venue: venue || (town ? title(town) : "See listing"),
      free: 1,
      cat: /music|concert|band|folk|jazz|song|dance|art|gallery|theat|film|poetry|reading|author|book/i.test(name) ? "Arts"
         : /kid|family|child|story ?walk|trick|trunk|halloween|teen/i.test(name) ? "Kids & family"
         : /market|fair|bazaar|sale/i.test(name) ? "Market" : "Community",
      angle: priceText && !/^free$/i.test(priceText) ? priceText : `Free event listed on ${src.name}.`,
      src: `${src.name} (live)`,
      url: linkOf(lines[ti]) || src.page,
      live: 1,
    });
  }
  // same event listed twice on a page (featured + regular) -> keep one
  const seen = new Set();
  return out.filter(e => !seen.has(e.id) && seen.add(e.id));
}

async function loadListing(src, from, to) {
  const all = [], ids = new Set();
  for (let n = 1; n <= (src.pages || 1); n++) {
    const url = n === 1 ? src.page : `${src.page}${src.page.includes("?") ? "&" : "?"}page=${n}`;
    let html;
    try { html = await fetchCached(url); } catch (e) { if (n === 1) throw e; break; }
    const found = parseListing(htmlLines(html, src.page), src, from, to).filter(e => !ids.has(e.id));
    if (n > 1 && !found.length) break;
    found.forEach(e => { ids.add(e.id); all.push(e); });
  }
  return all;
}

export async function onRequestGet({ request } = {}) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
  const to = addDays(today, DAYS_AHEAD);
  const sources = [
    ...FEEDS.map(f => ({ name: f.name, run: () => loadFeed(f, today, to) })),
    ...LISTINGS.map(l => ({ name: l.name, run: () => loadListing(l, today, to) })),
  ];
  const results = await Promise.allSettled(sources.map(s => s.run()));
  const events = [], errors = [], counts = {};
  results.forEach((r, i) => {
    if (r.status === "fulfilled") { events.push(...r.value); counts[sources[i].name] = r.value.length; }
    else errors.push(`${sources[i].name} couldn't be read (${r.reason?.message || "error"}).`);
  });
  events.sort((a, b) => a.d.localeCompare(b.d));
  const body = { events, errors, counts };
  // ?debug=<listing key> adds that page's first text lines, to help fix parsing if a site changes.
  const dbg = request && new URL(request.url).searchParams.get("debug");
  const src = dbg && LISTINGS.find(l => l.key === dbg);
  if (src) { try { body.debugLines = htmlLines(await fetchCached(src.page), src.page).slice(0, 220); } catch (e) { body.debugLines = [String(e.message)]; } }
  return json(body);
}

// Exposed for tests.
export const _test = { parseIcs, toBoard, timeText, localParts, occurrences, costOf, htmlLines, parseListing, townOf };
