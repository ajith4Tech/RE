# The Ride: Bengaluru to Travancore Palace

A live audience game for a talk by Tech4Good Community. A rider on a motorcycle travels
2,100 km from Bengaluru to Travancore Palace, New Delhi, through **4 stops and the arrival**.
At each stop the room meets someone who works with technology (Meera, Lakshmi, Asha, Imran)
and answers one or two questions from their phones: 7 questions in all, plus two quick pulses
at petrol pumps.

| Screen | URL | Who sees it |
|---|---|---|
| Projector | `/` | Everyone. No buttons. |
| Phones | `/v` | Each person in the room |
| Moderator | `/moderator` | Only the moderator: controls, notes, live counts, word-cloud queue, timer |

**Live is the default.** Phones vote through the Cloudflare Worker. If the Worker is silent for
5 seconds, the projector switches to **Host mode** by itself (a small presenter badge; the room
answers by show of hands and you type the result) and keeps its place. When the Worker answers
again, the moderator view offers **Return to Live**.

## The route

| Stop | Steps |
|---|---|
| Lobby | "Join the ride": QR code, short URL, "riders on board" |
| Before we ride | Tech4Good Community, the mission, three facts |
| 1 Bengaluru · 0 km · Where it starts | Q1 on one screen with three states: the two websites → the question under smaller cards → the cards flip to show who built them |
| 2 Anantapur · 280 km · In the field | Meera → Q2 (two word clouds) → reveal → Lakshmi → Q3 → reveal → petrol pump |
| 3 Nagpur · Zero Mile · 1,050 km · The trust checkpost | Asha → Q4 → "Swap names for tokens" → Q5 → Insight Out → petrol pump |
| 4 Jhansi · 1,650 km · The broken bridge | Imran → Q6 (pick three) → reveal |
| Arrival · Travancore Palace · 2,100 km | You → Q7 (word cloud) → closing |

The bike rides, the milestone appears and the persona is introduced **once per stop** (the
arrival screen). Steps inside a stop change only the main panel. During each 3-second ride, two
roadside signboards pass by.

**Fuel is participation.** It starts at 50%. Each question adds (answers ÷ riders on board) × 10%,
each petrol pump × 20% ("The room fuelled the ride"), capped at 100%. Nothing is ever lost and
there are no right answers. In Host mode the room counts as fully on board. If fewer than 30% of
riders answer a vote, the fuel gauge pulses and the moderator sees "Low turnout. Ask the room to join."

## 1. Deploy for the session

```bash
npm install
npx wrangler login                    # once, in a browser
npx wrangler secret put ADMIN_PIN     # the presenter and moderator PIN
npm run deploy                        # prints https://the-ride.<your-subdomain>.workers.dev
```

Open that `https://…` address on the projector. The QR code and short URL use the address the
projector was opened from. To pin a different public address (for example a custom domain), set
`config.publicUrl` in `public/content/en.json` and redeploy. If the projector or moderator view is
opened from a local address, the moderator view warns that phones can't reach it.

**Offline Host mode only:** `npm run host` (no Worker needed), then open the printed address.

## 2. Running the session

Drive everything from the moderator view (a phone, or a second window on the projector laptop).
Its main button always names what happens next: **Start the ride**, **Show the websites**,
**Ask the room**, **Lock votes**, **Reveal**, **Meet Lakshmi**, **Pull in to refuel**, **Ride on**.

| Key on the projector | Action |
|---|---|
| **→ / Space / Enter / PageDown** | The moderator's main button (clickers work) |
| **← / PageUp** | Back (undoes a lock) |
| **V** | Lock votes now / reopen voting (15 more seconds) |
| **P** · **+** | Pause / resume the countdown · add 15 seconds |
| **A–D**, **1–8**, **0** | Host mode: the room's pick (pick-three: toggle up to three), 0 clears |
| **W** · **N** | Add a word-cloud answer (Q2: W = "Let AI find…", N = "Never let AI decide…") |
| **T** · **M** · **L** · **F** · **H** | Discussion timer · sound · Host/Live · fullscreen · hide the Host mode badge |

Voting counts down for 30 seconds (60 for word clouds) and locks by itself at zero. Word-cloud
answers go through the moderator's approval queue before they reach the projector.

## 3. Editing the content: `public/content/en.json`

Every word on the projector, phones and moderator view comes from this file. `stops` lists the
stops in order; each has `place`, `milestone`, `km`, `theme`, `landscape`, the opening `persona`
and `voice` line, `signs` (the two signboards on the ride into it) and its ordered `steps`.

Step types: `showcase` (Stop 1), `question` (`format`: `choose`, `pickn`, `wordcloud`,
`dualcloud`), `reveal` (`text`, optional `takeaway`), `persona`, `infocard`, `pump`, `closing`.
Every step has a `note` for the moderator. Votes are stored by step id and option id, never by
text, so wording can change freely; don't rename ids during a session.

**Placeholders.** Any text that starts with `PLACEHOLDER` is never shown to the audience; the
moderator view lists it in amber on its step. Still to fill:

- Intro: the three facts (`intro.facts`).
- Stop 1: who built each website, how long it took and what it cost (`sites[].builtBy`, `took`, `cost`).
- Insight Out: the link (`link.url`); its QR code appears on the projector once filled.

## 4. Tests

Each test starts its own server, so none of them touches a game you're presenting from.

```bash
npm run test:host       # Host mode, the whole route at 1920×1080 (+ 1366×768, 1280×720)
npm run test:live       # Live: 150 riders, late joiners, reconnects, phones (starts its own wrangler dev)
npm run test:fallback   # kills the Worker mid-step: Host mode, then Return to Live
node tests/run.mjs https://the-ride.<subdomain>.workers.dev <PIN>   # Live run against the deployed Worker
```

Don't run the Live test against the deployed Worker during a session: it resets the game.
Screenshots of every step, every signboard and both phones land in `tests/screenshots/`.

## Project layout

```
public/
  index.html  vote.html  moderator.html  favicon.svg
  content/en.json       the route, settings and all text
  js/route.js           the route as one list of steps; shared by every page and the tests
  js/presenter.js       projector: flow, fuel, countdown, sound, Live/Host, moderator commands
  js/vote.js            phones
  js/moderator.js       moderator view
  js/scenery.js         road band, landscapes, milestones, signboards, bike, persona badges
  js/profanity.js       word-cloud filter (phones and Worker)
  css/  fonts/  img/  vendor/qrcode.js
worker/index.js         Cloudflare Worker + Durable Object (no personal data)
tools/serve.mjs         offline Host-mode server
tests/shots.mjs  tests/run.mjs  tests/fallback.mjs
```

Fonts (SIL Open Font License, bundled): Glacial Indifference, with Lexend as its fallback. All
artwork is original flat SVG. The showcase screenshots were captured from the public sites.
