import Anthropic from "npm:@anthropic-ai/sdk@0.39.0";
import { createClientFromRequest } from "npm:@base44/sdk@0.8.25";

const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });

const PERSONAS = [
  {
    name: "Marie Dubois",
    geo: "France",
    language: "fr",
    referralSource: "organic",
    landingPage: "/blog/pci-dss-compliance",
    pagesViewed: ["/blog/pci-dss-compliance", "/plans"],
    personality: "HIGH_INTENT",
    concern: "PCI_COMPLIANCE",
    buyScore: 8,
  },
  {
    name: "James Mitchell",
    geo: "United States",
    language: "en",
    referralSource: "competitor-campaign",
    landingPage: "/reflectiz-vs-source-defense",
    pagesViewed: ["/reflectiz-vs-source-defense", "/product"],
    personality: "EVALUATOR",
    concern: "TOOL_EVALUATION",
    buyScore: 7,
  },
  {
    name: "Sarah Chen",
    geo: "United Kingdom",
    language: "en",
    referralSource: "organic",
    landingPage: "/blog/magecart-attack",
    pagesViewed: ["/blog/magecart-attack"],
    personality: "CURIOUS",
    concern: "MAGECART",
    buyScore: 5,
  },
  {
    name: "Klaus Weber",
    geo: "Germany",
    language: "de",
    referralSource: "organic",
    landingPage: "/blog/gdpr-pixel-tracking",
    pagesViewed: ["/blog/gdpr-pixel-tracking", "/use-cases/privacy"],
    personality: "RESEARCHER",
    concern: "PRIVACY_GDPR",
    buyScore: 4,
  },
  {
    name: "Yossi Ben-David",
    geo: "Israel",
    language: "en",
    referralSource: "direct",
    landingPage: "/product",
    pagesViewed: ["/product", "/customers"],
    personality: "HIGH_INTENT",
    concern: "TOOL_EVALUATION",
    buyScore: 9,
  },
  {
    name: "Carlos Ruiz",
    geo: "Spain",
    language: "es",
    referralSource: "organic",
    landingPage: "/use-cases/magecart-prevention",
    pagesViewed: ["/use-cases/magecart-prevention"],
    personality: "CURIOUS",
    concern: "MAGECART",
    buyScore: 6,
  },
  {
    name: "Mike Davidson",
    geo: "United States",
    language: "en",
    referralSource: "organic",
    landingPage: "/blog/supply-chain-attacks",
    pagesViewed: ["/blog/supply-chain-attacks"],
    personality: "SKEPTICAL",
    concern: "SUPPLY_CHAIN",
    buyScore: 3,
  },
  {
    name: "Emma van der Berg",
    geo: "Netherlands",
    language: "en",
    referralSource: "organic",
    landingPage: "/blog/pci-dss-compliance",
    pagesViewed: ["/blog/pci-dss-compliance", "/use-cases/pci-compliance"],
    personality: "HIGH_INTENT",
    concern: "PCI_COMPLIANCE",
    buyScore: 8,
  },
  {
    name: "Tom Reynolds",
    geo: "Australia",
    language: "en",
    referralSource: "organic",
    landingPage: "/",
    pagesViewed: ["/"],
    personality: "RESEARCHER",
    concern: "GENERAL_AWARENESS",
    buyScore: 4,
  },
  {
    name: "Anonymous",
    geo: "United States",
    language: "en",
    referralSource: "organic",
    landingPage: "/",
    pagesViewed: ["/"],
    personality: "BOUNCER",
    concern: "GENERAL_AWARENESS",
    buyScore: 1,
  },
];

const TURNS_BY_PERSONALITY = {
  BOUNCER: 0,
  RUSHED: 2,
  SKEPTICAL: 3,
  CURIOUS: 3,
  RESEARCHER: 4,
  EVALUATOR: 4,
  HIGH_INTENT: 3,
};

const CONCERN_TO_INTENT = {
  PCI_COMPLIANCE: "PCI_COMPLIANCE",
  MAGECART: "MAGECART_PREVENTION",
  PRIVACY_GDPR: "PRIVACY_GDPR",
  SUPPLY_CHAIN: "SUPPLY_CHAIN",
  TOOL_EVALUATION: "TOOL_EVALUATION",
  GENERAL_AWARENESS: "GENERAL_AWARENESS",
};

async function callReflectizAgent(base44, payload) {
  const res = await base44.functions.invoke("reflectizAgent", payload);
  return res.data;
}

