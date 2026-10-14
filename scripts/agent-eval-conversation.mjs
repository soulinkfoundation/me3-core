// Conversation-only turns: no owner records, actions or web search are needed.
// They measure the fast route's quality and that routing keeps these turns tool-free.
const turn = (prompt) => ({ prompt, calls: [] });
const noTools = (_seed, results) => results.length === 0;

export function createConversationEvalScenarios() {
  return [
    { id: "conversation/brainstorm-workshop-names", turns: [turn("Brainstorm five names for a weekend breathwork workshop for beginners.")],
      rubric: "Give five distinct, fitting workshop names directly. No tools, no claims about saving or scheduling anything." },
    { id: "conversation/newsletter-subject-lines", turns: [turn("My newsletter this month is about slowing down in autumn and a new Tuesday evening class. Suggest four subject lines.")],
      rubric: "Offer four short subject lines grounded in the supplied topics. Do not claim to have sent or drafted an email." },
    { id: "conversation/explain-coach-vs-mentor", turns: [turn("In two short paragraphs, what's the difference between a coach and a mentor?")],
      rubric: "Explain the difference clearly in about two short paragraphs. No tools." },
    { id: "conversation/rewrite-warmer", turns: [turn("Rewrite this more warmly: \"Your session is confirmed for Thursday. Late cancellations are charged in full.\"")],
      rubric: "Rewrite the supplied text more warmly while keeping both facts (Thursday confirmation, late-cancellation charge). Do not invent new details." },
    { id: "conversation/pricing-advice", turns: [turn("How should I think about pricing a package of six one-to-one coaching sessions? Keep it brief.")],
      rubric: "Give brief, practical pricing considerations. Do not invent the owner's current prices or claim to read their records." },
    { id: "conversation/summarise-notes", turns: [turn("Summarise these notes in three bullets: client wants weekly check-ins, struggles with mornings, goal is a 5k by March, prefers voice notes over email.")],
      rubric: "Return exactly three accurate bullets covering the supplied notes. Add nothing that was not in the notes." },
    { id: "conversation/retreat-post-ideas", turns: [turn("Give me three ideas for social posts about my spring retreat. Ideas only, I'll write them myself.")],
      rubric: "Give three distinct post ideas, not finished posts. Do not claim to publish or schedule anything." },
    { id: "conversation/thanks", turns: [turn("Thanks, that was really helpful!")],
      rubric: "Reply briefly and warmly. No tools, no unprompted actions." },
    { id: "conversation/decline-discount", turns: [turn("Give me a gentle way to say no to a client who keeps asking for a discount.")],
      rubric: "Offer a short, kind, firm wording the owner can use. Do not claim to have sent a message." },
    { id: "conversation/follow-up-shorter", turns: [
      turn("Suggest three taglines for a mindful running club."),
      turn("Make the second one shorter."),
    ], rubric: "Turn 2 must shorten the second tagline from turn 1, using the conversation itself. No tools in either turn." },
  ].map(scenario => ({ ...scenario, suite: "conversation", evaluationKind: "candidate-quality", allowedWrites: {}, check: noTools }));
}
