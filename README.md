# The Ride: Bengaluru to Travancore Palace

A live audience game for a 45-minute talk, in the visual language of the Indian
highway: milestone stones, green signboards, hand-painted roadside boards. A rider
on a retro motorcycle travels ~2,100 km from Bengaluru to Travancore Palace, New
Delhi, through **7 stops**: 11 questions, 7 pitstops and 2 roadside info cards. The people met
on the road (Meera, Lakshmi, Asha, Imran) each bring one question about building technology
well: the right problem, the community, data and privacy, and keeping things running.

- **Fuel** starts at 100% (capped at 100%). A wrong room answer on a scored question
  costs 15%. Pitstops add or remove fuel. The bike always reaches the palace.
- **Languages:** the projector shows English plus the region's language as the bike
  arrives. Phones show everything in the voter's own language (11 languages, plus
  "Other" via AI translation).

| Screen | URL | Who sees it |
|---|---|---|
| Projector | `/` (Live Vote; `/?mode=host` to start offline) | Everyone |
| Phones | `/v` | Each person, in their language |
| **Moderator** | `/moderator` | Only the moderator: answers, talking points, word-cloud queue, timer. **Never on the projector.** |

Two modes: **Live Vote** (the default: phones vote through the Cloudflare Worker) and **Host
Mode** (fully offline; the presenter types in the room's result). If the Live server is silent
for 5 seconds, the projector switches to Host Mode by itself, shows **HOST · Live lost** in
the presenter bar, and keeps going with everything collected so far. When the server answers
again, the bar offers **Return to Live** (or press **L**): the game carries on live from the
same step.

**How the route plays:** a lobby first (big QR code, short URL, a live "riders joined" counter),
then 7 stops. The bike rides, the km flips and the persona is introduced **once per stop**, on
arrival; the steps of a stop (questions, pitstops, info cards) only change the main panel. The
HUD shows "Stop N of 7 · Step X of Y" (plus "Question N of 11" on a question).

| Stop | Steps |
|---|---|
| 1 Bengaluru (0 km) | intro card → viewpoint → Q1 + mirror → viewpoint answers → landslide "The shortcut" |
| 2 Anantapur (215 km) | Q2 → Q3 → petrol pump |
| 3 Adilabad (870 km) | Q4 → Q5 (hurdles) |
| 4 Nagpur · Zero Mile (1,060 km) | Q6 + mirror → tokenization card → Q7 → Insight Out card → checkpost |
| 5 Jhansi · The broken bridge (1,660 km) | Q8 → mechanic → Q9 → chai stall |
| 6 Agra · The travellers meet (1,890 km) | Q10 → petrol pump |
| 7 Travancore Palace (2,100 km) | Q11 (two clouds) → final signboard → mirror: today vs. in 6 months |

---

## 1. Run it

```bash
npm run host          # offline Host Mode only → http://localhost:4321 (next free port if busy)
```

Press **F** for fullscreen. All fonts and images are bundled, so no internet is needed.

**Deploy for the session (Live Vote on a public HTTPS address):**

```bash
npm install
npx wrangler login                           # once, in a browser
npx wrangler secret put ADMIN_PIN            # presenter + moderator PIN (choose a real one)
npx wrangler secret put ANTHROPIC_API_KEY    # optional, for "Other language"
npm run deploy                               # prints https://the-ride.<your-subdomain>.workers.dev
```

Open that `https://…workers.dev/` address on the projector. The QR code and short URL point to
the address the projector was opened from, so phones on mobile data or any Wi-Fi can join. To
pin it (for example a custom domain), set `config.voteUrl` in `content/en.json` and redeploy.
If the projector is opened from a local address (`192.168.…`, `localhost`), the lobby warns
that the link only works on that network.

**Rehearsal on your own network:**

```bash
cp .dev.vars.example .dev.vars        # ADMIN_PIN=1234; add ANTHROPIC_API_KEY=… to try "Other language"
npx wrangler dev --ip 0.0.0.0         # open http://<laptop-LAN-IP>:8787/
```

Use the LAN address, not `localhost`, so the QR code works on phones on the same Wi-Fi.

## 2. Presenter keys

| Key | Action |
|---|---|
| **→ / Space / Enter / PageDown** | Next step (clickers work) |
| **← / PageUp** | Back one step (undoes a reveal, removes its stamp) |
| **R** | Reveal (Live: also closes the vote) |
| **V** | Live: close / reopen voting |
| **T** | Start / stop the discussion timer |
| **W** | Word cloud: add an answer (Host Mode, or a presenter extra in Live). Q11: add to **Build** |
| **N** | Q11 (two clouds): add to **Never** |
| **L** · **H** · **F** | Host/Live mode (also **Return to Live** after a drop) · hide presenter bar · fullscreen |

**Entering the room's result** (Host Mode; in Live Mode these override the votes).
The bottom bar always shows the keys for the current step.

| Format | Keys | Scored as right when… |
|---|---|---|
| `estimate` | nothing, press R | not scored (shows the room's median vs the real answer) |
| `tapstep` | **1–6** = step the room picked | it's the `answer` step |
| `choose` | **A–D** = room's majority | it's the `answer` |
| `checkpoint` | **1–4** = gap the room picked | it's the `answer` gap |
| `pickn` | **1–8** toggle the room's top N, **0** clears | no `decoys` in the room's top N |
| `rank` | type the room's order **1–4**, **0** clears | `firstItem` is first and `lastItem` last on average |
| `match` | **1–4** cycles that item's bucket, **0** clears | every `keyMatch` item's majority bucket is right |
| `wordcloud` | **W** adds an answer | not scored |
| Mirror poll (after Q1, Q6, Q11) | **A–D** = room's pick | never scored, no fuel |
| Hurdle signs (Q5) | **→** shows the next hurdle; voting opens after the last | — |
| Info card | **→** rides on | no vote |
| `dualcloud` | **W** adds to the first cloud (Build), **N** to the second (Never) | not scored |
| Petrol pump | **↑ / ↓** = % saying Yes | fuel + 20% × share of Yes |
| Landslide | **A–C** | fuel −10% if right, −20% if not |
| Checkpost | **A–C** per round (10 s each) | +5% per right round |
| Viewpoint | nothing; R closes each showcase (its answers are shown after Q1, see `revealAfter`) | not scored |
| Mechanic / Chai | → | +5% fuel / 30-second timer |

If you press **R** on a scored step without a result, the game tells you the keys;
press **R** again to reveal anyway (no fuel change).

## 3. Edit the route: `public/content/en.json`

`stops` is the ordered list of the 7 stops. A stop has the place, `km`, `languages` (the regional
language on the projector and the phone road strip), `landscape`, `welcome`, an optional
`milestone` label, the persona (`personaName`, `role`, `orgType`, `voice`, `emblem`), and
`steps`: the ids of its steps, in order. `route` holds the steps themselves, each a
`"kind": "question"`, `"pitstop"`, `"card"` or `"intro"`; a step takes its place, km and persona
from its stop. Edit, save, reload. Redeploy if you use Live Vote.

Votes are stored by **step id** (`q3`, `p4.1` for a checkpost round, `q1.m` for a mirror poll),
never by position or text, so steps can be reordered or reworded freely; don't rename ids during
a session.

A step (older single-list style, shown with the stop fields that now live on the stop):

```jsonc
{ "id": "q3", "kind": "question", "place": "Hyderabad", "km": 570,
  "languages": ["te", "ur"],          // regional language(s) on the projector + phone road strip
  "landscape": "oldcity",             // deccan | oldcity | teak | orange | bundelkhand | yamuna | palace
  "welcome": "Welcome to Hyderabad",  // shown on the milestone, in the regional language
  "personaName": "Farida", "role": "Fundraiser", "orgType": "Handloom weavers' collective",
  "emblem": { "icon": "envelope", "color": "red" },   // the persona's rubber-stamp badge (see below)
  "voice": "…",                       // optional: an italic line on the luggage tag (the persona's first stop)
  "milestone": "Nagpur · Zero Mile",  // optional: replaces the place name on the big milestone and the HUD
  "shift": "Prototypes replace long briefs.",
  "scenario": "…", "question": "…",
  "type": "choose", "options": [{ "id": "A", "text": "…" }, …], "answer": "B",
  "reveal": "…", "moderatorTalkingPoints": ["…"], "scored": true }
```

Fields per format: `estimate` (`periods`, `sliders`, `answer`, `answerText`),
`tapstep` (`steps`, `answer`), `choose` (`options`, `answer`), `checkpoint` (`steps`,
`answer` = `g1`…`g4`, the gap before step 2…5), `pickn` (`n`, `items`, `decoys`),
`rank` (`items`, `firstItem`, `lastItem`), `match` (`buckets`, `items`, `answers`,
`keyMatch`), `wordcloud` (`maxLength`), `dualcloud` (`maxLength`, `parts`: two
`{ "id", "title", "color": "green" | "red", "text" }`, shown as two clouds side by side; the
`reveal` line appears on a final signboard). `choose`, `tapstep`, `checkpoint` and landslide /
checkpost options can also list `almost: ["id", …]`: on the reveal those get a small **ALMOST** tag
instead of fading out (used for the second-best answers of Q3 and Q5). A `choose` question with no
`answer` has no right answer (Q1, Q4, Q9, Q10).

Extras a question can have:
- `hurdles: ["…", "…"]`: hurdle signs that slide in one per **→** before voting opens (Q5).
- `mirror: { id, question, options }`: a poll after the reveal, no right answer, no fuel (Q1, Q6).
  With `"compareWith": "q1"` its reveal shows "Today vs. in 6 months" against that question's
  mirror (Q11). Option ids must match for the comparison.

Info cards: `{ "kind": "card", "title", "text", "rows": [{ "from", "to" }], "link": { "url", "label" } }`,
a roadside board with an optional two-column table and link. No vote, no stamp, no fuel. With an
empty `url` the `label` shows as a note (Insight Out: PLACEHOLDER).

A viewpoint with `"revealAfter": "q1"` collects its answers at its own stop but keeps them hidden
(phones see "voting closed"); they're revealed, one showcase per **→**, after that question's reveal.
A pitstop can have a `title` that replaces its board heading (the landslide is "The shortcut").

Pitstops: `pitType` is `petrol` (`poll`, `fuel.shareYes`), `landslide` (`poll`,
`answer`, `fuel.right/wrong`), `viewpoint` (`polls`, `showcases`), `mechanic` (`tips`,
`fuel.add`), `checkpost` (`options`, `rounds`, `seconds`, `fuel.perRight`), `chai`
(`prompt`, `seconds`). Every pitstop has a `board` line and a `stamp` for the travel log.

Votes are stored by **id**, never by text, so you can reword freely, but don't change
ids during a session.

**Persona emblems** are neutral, object-based stamps (no faces): `icon` is one of `book`,
`wheat`, `envelope`, `speech`, `pugmark`, `stethoscope`, `tools`, `hands`, `needle`,
`milestones`, `braille`, `microphone`, `compass`, `binoculars`, `padlock`, `wrench`; `color` is
`green`, `red` or `yellow`. `{ "group": [badge, …] }` shows several badges together
("Everyone from the road"). Each stamp tilts
a little (−3° to 3°, fixed per question) and has an inked edge.

**Placeholders to fill before the session**

- **Viewpoint showcases** (`p1.showcases[].answers`, `note`): the real answers for Hakki and
  Holématthi. Answers use the poll option ids, e.g. `{ "who": "nocode", "time": "weekend",
  "cost": "free" }`. The `note` shows on the reveal, so delete it once filled.
- **Insight Out link** (`c2.link.url`): the programme link; replace the PLACEHOLDER label too.
- **Q9** talking point: the real Tech4Good story for the moderator.

## 4. Languages

Phone languages: English, Hindi, Kannada, Telugu, Marathi, Urdu (right-to-left),
Ladakhi, Nepali, Assamese, Bengali, Tamil, plus **Other language** (AI translation).
Translations live in `public/content/<code>.json` (`hi kn te mr ur lad ne as bn ta`),
with the same keys as the English text.

**Every translation is a first draft marked `"reviewed": false`.** Ladakhi in
particular needs a full native-speaker review.

```bash
npm run check-translations             # missing, empty or extra keys, lost {placeholders}, review status
npm run check-translations -- --sync   # after editing English: add new keys (empty) to every file
npm run check-translations -- --review # list every key in "needsReview" (English changed since the last review)
```

**To review a language:** correct its file, keep keys and `{n}`-style placeholders as they
are, then set `"reviewed": true`. Empty strings fall back to English.

**To add a language:** `npm run check-translations -- --new gu "Gujarati" "ગુજરાતી"`, add it
to `LANGUAGES` in `public/js/i18n.js`, and if it uses a new script add its Noto font to
`tools/build-fonts.mjs` and run `npm run build-fonts`.

**Projector:** regional lines alternate every `regionalAlternateSeconds` (6) when a stop has
two languages. The final question cycles through `finalCycleLanguages` every
`finalCycleSeconds` (4). Both settings are in `en.json` → `config`.

**Other language:** a voter types a language name; the Worker translates the current
step with Claude (the key is a Worker secret, never sent to the browser). Phones show
"AI-translated, not checked", or English with a note if translation fails. **To
switch it off,** set `"otherLanguageAI": false` in `en.json` and redeploy. The default
model is `claude-opus-5-5`; set a `TRANSLATE_MODEL` Worker variable (e.g.
`claude-haiku-5-5`) to make it cheaper.

## 5. Word clouds (Q2, Q11): approving entries

Q2 is a plain word cloud. Q11 is a two-part question (`dualcloud`): **Build** (green, "one thing
you'll explore differently in your own work after this journey") and **Never** (red, "one thing AI
should never do in your work").
Each phone gets two short text boxes (up to 40 characters each, either can be blank) and one
Submit button: one answer per part per phone. Both parts go through the same moderator queue,
and each entry carries a **BUILD** / **NEVER** tag. A plain `wordcloud` question takes up to 3
answers per phone. A profanity filter
(English and romanised/Devanagari Hindi) rejects rude ones on the phone and on the
server. Everything else waits in the **moderator view → Word cloud queue**. Tap
**Approve** to put it on the projector, **Reject** to drop it, or **Remove** to take an
approved word down. Repeated answers grow larger. In Host Mode the presenter adds
answers with **W** (Build) and **N** (Never), and they need no approval.

While answers are arriving, the projector shows a split-flap "answers in" counter, faint
ghost outlines where answers will appear, and (for clouds) a road being paved. On the reveal
both clouds settle and the final signboard appears ("Technology is not the destination. The
people and communities we serve are."), then the mirror poll compares today with 6 months.

## 6. Moderator view

Open `/moderator` on a phone (needs Live Vote deployed, asks for the PIN) or in a
second window on the presenter's laptop (follows the projector directly, even
offline). It shows the answer, reveal, talking points, pitstop rules and answers,
the word-cloud queue, and a timer. A timer started there shows on the projector at
pitstops; on questions only the moderator sees it.

## 7. Before the session: reset checklist

1. Fill the placeholders (section 3) and get translations reviewed (section 4).
2. Open the projector in Chrome at the public address (`https://…workers.dev/`) and click
   **Reset** in the bottom bar (PIN). This clears all answers, words, fuel and stamps and returns
   to the lobby. The lobby's "riders joined" counter shows phones as they connect.
3. Open `/moderator` on your phone (not on the projector).
4. Scan the QR code with your own phone: you should see the language picker.
5. Press **F** for fullscreen, **H** to hide the bar, → (or **Start**) when everyone's in.
   Host Mode takes over by itself if the connection drops (see the top of this file).
6. If a vote has fewer than 10 answers after 45 seconds, the presenter bar suggests entering
   the room's result by hand (show of hands) with the Host Mode keys.

## 8. Accessibility

The game teaches accessibility, so it practises it:

- **Contrast:** every text/background pair in the palette is ≥ 4.5:1 (checked by the tests).
- **Size:** question text is 46px on the projector and never shrinks below 40px. Long
  answers shrink, the question never does.
- **Phone controls:** native buttons, radios, sliders and labels, all ≥ 48px tall (answer
  signs ≥ 64px), with a polite live region announcing each change. Ranking can be done by
  tapping, dragging a handle, the ▲ / ▼ buttons, or the arrow keys on a handle.
- **No meaning by colour alone:** every result has a text label ("✓ Right route",
  "Almost", "Room's pick", "✗ Decoy", percentages), and options that fade out on the reveal
  also get a struck-through arrow.
- **`lang` and `dir`:** set on all translated text, so screen readers switch voice and Urdu
  reads right to left.
- **Reduced motion:** with prefers-reduced-motion on, rides, flips and stamps happen
  without animation.

## 9. Tests

```bash
npm run host && node tests/shots.mjs     # offline Host Mode: the whole route by keyboard
npm run dev  && npm test                 # Live Vote end to end (on its own wrangler dev, not a shared one)
node tests/fallback.mjs                  # kills its own wrangler dev mid-step: Host Mode, then Return to Live
npm run check-translations
```

Never run `npm test` against the server you're presenting from: it resets the game and votes
with 150 simulated phones. Give it its own server, e.g.
`npx wrangler dev --port 8788 --persist-to /tmp/ride-test` and `node tests/run.mjs http://127.0.0.1:8788`.

`tests/shots.mjs`: a forward walk of all 7 stops and 21 steps that checks every screen appears
exactly once and in order, each stop arrives once and the km only increases, the viewpoint
answers wait for Q1, Q5's hurdles come one per Next, fuel changes only on the 5 scored questions
and pitstops, the moderator notes match every screen, and the rider is fully visible on every
screen at 1920×1080, 1366×768 and 1280×720 (one screenshot per arrival and step).

`npm test`:
- Checks the palette contrast.
- Starts in the lobby (QR, riders-joined counter), then runs 150 simulated voters in 8 languages
  plus real Urdu and Ladakhi phone pages through every step, checking the counts (by step id) and
  the fuel. 30 phones join late and land on the current step; 20 drop and reconnect; the Urdu
  phone goes offline, shows "Reconnecting…", and rejoins with the same voter id.
- Q11: counted per question (phones that answered Q2 count again), and the queue holds only Q11
  entries (Q2's unhandled answers expire when the route moves on).
- Tests the word-cloud profanity filter and moderator approval.
- Renders all 11 languages on a phone with axe accessibility checks, the script font
  check, the direction check and the 48px target check.
- Renders the projector with every language as the regional line (no overflow,
  question ≥ 40px), plus the 6-second alternation and the 4-second final cycle.
- Finishes with the automatic fallback to Host Mode and **Return to Live** at the same step.

## Project layout

```
public/
  index.html  vote.html  moderator.html
  content/en.json            the route, settings and English text
  content/<code>.json        translations (same keys)
  js/presenter.js            projector: route, formats, fuel, stamps, Live/Host, timer
  js/scenery.js              road band, landscapes, milestones, bike layer, persona emblems, pitstop art
  js/vote.js                 phones: every format, language picker, road strip, AI translation fallback
  js/moderator.js            moderator notes, word-cloud queue, timer
  js/i18n.js                 shared language helpers (pages, Worker, tools)
  js/profanity.js            word-cloud filter (phones + Worker)
  css/ fonts/ img/ vendor/
worker/index.js              Cloudflare Worker + Durable Object
tools/serve.mjs  tools/check-translations.mjs  tools/build-fonts.mjs
tests/run.mjs  tests/shots.mjs
```

Fonts (SIL Open Font License, bundled): Barlow Condensed (signage), Kalam (hand-painted
boards), Atkinson Hyperlegible (body), Noto Sans Devanagari / Telugu / Kannada / Bengali /
Tamil, Noto Serif Tibetan, Noto Nastaliq Urdu. All artwork is original flat SVG with no
logos, brands or maps. The showcase screenshots were captured from the public sites.
