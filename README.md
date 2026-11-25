# The Ride: Bengaluru to Travancore Palace

A live audience game for a 45-minute talk, in the visual language of the Indian
highway: milestone stones, green signboards, hand-painted roadside boards. A rider
on a retro motorcycle travels ~2,100 km from Bengaluru to Travancore Palace, New
Delhi, through **10 questions** and **7 pitstops**. Each question shows a "shift":
one way that building technology has changed.

- **Fuel** starts at 100% (capped at 100%). A wrong room answer on a scored question
  costs 15%. Pitstops add or remove fuel. The bike always reaches the palace.
- **Languages:** the projector shows English plus the region's language as the bike
  arrives. Phones show everything in the voter's own language (11 languages, plus
  "Other" via AI translation).

| Screen | URL | Who sees it |
|---|---|---|
| Projector | `/` (`/?mode=live` for Live Vote) | Everyone |
| Phones | `/v` | Each person, in their language |
| **Moderator** | `/moderator` | Only the moderator: answers, talking points, word-cloud queue, timer. **Never on the projector.** |

Two modes: **Host Mode** (default, fully offline; the presenter types in the room's
result) and **Live Vote** (phones vote through the Cloudflare Worker). If the backend
drops, the projector switches to Host Mode by itself within ~6 seconds and keeps
everything collected so far.

---

## 1. Run it

```bash
npm run host          # offline Host Mode → http://localhost:4321 (next free port if busy)
```

Press **F** for fullscreen. All fonts and images are bundled, so no internet is needed.

**Live Vote, rehearsal on your network:**

```bash
cp .dev.vars.example .dev.vars        # ADMIN_PIN=1234; add ANTHROPIC_API_KEY=… to try "Other language"
npx wrangler dev --ip 0.0.0.0         # open http://<laptop-LAN-IP>:8787/?mode=live
```

Use the LAN address, not `localhost`, so the QR code works on phones.

**Deploy for the session:**

```bash
npm install
npx wrangler login
npx wrangler secret put ADMIN_PIN            # presenter + moderator PIN
npx wrangler secret put ANTHROPIC_API_KEY    # optional, for "Other language"
npm run deploy
```

## 2. Presenter keys

| Key | Action |
|---|---|
| **→ / Space / Enter / PageDown** | Next step (clickers work) |
| **← / PageUp** | Back one step (undoes a reveal, removes its stamp) |
| **R** | Reveal (Live: also closes the vote) |
| **V** | Live: close / reopen voting |
| **T** | Start / stop the discussion timer |
| **W** | Word cloud: add an answer (Host Mode, or a presenter extra in Live) |
| **L** · **H** · **F** | Host/Live mode · hide presenter bar · fullscreen |

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
| Petrol pump | **↑ / ↓** = % saying Yes | fuel + 20% × share of Yes |
| Landslide | **A–C** | fuel −10% if right, −20% if not |
| Checkpost | **A–C** per round (10 s each) | +5% per right round |
| Viewpoint | nothing; R reveals each showcase | not scored |
| Mechanic / Chai | → | +5% fuel / 30-second timer |

If you press **R** on a scored step without a result, the game tells you the keys;
press **R** again to reveal anyway (no fuel change).

## 3. Edit the route: `public/content/en.json`

`route` is one ordered list. Each item is a `"kind": "question"` or `"kind": "pitstop"`.
Edit, save, reload. Redeploy if you use Live Vote.

```jsonc
{ "id": "q3", "kind": "question", "place": "Hyderabad", "km": 570,
  "languages": ["te", "ur"],          // regional language(s) on the projector + phone road strip
  "landscape": "oldcity",             // deccan | oldcity | teak | orange | bundelkhand | yamuna | palace
  "welcome": "Welcome to Hyderabad",  // shown on the milestone, in the regional language
  "personaName": "Farida", "role": "Fundraiser", "orgType": "Handloom weavers' collective",
  "portrait": { "skin": "#A8714A", "hair": "covered", "hairColor": "#B5462B", "top": "#F2C230", "extra": "glasses" },
  "shift": "Prototypes replace long briefs.",
  "scenario": "…", "question": "…",
  "type": "choose", "options": [{ "id": "A", "text": "…" }, …], "answer": "B",
  "reveal": "…", "moderatorTalkingPoints": ["…"], "scored": true }
```

Fields per format: `estimate` (`periods`, `sliders`, `answer`, `answerText`),
`tapstep` (`steps`, `answer`), `choose` (`options`, `answer`), `checkpoint` (`steps`,
`answer` = `g1`…`g4`, the gap before step 2…5), `pickn` (`n`, `items`, `decoys`),
`rank` (`items`, `firstItem`, `lastItem`), `match` (`buckets`, `items`, `answers`,
`keyMatch`), `wordcloud` (`maxLength`).

