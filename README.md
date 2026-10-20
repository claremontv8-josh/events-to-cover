# CCMC Story Lead Board

**Live at https://events.claremontv.org** (Cloudflare Pages project `ccmc-events`; DNS is a CNAME at Bluehost pointing to `ccmc-events.pages.dev`).

An internal board for Claremont Community Media Center: free community events within about 25 miles of Claremont, NH, with suggested shoots and a shared **Pick to cover** button so the team can see who's covering what.

Hosted on Cloudflare Pages. The event list is refreshed by Claude every Monday and Thursday morning, which commits a new `public/events.json` to this repo; Cloudflare redeploys automatically.

## What's in the repo

| Path | What it does |
| --- | --- |
| `public/index.html` | The board itself (filters, suggested shoots, Pick buttons) |
| `public/events.json` | The event list. Edit by hand any time, or let the refresh update it |
| `public/calendar.js` | Builds the Google Calendar links and .ics files |
| `public/_headers` | Keeps browsers from caching an old event list |
| `functions/api/claims.js` | The small server function that saves and reads picks (Cloudflare D1) |

## One-time setup on Cloudflare (about 10 minutes)

1. **Create the Pages project.** In the Cloudflare dashboard go to **Workers & Pages → Create application**, and look for the **Pages** option, which Cloudflare now labels **legacy Pages** (the main Create flow defaults to Workers). Then **Connect to Git** and choose `events-to-cover`. If you see *"Bindings cannot be added to a Worker that only has static assets"* later, you created a Worker by mistake: delete it and start again from the Pages tab. Set:
   - Framework preset: **None**
   - Build command: *(leave empty)*
   - Build output directory: **`public`**

   Click **Save and Deploy**. You'll get an address ending in **`.pages.dev`** (a `.workers.dev` address means it was created as a Worker).
2. **Create the picks database.** Go to **Storage & Databases → D1 SQL Database → Create**, name it `ccmc-picks`, and create it. You don't need to make any tables; the site creates its table on first use.
3. **Connect it to the site.** Open the Pages project → **Settings → Bindings → Add → D1 database**. Variable name: **`DB`** (exactly, in capitals). Database: `ccmc-picks`. Save.
4. **Redeploy** so the binding takes effect: **Deployments → … on the latest deployment → Retry deployment**. Check that the deployment you retry is the newest commit; Retry rebuilds that exact commit.

Until step 3 is done, the board still shows events but displays a notice that picks aren't available.

### Why D1 and not KV

The first version stored picks in Workers KV. An open board checks for teammates' picks regularly, and each check is a KV "list" call; the free plan allows only 1,000 of those a day, so one tab left open all day used them up. KV lists can also lag about a minute behind changes, which made unpicks look like they hadn't worked. D1's free plan allows 5 million row reads a day and shows changes immediately. The board now also checks only once a minute, and only while the tab is on screen.

The old `ccmc-claims` KV namespace is no longer used. You can remove its binding and delete it.

## Keep it internal: Cloudflare Access (free up to 50 users)

1. In the dashboard open **Zero Trust** (first visit asks you to pick a team name and the Free plan).
2. **Access → Applications → Add an application → Self-hosted.**
3. Application domain: the board's address. Note: `events.claremontv.org` uses Bluehost DNS, and Access generally needs the domain's DNS on Cloudflare, so protecting that address would mean moving claremontv.org's DNS to Cloudflare first.
4. Add a policy: **Allow**, Include → **Emails** (list staff addresses) or **Emails ending in** your CCMC domain.
5. Save. Staff now get a one-time code by email the first time they open the board.

With Access on, each pick also records the staff member's email.

## Using it

- Type your name in **Your name** (remembered on that device), then click **Pick to cover**. Everyone sees "Covering: *name*" within a minute, or right away when they reload or come back to the tab.
- After you pick, the board offers **Add to Google Calendar** (opens Google Calendar with the shoot filled in; click Save) or an **.ics** file for Outlook and Apple Calendar. The same links stay under **You're covering**.
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
npx wrangler pages dev public --d1 DB
```

Then open http://localhost:8788.
