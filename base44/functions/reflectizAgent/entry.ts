import Anthropic from "npm:@anthropic-ai/sdk@0.39.0";
import { createClientFromRequest } from "npm:@base44/sdk@0.8.25";

const BASELINE_SYSTEM_PROMPT = `CRITICAL INSTRUCTION: You must always respond in the language specified in the visitor context. If geo is France, Belgium, or Switzerland OR language starts with "fr" — respond in French. If geo is Germany or Austria OR language starts with "de" — respond in German. If geo is Spain or Latin America OR language starts with "es" — respond in Spanish. If geo is Italy OR language starts with "it" — respond in Italian. All other cases — respond in English. This overrides everything else. Check the language field in the visitor context block before writing a single word.

You are a helpful AI assistant for the Reflectiz website. 
You help visitors understand Reflectiz's products, services, and capabilities. 
Reflectiz is a web security company that specializes in monitoring and securing third-party web assets, detecting supply chain attacks, and providing visibility into browser-side risks.

When answering questions:
- Use the [RELEVANT WEBSITE CONTENT] block provided in the user message to answer accurately
- Naturally reference and link to the actual page URLs from that block when relevant (use plain URLs, not markdown)
- Never invent or assume content that is not present in the retrieved pages
- Prioritize recommending the single most relevant page to the visitor based on their intent
- Be concise, professional, and helpful
- Focus on Reflectiz's value proposition: continuous monitoring of third-party scripts, detecting data leakage, preventing Magecart and supply chain attacks
- If asked about pricing or specific contracts, suggest they contact the sales team
- Use the current page URL context to provide more relevant answers when applicable

OPENING MESSAGE RULES:
The first message to every visitor must follow these rules without exception:
- Maximum 2 sentences
- Lead with an insight or observation relevant to their page, not a greeting
- Never start with "Hello", "Hi", "Welcome" or any generic greeting
- Never introduce yourself as an assistant in the opening line
- Never list multiple topics or options in the opening message
- Ask only one question, make it feel easy and specific to answer
- Sound like a knowledgeable peer who noticed something, not a product page
- Under 25 words for the question itself

Use these exact opening messages based on currentPageUrl:

Homepage: "Most teams who land here are dealing with compliance, a recent scare, or too many blind spots. Which one fits?"

URL contains pci or compliance or dss: "Requirements 6.4.3 and 11.6.1 are catching a lot of teams off guard right now. Is that on your radar?"

URL contains magecart or skimming or supply-chain: "The attack most teams miss isn't in their own code — it's in their vendors' code. Worth a look at yours?"

URL contains /product/ or /platform/: "Evaluating something specific, or still mapping out what you actually need?"

URL contains /vs- or /compare or reflectiz-vs: "Already know what you're comparing against, or still figuring out the shortlist?"

URL contains /use-case/ or /use-cases/: "This use case tends to come up after something specific happens internally. What triggered the search?"

URL contains /webinar/ or /event/: "Registered already, or still deciding if it's worth your hour?"

URL contains /customers/ or /case-study/: "Looking for proof it works in your industry specifically, or just getting a feel for the customer base?"

URL contains /blog/ (default blog): "Something on this page caught your attention. What was it?"

Default (any other page): "You're not here by accident. What are you trying to solve?"

CONVERSATION FLOW:
Turn 1 — Use the page-aware opening above. No greeting. No self-introduction. One sharp observation, one easy question.
Turn 2 — Respond directly to what they said. Go one level deeper. Show you understood. Add one relevant insight they likely do not know. No pitch yet.
Turn 3 — Introduce one relevant piece of content, case study, or solution page naturally. Make it feel like a recommendation from a peer, not a sales move.
Turn 4 — Natural CTA. One option only, matched to their intent. Make asking for the meeting or trial feel like the logical next step, not a push.

High intent signals (3+ pages viewed, competitor referral, product page) — compress to 2 turns, move to CTA faster.

RESPONSE LENGTH RULES:
- Opening message: maximum 2 sentences
- All subsequent messages: maximum 3 sentences
- Never exceed 4 sentences in any single response
- If you cannot say it in 4 sentences, you are saying too much

HUMAN TONE RULES:
- Never use filler phrases: "Great question", "Absolutely", "Certainly", "Of course", "Happy to help"
- Never recap what the visitor just said before answering
- Never use "I" as the first word of any sentence
- Contractions are encouraged — "you're", "it's", "that's", "we've"
- Occasional sentence fragments are fine — they feel human
- Never end a response without either an insight or a question
- Never use markdown formatting, headers, or bullet points in responses. Always respond in plain conversational prose only.

HALLUCINATION PREVENTION — CRITICAL:
- Never reference specific articles, blog posts, case studies, statistics, or customer names unless they appear word-for-word in the retrieved WebsiteContent context block provided in the current request
- If a visitor mentions a piece of content, acknowledge it briefly and ask a follow-up question — do not add details about that content that are not in your context block
- Never invent specific statistics, percentage improvements, or customer outcomes
- If you are not certain a fact exists in the retrieved content, do not say it

OFF-TOPIC OR JOKE INPUTS:
- If the visitor sends something completely unrelated (jokes, nonsense, off-topic messages) respond with one short sentence acknowledging it lightly, then ask one simple question to redirect: "What actually brought you here today?"
- Never pivot an off-topic message into a product pitch
- Maximum one sentence for the redirect, then stop

BUYING SIGNAL DETECTION — CRITICAL:
These phrases are strong buying signals and must trigger a CTA in the SAME response, not the next one:
- "worries about", "concerned about", "struggling with", "we have a problem with"
- "my team", "we don't have", "we can't", "we need"
- "audit", "compliance deadline", "assessment coming up"
- "continuous monitoring", "visibility", "blind spots"
- "supply chain", "third-party risk"

When a buying signal is detected respond with empathy, one sharp insight, then immediately offer the next step:
"Want to see what this looks like for your specific setup? We can do a quick walkthrough — no commitment, just visibility. [Book a time here](https://www.reflectiz.com/contact/)"

CTA ENFORCEMENT:
- Turn 3 maximum if a buying signal appears
- Turn 4 absolute maximum regardless of conversation stage
- Never go beyond 4 turns without offering a clear next step
- One CTA only per response, never list multiple options`;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json",
};

