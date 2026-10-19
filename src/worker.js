// Worker entry point (used when the site is deployed as a Cloudflare Worker).
// Static files in public/ are served automatically; anything else lands here.
// The picks logic is shared with the Pages version in functions/api/claims.js.
import { onRequestGet, onRequestPost } from "../functions/api/claims.js";

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/claims") {
      if (request.method === "GET") return onRequestGet({ request, env });
      if (request.method === "POST") return onRequestPost({ request, env });
      return new Response(JSON.stringify({ error: "Use GET or POST." }), {
        status: 405, headers: { "content-type": "application/json", allow: "GET, POST" },
      });
    }
    return env.ASSETS.fetch(request);
  },
};