async function generateVisitorMessage(persona, agentMessage) {
  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 150,
    messages: [{
      role: "user",
      content: `You are roleplaying as a website visitor with this profile:
Name: ${persona.name}
Personality: ${persona.personality}
Primary concern: ${persona.concern}
Buy likelihood score: ${persona.buyScore} out of 10

The chat agent just said: ${agentMessage}

Generate a realistic single response this visitor would send. Follow these personality rules:
- SKEPTICAL: challenge the claim, ask for proof, express doubt
- CURIOUS: ask a genuine follow-up question about something specific the agent mentioned
- HIGH_INTENT: mention a specific deadline, team pressure, or urgent pain point
- RESEARCHER: ask a broad strategic question, want to understand the full picture
- RUSHED: respond in 5 words or less, want the bottom line
- EVALUATOR: ask how this compares to alternatives, want specifics
- BOUNCER: respond with nothing or a single word like 'ok' then stop

Be realistic. Real visitors are distracted, imprecise, and sometimes go off topic. Do not be a perfect customer.

Respond with ONLY the visitor's message, nothing else.`,
    }],
  });
  return response.content[0]?.text?.trim() ?? "";
}

function determineOutcome(persona, turns, finalAgentMessage) {
  if (persona.personality === "BOUNCER") return "BOUNCED";
  const hasCTA = /reflectiz\.com\/contact|book.*time|meeting|trial|demo/i.test(finalAgentMessage);
  if (hasCTA && persona.buyScore >= 6) return "CONVERTED";
  if (turns >= 3) return "ENGAGED";
  return "DROPPED";
}

async function simulatePersona(base44, persona) {
  const sessionId = crypto.randomUUID();
  const maxTurns = TURNS_BY_PERSONALITY[persona.personality] ?? 3;
  const transcript = [];
  let conversationHistory = [];
  let lastAgentMessage = "";
  let turnCount = 0;

  // INIT call — get opening message
  const initResult = await callReflectizAgent(base44, {
    message: "INIT",
    currentPageUrl: `https://www.reflectiz.com${persona.landingPage}`,
    sessionId,
    geo: persona.geo,
    language: persona.language,
    referralSource: persona.referralSource,
    pagesViewed: persona.pagesViewed,
    messages: [],
  });

  lastAgentMessage = initResult.reply ?? "";
  transcript.push(`Agent: ${lastAgentMessage}`);
  conversationHistory.push({ role: "assistant", content: lastAgentMessage });

  // Follow-up turns
  for (let i = 0; i < maxTurns; i++) {
    const visitorMsg = await generateVisitorMessage(persona, lastAgentMessage);
    transcript.push(`Visitor: ${visitorMsg}`);
    conversationHistory.push({ role: "user", content: visitorMsg });
    turnCount++;

    const agentResult = await callReflectizAgent(base44, {
      message: visitorMsg,
      currentPageUrl: `https://www.reflectiz.com${persona.landingPage}`,
      sessionId,
      geo: persona.geo,
      language: persona.language,
      referralSource: persona.referralSource,
      pagesViewed: persona.pagesViewed,
      messages: conversationHistory,
    });

    lastAgentMessage = agentResult.reply ?? "";
    transcript.push(`Agent: ${lastAgentMessage}`);
    conversationHistory.push({ role: "assistant", content: lastAgentMessage });
  }

  const outcome = determineOutcome(persona, turnCount, lastAgentMessage);
  const ctaReached = /reflectiz\.com\/contact|book.*time|meeting|trial|demo/i.test(lastAgentMessage);

  await base44.asServiceRole.entities.Conversations.create({
    sessionId,
    timestamp: new Date().toISOString(),
    geo: persona.geo,
    language: persona.language,
    referralSource: persona.referralSource,
    pagesViewed: persona.pagesViewed.join(","),
    intentClassification: CONCERN_TO_INTENT[persona.concern] ?? "GENERAL_AWARENESS",
    conversationTranscript: transcript.join("\n\n"),
    ctaReached,
    conversationTurns: turnCount,
    conversationOutcome: outcome,
    isTrainingData: true,
    lastMessageRole: "assistant",
  });

  return {
    name: persona.name,
    geo: persona.geo,
    personality: persona.personality,
    outcome,
    turns: turnCount,
    ctaReached,
    reachedPhase2: turnCount >= 1,
    reachedPhase3: ctaReached,
  };
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  // Simulate all personas sequentially to avoid rate limits
  const results = [];
  for (const persona of PERSONAS) {
    const result = await simulatePersona(base44, persona);
    results.push(result);
  }

  // Build summary
  const outcomeCounts = { CONVERTED: 0, ENGAGED: 0, DROPPED: 0, BOUNCED: 0 };
  const geoCounts = {};
  const failedPhases = [];

  for (const r of results) {
    outcomeCounts[r.outcome] = (outcomeCounts[r.outcome] || 0) + 1;
    geoCounts[r.geo] = (geoCounts[r.geo] || 0) + 1;
    if (!r.reachedPhase2 || !r.reachedPhase3) {
      failedPhases.push({ name: r.name, reachedPhase2: r.reachedPhase2, reachedPhase3: r.reachedPhase3 });
    }
  }

  const conversionRate = Math.round((outcomeCounts.CONVERTED / PERSONAS.length) * 1000) / 10;

  return Response.json({
    totalPersonasSimulated: PERSONAS.length,
    conversionRate,
    outcomeBreakdown: outcomeCounts,
    geoBreakdown: geoCounts,
    failedToReachPhase: failedPhases,
    results,
  });
});