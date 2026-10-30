// Judge adaptation. Each profile tells Claude how to write for that kind of judge.
// Sources: PF judge-adaptation guides (Atlanta UDL, DebateDrills, Defining Debate, PFOnline, DebateUS), NSDA judging guides.
'use strict';

const JUDGES = {
  lay: {
    name: 'Lay judge (parent / community volunteer)',
    write: `JUDGE: LAY (a parent or community volunteer who decides on clarity, persuasion and who seems more confident; may not keep a flow).
- Plain everyday words. Swap jargon for what it means: "uniqueness" -> "right now", "link" -> "because", "impact" -> "what that leads to", "turn" -> "their argument actually helps us", "dropped" -> "they never answered".
- One clear story per argument: cause, effect, who gets hurt. Concrete people, places and numbers beat abstractions.
- Focus on the main clash, not technicalities. Sound sure you're winning; never sound defensive.`,
  },
  flay: {
    name: 'Flay judge (keeps a flow, wants it conversational)',
    write: `JUDGE: FLAY (keeps a flow and notices dropped arguments, but wants a conversational pace and explained reasoning: often a former debater from another event, a college student or a newer coach).
- Signpost clearly ("On their deterrence argument...") and keep debate terms, but explain each one in a few words the first time.
- Every claim gets its reason. Weighing is explicit and compared directly.
- Collapse to the arguments that decide the round.`,
  },
  tech: {
    name: 'Tech judge (circuit / flow, tech over truth)',
    write: `JUDGE: TECH (former circuit debater or coach; flows everything, tech over truth, rewards clean extensions, conceded arguments and comparative weighing).
- Debate shorthand is fine: uniqueness, link, impact, turn, delink, NU, prereq, short-circuit, conceded, extend.
- Be efficient: name the argument, the warrant and the card. Point out concessions directly ("they conceded X, so Y is true").
- Weighing compares mechanisms; meta-weigh when both teams weigh differently.`,
  },
  mixed: {
    name: 'Mixed panel (lay + tech)',
    write: `JUDGE: MIXED PANEL (at least one lay and one tech judge).
- Write so a parent understands every sentence in plain words, while keeping the structure a tech judge flows: argument name, warrant, card, impact, weighing.
- Light jargon only when it's explained in the same sentence.`,
  },
};

function judgeBlock(key) { return (JUDGES[key] || JUDGES.mixed).write; }

module.exports = { JUDGES, judgeBlock };
