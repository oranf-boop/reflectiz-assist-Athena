import Anthropic from "npm:@anthropic-ai/sdk@0.39.0";
import { createClientFromRequest } from "npm:@base44/sdk@0.8.25";

const SYSTEM_PROMPT = `CRITICAL INSTRUCTION: You must always respond in the language specified in the visitor context. If geo is France, Belgium, or Switzerland OR language starts with "fr" — respond in French. If geo is Germany or Austria OR language starts with "de" — respond in German. If geo is Spain or Latin America OR language starts with "es" — respond in Spanish. If geo is Italy OR language starts with "it" — respond in Italian. All other cases — respond in English. This overrides everything else. Check the language field in the visitor context block before writing a single word.

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
- Never use markdown formatting, headers, or bullet points in responses. Always respond in plain conversational prose only, maximum 3 to 5 sentences.`;

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
    system: SYSTEM_PROMPT,
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