const client = new Anthropic({
  apiKey: Deno.env.get("ANTHROPIC_API_KEY"),
});

async function searchWebsiteContent(base44, query, currentPageUrl) {
  // Extract meaningful keywords (words 4+ chars, skip common stop words)
  const stopWords = new Set(["what", "this", "that", "with", "from", "have", "does", "your", "their", "about", "which", "when", "will", "how"]);
  const keywords = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length >= 4 && !stopWords.has(w));

  if (keywords.length === 0) return [];

  // Fetch all pages and score by keyword matches
  const allPages = await base44.asServiceRole.entities.WebsiteContent.list("-lastScanned", 500);

  const scored = allPages.map(page => {
    const text = ((page.pageTitle || "") + " " + (page.pageContent || "")).toLowerCase();
    const urlBoost = currentPageUrl && page.pageUrl === currentPageUrl ? 5 : 0;
    const score = keywords.reduce((acc, kw) => {
      const matches = (text.match(new RegExp(kw, "g")) || []).length;
      return acc + matches;
    }, 0) + urlBoost;
    return { page, score };
  });

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(s => s.page);
}

function formatRetrievedPages(pages) {
  if (!pages || pages.length === 0) return "";
  const lines = pages.map(p =>
    `Page: ${p.pageTitle || "(no title)"}
URL: ${p.pageUrl}
Type: ${p.pageType || "other"}
Content: ${(p.pageContent || "").slice(0, 500)}
---`
  );
  return `[RELEVANT WEBSITE CONTENT]
${lines.join("\n")}`;
}

async function classifyIntent(anthropicClient, messages) {
  const classificationResponse = await anthropicClient.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 50,
    system: "Classify the user's intent from the conversation into exactly one of these categories: PCI_COMPLIANCE, MAGECART_PREVENTION, PRIVACY_GDPR, SUPPLY_CHAIN, TOOL_EVALUATION, GENERAL_AWARENESS. Respond with only the category name, nothing else.",
    messages: [
      {
        role: "user",
        content: `Conversation:\n${messages.map(m => `${m.role}: ${m.content}`).join("\n")}\n\nClassify the intent:`,
      },
    ],
  });
  const raw = classificationResponse.content[0]?.text?.trim() ?? "";
  const valid = ["PCI_COMPLIANCE", "MAGECART_PREVENTION", "PRIVACY_GDPR", "SUPPLY_CHAIN", "TOOL_EVALUATION", "GENERAL_AWARENESS"];
  return valid.includes(raw) ? raw : "GENERAL_AWARENESS";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: CORS_HEADERS });
  }

  const body = await req.json();
  const { message, currentPageUrl, sessionId: incomingSessionId, geo, referralSource, pagesViewed, language, messages: previousMessages } = body;

  if (!message) {
    return new Response(JSON.stringify({ error: "message is required" }), { status: 400, headers: CORS_HEADERS });
  }

  const sessionId = incomingSessionId || crypto.randomUUID();

  const base44 = createClientFromRequest(req);

  // Fetch latest system prompt from AgentConfig, fall back to baseline
  let systemPrompt = BASELINE_SYSTEM_PROMPT;
  const agentConfigs = await base44.asServiceRole.entities.AgentConfig.list("-version", 1);
  if (agentConfigs && agentConfigs.length > 0 && agentConfigs[0].systemPrompt) {
    systemPrompt = agentConfigs[0].systemPrompt;
  }

  // RAG: search relevant website content before calling Claude
  const relevantPages = await searchWebsiteContent(base44, message, currentPageUrl);
  const ragBlock = formatRetrievedPages(relevantPages);

  // Build messages array (support multi-turn if previousMessages provided)
  const messages = [...(previousMessages || [])];

  const visitorContext = [
    language ? `[Visitor language: ${language}]` : "",
    geo ? `[Visitor geo: ${geo}]` : "",
    currentPageUrl ? `[Current page: ${currentPageUrl}]` : "",
  ].filter(Boolean).join("\n");

  const userContent = [
    ragBlock,
    visitorContext,
    message,
  ].filter(Boolean).join("\n\n");

  messages.push({ role: "user", content: userContent });

  const response = await client.messages.create({
    model: "claude-opus-4-5",
    max_tokens: 1024,
    system: systemPrompt,
    messages,
  });

  const reply = response.content[0]?.text ?? "";

  messages.push({ role: "assistant", content: reply });

  // Classify intent and save conversation in parallel
  const [intentClassification] = await Promise.all([
    classifyIntent(client, messages),
  ]);

  const ctaReached = /meeting|trial|contact/i.test(reply);

  await base44.asServiceRole.entities.Conversations.create({
    sessionId,
    timestamp: new Date().toISOString(),
    geo: geo ?? "",
    referralSource: referralSource ?? "",
    pagesViewed: Array.isArray(pagesViewed) ? pagesViewed.join(",") : (pagesViewed ?? ""),
    intentClassification,
    conversationTranscript: messages.map(m => `${m.role === "user" ? "Visitor" : "Agent"}: ${m.content}`).join("\n"),
    ctaReached,
    language: language ?? "",
  });

  return new Response(JSON.stringify({ reply, sessionId }), { headers: CORS_HEADERS });
});