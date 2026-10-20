// Events added by hand on the board ("Add an event"), stored in the same
// D1 database as picks (binding DB). The table is created on first use.
//
// GET  /api/added                       -> { events: [...] } upcoming added events
// POST /api/added {action:"add", ...}   -> adds one, returns { event, events }
// POST /api/added {action:"remove", id} -> removes one, returns { events }

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

const TZ = "America/New_York";
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());

let ready = false;
async function db(env) {
  if (!env.DB) {
    const e = new Error("The events database isn't connected. Bind the D1 database as DB (see the README), then redeploy.");
    e.status = 500;
    throw e;
  }
  if (!ready) {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS added_events (
         id TEXT PRIMARY KEY, d TEXT NOT NULL, t TEXT NOT NULL, title TEXT NOT NULL,
         town TEXT NOT NULL, venue TEXT NOT NULL DEFAULT '', free INTEGER NOT NULL DEFAULT 1,
         cost TEXT NOT NULL DEFAULT '', cat TEXT NOT NULL DEFAULT 'Community',
         angle TEXT NOT NULL DEFAULT '', url TEXT NOT NULL DEFAULT '',
         added_by TEXT NOT NULL, added_at TEXT NOT NULL)`
    ).run();
    ready = true;
  }
  return env.DB;
}

const CATS = ["Community", "Arts", "Market", "Kids & family", "Health / seniors", "Business / jobs", "Sports / rec"];

async function list(DB) {
  const { results } = await DB.prepare("SELECT * FROM added_events WHERE d >= ? ORDER BY d, t").bind(today()).all();
  return (results || []).map(r => ({
    id: r.id, d: r.d, t: r.t, title: r.title, town: r.town, mi: "", venue: r.venue,
    free: r.free ? 1 : 0, ...(r.free ? {} : { cost: r.cost || "Paid" }),
    cat: r.cat, angle: r.angle || "Added by the CCMC team.", url: r.url,
    src: `Added by ${r.added_by}`, added: 1, addedBy: r.added_by,
  }));
}

const clean = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 36) || "event";

async function handle(fn) {
  try { return await fn(); }
  catch (e) { return json({ error: e.status ? e.message : "That couldn't be saved right now. Try again in a minute." }, e.status || 500); }
}

export const onRequestGet = ({ env }) => handle(async () => json({ events: await list(await db(env)) }));

export const onRequestPost = ({ request, env }) =>
  handle(async () => {
    const DB = await db(env);
    let b;
    try { b = await request.json(); } catch { return json({ error: "Send the event as JSON." }, 400); }

    if (b.action === "remove") {
      const id = String(b.id || "");
      if (!/^add-[a-z0-9-]{3,76}$/.test(id)) return json({ error: "Only events added on the board can be removed here." }, 400);
      await DB.batch([
        DB.prepare("DELETE FROM added_events WHERE id = ?").bind(id),
        DB.prepare("DELETE FROM claims WHERE id = ?").bind(id), // its pick goes too
      ]).catch(async () => { await DB.prepare("DELETE FROM added_events WHERE id = ?").bind(id).run(); });
      return json({ events: await list(DB) });
    }

    if (b.action !== "add") return json({ error: "Action must be add or remove." }, 400);
    if (b.website) return json({ error: "That couldn't be saved." }, 400); // hidden field bots fill in

    const title = clean(b.title, 120);
    const d = clean(b.d, 10);
    const t = clean(b.t, 40) || "Time TBA";
    const town = clean(b.town, 40);
    const by = clean(b.addedBy, 40);
    const url = clean(b.url, 500);
    if (title.length < 3) return json({ error: "Give the event a name (at least 3 characters)." }, 400);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || isNaN(Date.parse(d))) return json({ error: "Pick the event's date." }, 400);
    if (d < today()) return json({ error: "That date has already passed." }, 400);
    if (!town) return json({ error: "Enter the town." }, 400);
    if (!by) return json({ error: "Enter your name in the Rundown bar so the team knows who added it." }, 400);
    if (url && !/^https?:\/\/\S+$/i.test(url)) return json({ error: "The link should start with http:// or https://" }, 400);

    const { results: dupe } = await DB.prepare("SELECT id FROM added_events WHERE d = ? AND lower(title) = lower(?)").bind(d, title).all();
    if (dupe && dupe.length) return json({ error: "That event is already on the board for that day." }, 409);

    const id = `add-${d}-${slug(title)}-${Math.random().toString(36).slice(2, 6)}`;
    const free = b.free === false || b.free === 0 ? 0 : 1;
    await DB.prepare(
      `INSERT INTO added_events (id, d, t, title, town, venue, free, cost, cat, angle, url, added_by, added_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id, d, t, title, town, clean(b.venue, 120), free, free ? "" : clean(b.cost, 40) || "Paid",
      CATS.includes(b.cat) ? b.cat : "Community", clean(b.angle, 300), url, by, new Date().toISOString()
    ).run();

    const events = await list(DB);
    return json({ event: events.find(e => e.id === id), events });
  });
