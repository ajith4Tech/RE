// The route, shared by the projector, the phones, the moderator view and the tests.
// content/en.json holds 4 stops plus the arrival, each with ordered steps. flatten() turns that into
// one list (the intro first, then every step in order) with each step knowing its stop.

/** A value still waiting for real content: empty, or text starting with "PLACEHOLDER". */
export const isPlaceholder = (v) => v == null || (typeof v === "string" && (!v.trim() || /^\s*PLACEHOLDER\b/i.test(v)));
export const filled = (v) => !isPlaceholder(v);

/** "Question {n} of {total}" + { n: 3, total: 7 } → "Question 3 of 7" */
export function fmt(str, vars = {}) {
  return String(str ?? "").replace(/\{(\w+)\}/g, (_, k) => (k in vars ? vars[k] : ""));
}

export const isQuestion = (s) => s?.type === "showcase" || s?.type === "question";
/** Steps the phones vote on: the seven questions and the two petrol-pump pulses. */
export const isVote = (s) => isQuestion(s) || s?.type === "pump";
export const isCloud = (s) => s?.format === "wordcloud" || s?.format === "dualcloud";

/** The screens inside one step, in order. The arrival ("arrive") comes before a stop's first step. */
export function phasesOf(s) {
  if (s.type === "showcase") return ["showcase", "ask", "locked", "reveal"];
  if (s.type === "question" || s.type === "pump") return ["ask", "locked"];
  return ["show"];
}

/** Every step in order: the intro (stop -1), then each stop's steps. */
export function flatten(c) {
  const out = [{ ...c.intro, stopIndex: -1, stepIndex: 0, stepCount: 1 }];
  c.stops.forEach((stop, si) => {
    stop.steps.forEach((s, k) => out.push({ ...(s.type === "pump" ? { format: "choose" } : {}), ...s, stopId: stop.id, stopIndex: si, stepIndex: k, stepCount: stop.steps.length }));
  });
  let q = 0;
  for (const s of out) if (isQuestion(s)) s.qn = ++q;
  for (const s of out) if (isQuestion(s)) s.qTotal = q;
  return out;
}

/** "Stop 2 of 4" counts the four stops; the last stop is the arrival. */
export const stopTotal = (c) => c.stops.filter((s) => !s.arrival).length;

/** The voting choices for a step (options or pick-n items). */
export const choicesOf = (s) => s?.options || s?.items || [];

export const personaOf = (c, s) => (s?.persona ? { id: s.persona, ...c.personas[s.persona] } : null);

/** The milestone label split in two: "Nagpur · Zero Mile, the centre of India" → ["Nagpur", "Zero Mile, the centre of India"]. */
export function milestoneParts(stop) {
  const [head, ...rest] = String(stop.milestone || stop.place).split(" · ");
  return [head, rest.join(" · ")];
}

/** The label for the moderator's main button: a specific verb for what happens next. */
export function nextLabel(c, steps, i, phase) {
  const s = steps[i];
  if (phase === "lobby") return c.lobby.button;
  if (phase === "ask") return "Lock votes";
  if (phase === "showcase") return "Ask the room";
  if (phase === "locked" && s.type === "showcase") return "Reveal";
  if (phase === "arrive") return verbFor(c, s);
  if (s.type === "intro") return c.intro.button;
  const nx = steps[i + 1];
  if (!nx) return "The ride is over";
  if (nx.stopIndex !== s.stopIndex) return "Ride on";
  return verbFor(c, nx);
}
function verbFor(c, s) {
  switch (s.type) {
    case "showcase": return "Show the websites";
    case "question": return "Ask the room";
    case "reveal": return "Reveal";
    case "persona": return `Meet ${c.personas[s.persona]?.name || "the next rider"}`;
    case "infocard": return "Show the card";
    case "pump": return "Pull in to refuel";
    case "closing": return "Close the ride";
  }
  return "Ride on";
}

/** Text still to be filled in for a step, for the moderator view: [{ what, text }]. */
export function placeholdersOf(s) {
  const out = [];
  const check = (what, v) => isPlaceholder(v) && out.push({ what, text: String(v ?? "(empty)") });
  if (!s) return out;
  if (s.type === "intro") (s.facts || []).forEach((f, k) => check(`Fact ${k + 1}`, f));
  if (s.type === "showcase")
    for (const site of s.sites || []) {
      check(`${site.title}: built by`, site.builtBy);
      check(`${site.title}: time taken`, site.took);
      check(`${site.title}: cost`, site.cost);
    }
  if (s.link) check("Link and QR code", s.link.url);
  return out;
}
