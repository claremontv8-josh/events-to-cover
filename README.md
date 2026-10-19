# CCMC Story Lead Board

An internal board for Claremont Community Media Center: free community events within about 25 miles of Claremont, NH, with suggested shoots and a shared **Pick to cover** button so the team can see who's covering what.

Hosted on Cloudflare Pages. The event list is refreshed by Claude every Monday and Thursday morning, which commits a new `public/events.json` to this repo; Cloudflare redeploys automatically.

## What's in the repo

| Path | What it does |
| --- | --- |
| `public/index.html` | The board itself (filters, suggested shoots, Pick buttons) |
| `public/events.json` | The event list. Edit by hand any time, or let the refresh update it |
| `public/_headers` | Keeps browsers from caching an old event list |
| `functions/api/claims.js` | The small server function that saves and reads picks |

## One-time setup on Cloudflare (about 10 minutes)

1. **Create the Pages project.** In the Cloudflare dashboard go to **Workers & Pages → Create → Pages → Connect to Git**, choose `events-to-cover`, then set:
   - Framework preset: **None**
   - Build command: *(leave empty)*
   - Build output directory: **`public`**

   Click **Save and Deploy**. You'll get an address like `events-to-cover.pages.dev`.
2. **Create the picks database.** Go to **Storage & Databases → KV → Create a namespace** and name it `ccmc-claims`.
3. **Connect it to the site.** Open the Pages project → **Settings → Bindings → Add → KV namespace**. Variable name: **`CLAIMS`** (exactly, in capitals). Namespace: `ccmc-claims`. Save.
4. **Redeploy** so the binding takes effect: **Deployments → … on the latest deployment → Retry deployment**.

Until step 3 is done, the board still shows events but displays a notice that picks aren't available.

## Keep it internal: Cloudflare Access (free up to 50 users)

1. In the dashboard open **Zero Trust** (first visit asks you to pick a team name and the Free plan).
2. **Access → Applications → Add an application → Self-hosted.**
3. Application domain: your `events-to-cover.pages.dev` address. Also add `*.events-to-cover.pages.dev` so preview links are protected.
4. Add a policy: **Allow**, Include → **Emails** (list staff addresses) or **Emails ending in** your CCMC domain.
5. Save. Staff now get a one-time code by email the first time they open the board.

With Access on, each pick also records the staff member's email.

## Using it

- Type your name in **Your name** (remembered on that device), then click **Pick to cover**. Everyone sees "Covering: *name*" within 30 seconds.
- **Unpick** releases an event. **Not yet picked** filters to open events.
- **Suggested** marks the desk's recommended shoots. **Verify** means the event came from a listing site; confirm with the organizer.
- Picks clear themselves 90 days after they're made.

## Editing events by hand

Each event in `public/events.json` looks like this:

```json
{
  "id": "2026-10-31-hallowesta",
  "d": "2026-10-31",
  "t": "3:30–5:00 PM",
  "title": "Hallowesta",
  "town": "Claremont",
  "mi": 0,
  "venue": "Pleasant St. & Opera House Square",
  "free": 1,
  "cat": "Kids & family",
  "angle": "One-line story angle for the crew",
  "src": "Greater Claremont Chamber",
  "url": "https://...",
  "pick": 1,
  "verify": 1
}
```

Keep the `id` the same when you edit an event, or its pick will disappear. `pick` and `verify` are optional; add `"cost": "$15"` when `free` is `0`. Past events hide themselves automatically.

## Trying it on your own computer

```bash
npx wrangler pages dev public --kv CLAIMS
```

Then open http://localhost:8788.
