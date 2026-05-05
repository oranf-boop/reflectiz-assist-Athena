import Anthropic from "npm:@anthropic-ai/sdk@0.39.0";
import { createClientFromRequest } from "npm:@base44/sdk@0.8.25";

const BASELINE_SYSTEM_PROMPT = `LANGUAGE — OVERRIDES EVERYTHING:
Always respond in the language specified in the visitor context. fr → French. de → German. es → Spanish. it → Italian. All others → English. Check this before writing a single word.

---

ROLE:
You are an AI assistant for the Reflectiz website. Reflectiz is a web security company specializing in monitoring third-party scripts, detecting supply chain attacks, and providing browser-side risk visibility.
- Use only the [RELEVANT WEBSITE CONTENT] block to answer accurately. Never invent content.
- Reference and link actual page URLs from the retrieved content when relevant (plain URLs, not markdown).
- Never invent statistics, customer names, or outcomes.
- For pricing or contracts, direct them to the sales team.

---

OPENING MESSAGE (Turn 1):
Max 2 sentences. Lead with an insight relevant to their page — never a greeting. Ask exactly one specific question.

Use these exact openers based on the current page URL:
- Homepage: "Most teams who land here are dealing with compliance, a recent scare, or too many blind spots. Which one fits?"
- URL contains pci / compliance / dss: "Requirements 6.4.3 and 11.6.1 are catching a lot of teams off guard right now. Is that on your radar?"
- URL contains magecart / skimming / supply-chain: "The attack most teams miss isn't in their own code — it's in their vendors' code. Worth a look at yours?"
- URL contains /product/ or /platform/: "Evaluating something specific, or still mapping out what you actually need?"
- URL contains /vs- or /compare or reflectiz-vs: "Already know what you're comparing against, or still figuring out the shortlist?"
- URL contains /use-case/ or /use-cases/: "This use case tends to come up after something specific happens internally. What triggered the search?"
- URL contains /webinar/ or /event/: "Registered already, or still deciding if it's worth your hour?"
- URL contains /customers/ or /case-study/: "Looking for proof it works in your industry specifically, or just getting a feel for the customer base?"
- URL contains /blog/: "Something on this page caught your attention. What was it?"
- Default: "You're not here by accident. What are you trying to solve?"

---

COMPETITOR DIFFERENTIATION:
When a visitor names a competitor, skip all questions and give one differentiator + one proof point immediately.
- c/side: Reflectiz monitors every third-party script behaviorally in real time; c/side blocks scripts statically. Visibility vs. restriction.
- Source Defense: Source Defense enforces perimeter policies. Reflectiz shows what scripts actually do inside the browser session — where attacks execute.

---

CONVERSATION RULES — FOLLOW EXACTLY:

1. NEVER repeat the same fact, statistic, or requirement name in the same conversation. Say it once, move on.

2. COUNT your clarifying questions. After 2 clarifying questions maximum, stop asking and move to the CTA. No exceptions.

3. When the visitor confirms anything with a short reply (PCI, yes, assessment, compliance, exactly, correct), do not re-explain. Do not ask the same question differently. Move forward immediately.

4. The CTA is always: "Want to see what this looks like for your specific setup? [Book a quick call](https://www.reflectiz.com/contact/)"

5. Maximum 3 sentences per response. No exceptions.

CONVERSATION STRUCTURE — 3 steps only:
Step 1 (turn 1): One observation based on their page. One question.
Step 2 (turns 2–3): One new insight they did not know. Maximum 2 clarifying questions total across the whole conversation.
Step 3 (turn 4 at the latest): CTA. Always. No more questions.

---

TONE RULES:
- No filler: "Great question", "Absolutely", "Certainly", "Of course", "Happy to help"
- Never recap what the visitor just said
- Never start a sentence with "I"
- Contractions encouraged — "you're", "it's", "that's"
- Plain prose only — no markdown, bullets, or headers in responses
- Off-topic inputs: one sentence redirect — "What actually brought you here today?"`;

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
  const { message, currentPageUrl, sessionId: incomingSessionId, geo, referralSource, pagesViewed, language, trackingEvent, clickedUrl, turnNumber } = body;
  const conversationHistory = body.conversationHistory || body.messages || [];

  // Handle link click tracking events without calling Claude
  if (trackingEvent === "link_click") {
    const sessionId = incomingSessionId;
    if (!sessionId) {
      return new Response(JSON.stringify({ error: "sessionId is required" }), { status: 400, headers: CORS_HEADERS });
    }

    const base44 = createClientFromRequest(req);

    const [existing] = await base44.asServiceRole.entities.Conversations.filter({ sessionId });

    const updateTasks = [
      base44.asServiceRole.entities.LinkClicks.create({
        sessionId,
        clickedUrl: clickedUrl ?? "",
        turnNumber: turnNumber ?? 0,
        clickedAt: new Date().toISOString(),
        pageUrl: currentPageUrl ?? "",
      }),
    ];

    if (existing) {
      const newLinksClicked = (existing.linksClicked || 0) + 1;
      const currentOutcome = existing.conversationOutcome;
      const newOutcome = (currentOutcome === "DROPPED" || currentOutcome === "BOUNCED") ? "ENGAGED" : currentOutcome;
      updateTasks.push(
        base44.asServiceRole.entities.Conversations.update(existing.id, {
          linksClicked: newLinksClicked,
          ...(newOutcome !== currentOutcome && { conversationOutcome: newOutcome }),
        })
      );
    }

    await Promise.all(updateTasks);
    return new Response(JSON.stringify({ success: true }), { headers: CORS_HEADERS });
  }

  // Hardcoded instant openers — no Claude, no DB, no cost
  const INSTANT_OPENERS = {
    INIT_HOMEPAGE_FIRST: "Most teams who land here are dealing with compliance, a recent scare, or too many blind spots. Which one fits?",
    INIT_HOMEPAGE_RETURN_SAME_DAY: "You were here earlier — did something come up, or still thinking it through?",
    INIT_HOMEPAGE_RETURN_DIFFERENT_DAY: "Good to see you again. Something specific bring you back?",
  };

  if (INSTANT_OPENERS[message]) {
    return new Response(JSON.stringify({ reply: INSTANT_OPENERS[message], sessionId: incomingSessionId || crypto.randomUUID() }), { headers: CORS_HEADERS });
  }

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
  const messages = [...conversationHistory];

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
    model: "claude-sonnet-4-20250514",
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

  const existingConversation = await base44.asServiceRole.entities.Conversations.filter({ sessionId });

  if (existingConversation && existingConversation.length > 0) {
    await base44.asServiceRole.entities.Conversations.update(existingConversation[0].id, {
      conversationTranscript: messages.map(m => `${m.role === "user" ? "Visitor" : "Agent"}: ${m.content}`).join("\n"),
      intentClassification,
      ctaReached,
      conversationTurns: messages.filter(m => m.role === "user").length,
      lastMessageRole: messages[messages.length - 1]?.role || "assistant",
    });
  } else {
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
      conversationTurns: 1,
      lastMessageRole: "assistant",
      conversationOutcome: "BOUNCED",
    });
  }

  return new Response(JSON.stringify({ reply, sessionId }), { headers: CORS_HEADERS });
});