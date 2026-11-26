# The Ride: Bengaluru to Travancore Palace

A live audience game for a talk by Tech4Good Community. Tech4Good rides 2,100 km from Bengaluru to
Travancore Palace. At each stop it meets someone with a real problem (Meera, Lakshmi, Arif, Ravi); each
one joins the convoy and raises the issue that opens the next stop. The room's answers steer the ride.

| Screen | URL | Who sees it |
|---|---|---|
| Projector | `/` | Everyone. The presenter runs the session from here (dock, keyboard or clicker). |
| Phones | `/v` | Each person in the room: answers only |

**Live is the default.** Phones vote through the Cloudflare Worker. If the Worker is silent for 5 seconds,
the projector switches to **Host mode** by itself (a small "Host mode" badge; the presenter clicks the
room's pick on the screen) and keeps its place. When the Worker answers again, the dock offers
**Return to Live**.

## The route

Lobby → cold open (6 lines, title card) → Who's riding → Ignition → Stop 1 Bengaluru (websites, guess, Q1,
cards flip) → Adilabad: forest edge (Q2) and village square (Q3) → petrol pump (skippable) → Nagpur (Q4,
tokens, Q5, Insight Out) → Jhansi (Q6, pick three) → Travancore Palace (four travellers, Q7, closing).

Every stop follows ARRIVE → LISTEN → THINK (15 s ring, options hidden) → VOTE (30 s bar) → LOCK →
REVEAL → HANDOVER → RIDE (3 s, one signboard). `public/js/route.js` turns the content into one ordered list
of screens, one per beat; the dock's main button always moves to the next one and names it.

**Fuel** is the gauge at the bottom right. It starts at 50%; each vote adds (answers ÷ players) × 10%,
the pump × 20%, capped at 100%. Nothing is lost and nothing is scored. Under 30% turnout the dock shows
"Low turnout. Ask the room to join."

## 1. Deploy for the session

```bash
npm install
npx wrangler login                    # once, in a browser
npx wrangler secret put ADMIN_PIN     # the presenter PIN (asked once on the projector)
npm run deploy                        # prints https://the-ride.<your-subdomain>.workers.dev
```

Open that `https://…` address on the projector. The QR code and short URL use the address the
projector was opened from. To pin a different public address (for example a custom domain), set
`config.publicUrl` in `public/content/en.json` and redeploy. If the projector is opened from a local
address, the dock warns that phones can't reach it.

**Offline Host mode only:** `npm run host` (no Worker needed), then open the printed address.

## 2. Running the session

Everything runs from the projector. Move the mouse and a small dock appears at the bottom right; it hides
itself (and the cursor) after a few seconds, so the audience sees only the story. Its main button names the
next action: **Begin**, **Next line**, **Fire it up**, **Meet Meera**, **Show the question**, **Open voting**,
**Lock votes**, **Reveal**, **Meera joins**, **Ride to Nagpur**. Beside it: Back, the Think/Vote timers
(pause, add 15 s, reopen), Skip the refuel stop, Live/Host, sound, **Notes** (core issue, note, the
reveal to come, the Stop 1 sites), **Placeholders** (amber, with a count) and reset. In Host mode, click
the room's answer on the screen. A clicker or the keyboard works without the dock.

Browsers only play sound after a click: click or press a key once on the projector window before the
cold open. The engine idles under the cold open and roars on "Fire it up".

| Key on the projector | Action |
|---|---|
| **→ / Space / Enter / PageDown** | The dock's main button (clickers work) |
| **← / PageUp** | Back |
| **V** · **P** · **+** | Lock now or reopen voting · pause the Think or Vote timer · add 15 seconds |
| **A–D**, **1–9**, **0** | The room's pick by hand (pick three: toggle up to three), 0 clears |
| **S** · **M** · **L** · **F** | Skip the refuel stop · sound · Host/Live · fullscreen |

## 3. Editing the content: `public/content/en.json`

Every word on the projector and phones comes from this file: `coldOpen`, `crew`,
`ignition`, `places` (the five route dots), `personas`, and `stops` in order. Each stop has its `place`,
`spot`, `scene` (illustration), `persona`, `voice`, `steps` and `handover`; `sign` is the signboard on the
ride into it. Questions carry `revealNote` and `core` (the presenter's note, in the dock). Votes are stored by step
id and option id, never by text, so wording can change freely; don't rename ids during a session.

**Placeholders.** Any text starting with `PLACEHOLDER` is never shown to the audience; the dock's amber
Placeholders button lists them with the screen each appears on. Still to fill:

- Who's riding: the three facts (`crew.facts`). Each fact gets its own screen once filled.
- Stop 1: who built each website, how long it took and what it cost (`sites[].builtBy`, `took`, `cost`).
- Insight Out: the link (`link` on the `insight` step); its QR code appears on the projector once filled.
- `config.publicUrl`: the public HTTPS address for the QR code (otherwise the address the projector was opened from).

The scripts in `tests/` were written for the previous flow and have not been updated for this one.

## Project layout

```
public/
  index.html  vote.html  favicon.svg
  content/en.json       the route, settings and all text
  js/route.js           the route as one list of steps; shared by every page and the tests
  js/presenter.js       projector: flow, fuel, countdown, sound, Live/Host, the presenter's dock
  js/vote.js            phones
  js/ui.js              shared components: persona pill, bike, route bar, fuel, milestone, answers, QR
  js/icons.js           Material Symbols icons as inline SVG (no icon font, no CDN)
  js/profanity.js       word-cloud filter (phones and Worker)
  css/base.css          design tokens from the Stitch export (colours, type, spacing, radii, motion)
  css/  fonts/  img/  vendor/qrcode.js
  img/scenes/           stop backdrops (see "Backdrops" below)
design/stitch/          the Google Stitch export (visual source of truth; reference only)
worker/index.js         Cloudflare Worker + Durable Object (no personal data)
tools/serve.mjs         offline Host-mode server
tests/shots.mjs  tests/run.mjs  tests/fallback.mjs
```

Design: the Google Stitch export in design/stitch/ is the visual source of truth. The projector is a
fixed 16:9 stage on Stitch's 1440×810 grid, scaled to the screen (1920×1080 on a 1080p projector).

Fonts (SIL Open Font License, bundled): Playfair, Poppins, Red Hat Mono. Icons: Material Symbols
(Apache 2.0), inlined as SVG. Riders and bikes are the Stitch SVG. The showcase screenshots were
captured from the public sites; Holématthi is embedded live when the projector is Live and online
(hakki.photos forbids embedding, so it always shows its screenshot).

Backdrops: drawn as layered SVG by `tools/backdrops.mjs` (sources in design/backdrops/) and rendered to
WebP in public/img/scenes/ with sharp: `npm run backdrops` (or `npm run backdrops -- forest` for one).
One per place (prologue, workbench, forest, village, pump, records, bridge, palace, at 1920×1080) and one
seamless 3840×1080 road panorama per leg (road-1 … road-4), which pans while the convoy rides.
config.backdrops in en.json maps each to its file. The earlier Stitch images are in public/img/scenes/_old/.