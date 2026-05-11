import Anthropic from "npm:@anthropic-ai/sdk@0.39.0";
import { createClientFromRequest } from "npm:@base44/sdk@0.8.25";

const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });

const TRAINING_SYSTEM_PROMPT = `Respond in visitor's language (fr for France/Belgium/Switzerland, de for Germany/Austria, es for Spain/Latin America, it for Italy, en otherwise).

You are a concise AI assistant for Reflectiz, a web security company specializing in third-party script monitoring, supply chain attack detection, and browser-side risk visibility.

OPENING (turn 1): 2 sentences max. Lead with an insight, never a greeting. One specific question. Use page URL to pick:
- pci/compliance/dss: "Requirements 6.4.3 and 11.6.1 are catching a lot of teams off guard right now. Is that on your radar?"
- magecart/supply-chain: "The attack most teams miss isn't in their own code — it's in their vendors' code. Worth a look at yours?"
- /product/ or /platform/: "Evaluating something specific, or still mapping out what you actually need?"
- /vs- or reflectiz-vs: "Already know what you're comparing against, or still figuring out the shortlist?"
- /use-case/: "This use case tends to come up after something specific happens internally. What triggered the search?"
- default: "You're not here by accident. What are you trying to solve?"

ALL RESPONSES: Max 3 sentences. Plain prose only. No markdown, bullets, or headers. No filler phrases.

BUYING SIGNALS (trigger CTA immediately): "audit", "deadline", "my team", "compliance gap", "CISO", "board is asking", "visibility", "blind spots", "third-party risk", "supply chain"
CTA: "Want to see what this looks like for your setup? No commitment, just visibility. Book a time: https://www.reflectiz.com/contact/"

MAX 4 turns total. Offer CTA by turn 4 regardless.`;

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
  RUSHED: 1,
  SKEPTICAL: 2,
  CURIOUS: 2,
  RESEARCHER: 2,
  EVALUATOR: 2,
  HIGH_INTENT: 2,
};

const CONCERN_TO_INTENT = {
  PCI_COMPLIANCE: "PCI_COMPLIANCE",
  MAGECART: "MAGECART_PREVENTION",
  PRIVACY_GDPR: "PRIVACY_GDPR",
  SUPPLY_CHAIN: "SUPPLY_CHAIN",
  TOOL_EVALUATION: "TOOL_EVALUATION",
  GENERAL_AWARENESS: "GENERAL_AWARENESS",
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function claudeWithRetry(fn, maxRetries = 4) {
  let delay = 15000;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (err?.status === 429 && attempt < maxRetries) {
        console.log(`Rate limit hit, waiting ${delay / 1000}s...`);
        await sleep(delay);
        delay *= 1.5;
      } else {
        throw err;
      }
    }
  }
}

// Call Claude directly as the Reflectiz agent (no HTTP invoke needed)
async function callAgent(systemPrompt, messages, userMessage, persona) {
  await sleep(3000);
  const visitorContext = [
    `[Visitor language: ${persona.language}]`,
    `[Visitor geo: ${persona.geo}]`,
    `[Current page: https://www.reflectiz.com${persona.landingPage}]`,
  ].join("\n");

  const fullUserContent = [visitorContext, userMessage].join("\n\n");
  const allMessages = [...messages, { role: "user", content: fullUserContent }];

  const response = await claudeWithRetry(() => anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 256,
    system: systemPrompt,
    messages: allMessages,
  }));
  return response.content[0]?.text?.trim() ?? "";
}

async function generateVisitorMessage(persona, agentMessage) {
  await sleep(3000);
  const prompt = "You are roleplaying as a website visitor.\nPersonality: " + persona.personality + "\nConcern: " + persona.concern + "\nBuy score: " + persona.buyScore + "/10\nAgent said: " + agentMessage + "\nReply in ONE sentence matching your personality. BOUNCER: just say 'ok'. Only the visitor message, nothing else.";
  const response = await claudeWithRetry(() => anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 100,
    messages: [{ role: "user", content: prompt }],
  }));
  return response.content[0]?.text?.trim() ?? "";
}

function determineOutcome(persona, turns, finalAgentMessage) {
  if (persona.personality === "BOUNCER") return "BOUNCED";
  const hasCTA = /reflectiz\.com\/contact|book.*time|meeting|trial|demo/i.test(finalAgentMessage);
  if (hasCTA && persona.buyScore >= 6) return "CONVERTED";
  if (turns >= 2) return "ENGAGED";
  return "DROPPED";
}

async function simulatePersona(base44, persona, systemPrompt) {
  const sessionId = crypto.randomUUID();
  const maxTurns = TURNS_BY_PERSONALITY[persona.personality] ?? 2;
  const transcript = [];
  const conversationHistory = [];
  let lastAgentMessage = "";
  let turnCount = 0;

  console.log(`Simulating: ${persona.name} (${persona.personality})`);

  // Opening message
  lastAgentMessage = await callAgent(systemPrompt, [], "INIT", persona);
  transcript.push(`Agent: ${lastAgentMessage}`);
  conversationHistory.push({ role: "assistant", content: lastAgentMessage });

  // Follow-up turns
  for (let i = 0; i < maxTurns; i++) {
    const visitorMsg = await generateVisitorMessage(persona, lastAgentMessage);
    transcript.push(`Visitor: ${visitorMsg}`);
    conversationHistory.push({ role: "user", content: visitorMsg });
    turnCount++;

    lastAgentMessage = await callAgent(systemPrompt, conversationHistory.slice(0, -1), visitorMsg, persona);
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

  return { name: persona.name, geo: persona.geo, personality: persona.personality, outcome, turns: turnCount, ctaReached };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const body = await req.json().catch(() => ({}));
    const limit = body.limitPersonas ?? PERSONAS.length;
    const personasToRun = PERSONAS.slice(0, limit);
    console.log(`Starting training with ${personasToRun.length} personas`);

    // Fetch latest system prompt (fall back to training prompt)
    const configs = await base44.asServiceRole.entities.AgentConfig.list("-version", 1);
    const systemPrompt = configs?.[0]?.systemPrompt;
    if (!systemPrompt) {
      return Response.json({ error: "No AgentConfig found. Cannot run training without a live system prompt." }, { status: 500 });
    }

    const results = [];
    for (const persona of personasToRun) {
      const result = await simulatePersona(base44, persona, systemPrompt);
      results.push(result);
    }

    const outcomeCounts = { CONVERTED: 0, ENGAGED: 0, DROPPED: 0, BOUNCED: 0 };
    const geoCounts = {};
    for (const r of results) {
      outcomeCounts[r.outcome] = (outcomeCounts[r.outcome] || 0) + 1;
      geoCounts[r.geo] = (geoCounts[r.geo] || 0) + 1;
    }

    const conversionRate = Math.round((outcomeCounts.CONVERTED / personasToRun.length) * 1000) / 10;
    console.log(`Done. Conversion rate: ${conversionRate}%`);

    return Response.json({ totalPersonasSimulated: personasToRun.length, conversionRate, outcomeBreakdown: outcomeCounts, geoBreakdown: geoCounts, results });
  } catch (err) {
    console.error("trainingAgent error:", err.message);
    return Response.json({ error: err.message }, { status: 500 });
  }
});