Pitstops: `pitType` is `petrol` (`poll`, `fuel.shareYes`), `landslide` (`poll`,
`answer`, `fuel.right/wrong`), `viewpoint` (`polls`, `showcases`), `mechanic` (`tips`,
`fuel.add`), `checkpost` (`options`, `rounds`, `seconds`, `fuel.perRight`), `chai`
(`prompt`, `seconds`). Every pitstop has a `board` line and a `stamp` for the travel log.

Votes are stored by **id**, never by text, so you can reword freely, but don't change
ids during a session. Portrait options: `hair` long/short/covered/dupatta/bun/cap/curly/bald;
`extra` glasses, beard, moustache, white-moustache, stubble, earrings, bindi, nosering;
or `{ "group": true }`.

**Placeholders to fill before the session**

- **Q1** `answer` / `answerText`: real Tech4Good "then and now" figures (and remove `placeholder`).
- **Viewpoint showcases** (`p3.showcases[].answers`, `note`): the real answers for Hakki and
  Holématthi, and a third Tech4Good example: add `title`, `url`, and a screenshot in
  `public/img/` as `image`, or delete that showcase. Answers use the poll option ids, e.g.
  `{ "who": "nocode", "time": "weekend", "cost": "free" }`. The `note` shows on the reveal,
  so delete it once filled.
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

## 5. Word cloud (Q10): approving entries

Phones send short answers (up to 40 characters, 3 per phone). A profanity filter
(English and romanised/Devanagari Hindi) rejects rude ones on the phone and on the
server. Everything else waits in the **moderator view → Word cloud queue**. Tap
**Approve** to put it on the projector, **Reject** to drop it, or **Remove** to take an
approved word down. Repeated answers grow larger. In Host Mode the presenter adds
answers with **W**, and they need no approval.

## 6. Moderator view

Open `/moderator` on a phone (needs Live Vote deployed, asks for the PIN) or in a
second window on the presenter's laptop (follows the projector directly, even
offline). It shows the answer, reveal, talking points, pitstop rules and answers,
the word-cloud queue, and a timer. A timer started there shows on the projector at
pitstops; on questions only the moderator sees it.

## 7. Before the session: reset checklist

1. Fill the placeholders (section 3) and get translations reviewed (section 4).
2. Open the projector in Chrome (`/?mode=live`) and click **Reset** in the bottom bar
   (PIN). This clears all answers, words, fuel and stamps and puts the bike at Bengaluru.
3. Open `/moderator` on your phone (not on the projector).
4. Scan the QR code with your own phone: you should see the language picker.
5. Press **F** for fullscreen, **H** to hide the bar. Keep Host Mode as backup (**L**).

## 8. Accessibility

The game teaches accessibility, so it practises it:

- **Contrast:** every text/background pair in the palette is ≥ 4.5:1 (checked by the tests).
- **Size:** question text is 46px on the projector and never shrinks below 40px. Long
  answers shrink, the question never does.
- **Phone controls:** native buttons, radios, sliders and labels, all ≥ 48px tall, with a polite live
  region announcing each change.
- **No meaning by colour alone:** every result has a text label ("✓ Right way",
  "Room's pick", "✗ Decoy", percentages).
- **`lang` and `dir`:** set on all translated text, so screen readers switch voice and Urdu
  reads right to left.
- **Reduced motion:** with prefers-reduced-motion on, rides, flips and stamps happen
  without animation.

## 9. Tests

```bash
npm run host && node tests/shots.mjs     # offline Host Mode: whole route by keyboard, moderator, timer
npm run dev  && npm test                 # Live Vote end to end (on its own wrangler dev, not a shared one)
npm run check-translations
```

`npm test`:
- Checks the palette contrast.
- Runs 150 simulated voters in 8 languages plus real Urdu and Ladakhi phone pages through every format and every
  pitstop, checking the counts and the fuel after each item.
- Tests the word-cloud profanity filter and moderator approval.
- Renders all 11 languages on a phone with axe accessibility checks, the script font
  check, the direction check and the 48px target check.
- Renders the projector with every language as the regional line (no overflow,
  question ≥ 40px), plus the 6-second alternation and the 4-second final cycle.
- Finishes with the automatic fallback to Host Mode.

## Project layout

```
public/
  index.html  vote.html  moderator.html
  content/en.json            the route, settings and English text
  content/<code>.json        translations (same keys)
  js/presenter.js            projector: route, formats, fuel, stamps, Live/Host, timer
  js/scenery.js              road band, landscapes, milestones, bike, portraits, pitstop art
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
