// Shared "Pick to cover" claims for the CCMC Story Lead Board.
// Storage: a Cloudflare KV namespace bound to this Pages project as CLAIMS.
// Each claim is one key ("claim:<event id>") with the claimer in its metadata,
// so a single list() call returns every claim.

const PREFIX = "claim:";
const TTL_SECONDS = 60 * 60 * 24 * 90; // old claims clean themselves up after 90 days

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

function missingBinding(env) {
  if (!env.CLAIMS) {
    return json(
      { error: "Picks storage isn't connected yet. Add a KV namespace bound as CLAIMS (see the README), then redeploy." },
      500
    );
  }
  return null;
}

async function readAll(env) {
  const claims = {};
  let cursor;
  do {
    const page = await env.CLAIMS.list({ prefix: PREFIX, cursor });
    for (const k of page.keys) {
      if (k.metadata) claims[k.name.slice(PREFIX.length)] = k.metadata;
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return claims;
}

export async function onRequestGet({ env }) {
  return missingBinding(env) || json({ claims: await readAll(env) });
}

export async function onRequestPost({ request, env }) {
  const bad = missingBinding(env);
  if (bad) return bad;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Send JSON: {id, name, action}." }, 400);
  }

  const id = String(body.id || "");
  if (!/^[a-z0-9-]{3,80}$/.test(id)) return json({ error: "That event ID isn't valid." }, 400);

  const key = PREFIX + id;

  if (body.action === "unclaim") {
    await env.CLAIMS.delete(key);
    return json({ claims: await readAll(env) });
  }

  if (body.action !== "claim") return json({ error: "Action must be claim or unclaim." }, 400);

  // Behind Cloudflare Access, the signed-in staff email is passed along; use it when present.
  const email = request.headers.get("Cf-Access-Authenticated-User-Email") || "";
  const name = String(body.name || "").trim().slice(0, 40) || email.split("@")[0];
  if (!name) return json({ error: "Enter your name before picking an event." }, 400);

  const existing = await env.CLAIMS.getWithMetadata(key);
  if (existing.metadata && existing.metadata.name.toLowerCase() !== name.toLowerCase()) {
    return json({ error: `${existing.metadata.name} is already covering this.`, claims: await readAll(env) }, 409);
  }

  const meta = { name, email, at: new Date().toISOString() };
  await env.CLAIMS.put(key, "1", { metadata: meta, expirationTtl: TTL_SECONDS });
  return json({ claims: await readAll(env) });
}
