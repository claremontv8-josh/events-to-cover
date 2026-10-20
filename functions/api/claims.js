// Shared "Pick to cover" claims for the CCMC Story Lead Board.
// Storage: a Cloudflare D1 database bound to this Pages project as DB.
// The table is created automatically on first use; no console step needed.
//
// Why D1 and not KV: the board refreshes picks while it's open, and every
// refresh lists all picks. KV's free plan allows only 1,000 list calls a day
// and its lists can lag a minute behind writes. D1 allows millions of row
// reads a day and a read right after a write sees that write.

const MAX_AGE_DAYS = 90; // picks older than this are ignored and cleaned up

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

let tableReady = false; // once per server instance
async function ready(env) {
  if (!env.DB) {
    const err = new Error("Picks storage isn't connected yet. Bind a D1 database as DB to this Pages project (see the README), then redeploy.");
    err.status = 500;
    throw err;
  }
  if (!tableReady) {
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS claims (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL DEFAULT '', at TEXT NOT NULL)"
    ).run();
    tableReady = true;
  }
  return env.DB;
}

const cutoff = () => new Date(Date.now() - MAX_AGE_DAYS * 864e5).toISOString();

async function readAll(db) {
  const { results } = await db
    .prepare("SELECT id, name, email, at FROM claims WHERE at > ?")
    .bind(cutoff())
    .all();
  const claims = {};
  for (const r of results || []) claims[r.id] = { name: r.name, email: r.email, at: r.at };
  return claims;
}

async function handle(fn) {
  try {
    return await fn();
  } catch (err) {
    return json({ error: err.status ? err.message : "Picks couldn't be read or saved right now. Try again in a minute." }, err.status || 500);
  }
}

export const onRequestGet = ({ env }) =>
  handle(async () => json({ claims: await readAll(await ready(env)) }));

export const onRequestPost = ({ request, env }) =>
  handle(async () => {
    const db = await ready(env);

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Send JSON: {id, name, action}." }, 400);
    }

    const id = String(body.id || "");
    if (!/^[a-z0-9-]{3,80}$/.test(id)) return json({ error: "That event ID isn't valid." }, 400);

    if (body.action === "unclaim") {
      await db.prepare("DELETE FROM claims WHERE id = ?").bind(id).run();
      return json({ claims: await readAll(db) });
    }

    if (body.action !== "claim") return json({ error: "Action must be claim or unclaim." }, 400);

    // Behind Cloudflare Access, the signed-in staff email is passed along; use it when present.
    const email = request.headers.get("Cf-Access-Authenticated-User-Email") || "";
    const name = String(body.name || "").trim().slice(0, 40) || email.split("@")[0];
    if (!name) return json({ error: "Enter your name before picking an event." }, 400);

    const now = new Date().toISOString();
    // Insert, or replace a pick that has expired, or refresh your own pick.
    // Someone else's current pick is left alone and reported as a conflict.
    await db.batch([
      db.prepare("DELETE FROM claims WHERE at <= ?").bind(cutoff()),
      db
        .prepare(
          `INSERT INTO claims (id, name, email, at) VALUES (?1, ?2, ?3, ?4)
           ON CONFLICT(id) DO UPDATE SET name = excluded.name, email = excluded.email, at = excluded.at
           WHERE lower(claims.name) = lower(excluded.name)`
        )
        .bind(id, name, email, now),
    ]);

    const claims = await readAll(db);
    const holder = claims[id];
    if (holder && holder.name.toLowerCase() !== name.toLowerCase()) {
      return json({ error: `${holder.name} is already covering this.`, claims }, 409);
    }
    return json({ claims });
  });
