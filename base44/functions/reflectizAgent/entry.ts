import { JWT } from "npm:google-auth-library@9.15.1";
import { createClientFromRequest } from "npm:@base44/sdk@0.8.25";

const PROJECT_ID = "dashboarderv0";
const REGION = "us-central1";
const GEMINI_MODEL = "gemini-2.5-flash";

async function getAccessToken() {
  const sa = JSON.parse(Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON"));
  const jwt = new JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  const { token } = await jwt.getAccessToken();
  return token;
}

async function callGemini({ system, messages, max_tokens }) {
  const token = await getAccessToken();
  const url = `https://${REGION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${REGION}/publishers/google/models/${GEMINI_MODEL}:generateContent`;

  const contents = messages.map(m => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const body = {
    contents,
    generationConfig: { maxOutputTokens: max_tokens || 1024 },
  };
  if (system) {
    body.systemInstruction = { parts: [{ text: system }] };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini error ${res.status}: ${errText}`);
  }
  const data = await res.json();
  // Join all parts in case Gemini splits the response across multiple parts
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map(p => p.text ?? "").join("") || "";
  const finishReason = data.candidates?.[0]?.finishReason ?? "unknown";
  console.log("Gemini parts count:", parts.length, "finishReason:", finishReason, "text len:", text.length);
  return { content: [{ text }] };
}

const BASELINE_SYSTEM_PROMPT = `LANGUAGE, OVERRIDES EVERYTHING:
Always respond in the language specified in the visitor context. fr: French. de: German. es: Spanish. it: Italian. All others: English. Check this before writing a single word.

---

ROLE:
You are an AI assistant for the Reflectiz website. Reflectiz is a web security company specializing in monitoring third-party scripts, detecting supply chain attacks, and providing browser-side risk visibility.
- Use only the [RELEVANT WEBSITE CONTENT] block to answer accurately. Never invent content.
- Reference and link actual page URLs from the retrieved content when relevant (plain URLs, not markdown).
- Never invent statistics, customer names, or outcomes.
- For pricing or contracts, direct them to the sales team.

---

OPENING MESSAGE (Turn 1):
Max 2 sentences. Lead with an insight relevant to their page, never a greeting. Ask exactly one specific question.

Use these exact openers based on the current page URL:
- Homepage: "Most teams who land here are dealing with compliance, a recent scare, or too many blind spots. Which one fits?"
- URL contains pci / compliance / dss: "Requirements 6.4.3 and 11.6.1 are catching a lot of teams off guard right now. Is that on your radar?"
- URL contains magecart / skimming / supply-chain: "The attack most teams miss is not in their own code. It is in their vendors' code. Worth a look at yours?"
- URL contains /product/ or /platform/: "Evaluating something specific, or still mapping out what you actually need?"
- URL contains /vs- or /compare or reflectiz-vs: "Already know what you're comparing against, or still figuring out the shortlist?"
- URL contains /use-case/ or /use-cases/: "This use case tends to come up after something specific happens internally. What triggered the search?"
- URL contains /webinar/ or /event/: "Registered already, or still deciding if it's worth your hour?"
- URL contains /customers/ or /case-study/: "Looking for proof it works in your industry specifically, or just getting a feel for the customer base?"
- URL contains /blog/: "Something on this page caught your attention. What was it?"
- Default (use timeOnPage to choose):
  * timeOnPage < 15 seconds: "What brought you here today -- compliance, a recent concern, or just exploring?"
  * timeOnPage 15 to 45 seconds: "You have been looking around -- anything specific catch your eye, or still getting the lay of the land?"
  * timeOnPage > 45 seconds: "Spending some time here -- usually means something specific is on your radar. What is it?"

---

COMPETITOR DIFFERENTIATION:
When a visitor names a competitor, skip all questions and give one differentiator + one proof point immediately.
- c/side: Reflectiz monitors every third-party script behaviorally in real time; c/side blocks scripts statically. Visibility vs. restriction.
- Source Defense: Source Defense enforces perimeter policies. Reflectiz shows what scripts actually do inside the browser session, where attacks execute.

---

CONVERSATION RULES, FOLLOW EXACTLY:

1. NEVER repeat the same fact, statistic, or requirement name in the same conversation. Say it once, move on.

2. COUNT your clarifying questions. After 2 clarifying questions maximum, stop asking and move to the CTA. No exceptions.

3. When the visitor confirms anything with a short reply (PCI, yes, assessment, compliance, exactly, correct), do not re-explain. Do not ask the same question differently. Move forward immediately.

4. The CTA is always: "Want to see what this looks like for your specific setup? [Book a quick call](https://www.reflectiz.com/registration/)"

5. Maximum 3 sentences per response. No exceptions.

CONVERSATION STRUCTURE, 3 steps only:
Step 1 (turn 1): One observation based on their page. One question.
Step 2 (turns 2 to 3): One new insight they did not know. Maximum 2 clarifying questions total across the whole conversation.
Step 3 (turn 4 at the latest): CTA. Always. No more questions.

READING REQUEST RULE:
When a visitor explicitly says they are not ready for a meeting but want to read something, this is a Phase 2 moment. Do not offer a CTA. Do not mention booking a call. Find the most relevant article or case study from the retrieved content and share it with a direct link and one sentence explaining why it is relevant to their specific situation. Only move to CTA after they have engaged with the content.

CONTENT INTEGRITY RULE:
When a visitor asks for an article, blog post, or reading material, always check the [RELEVANT WEBSITE CONTENT] block first. If relevant pages exist, link to the most relevant one directly with its full URL. Only say you do not have a specific article if the retrieved content block is completely empty. Never send visitors to the blog homepage as a fallback when specific articles exist in the retrieved content.

---

TONE RULES:
- NEVER use an em dash (—) anywhere in any response. This is a hard rule with no exceptions. Instead of an em dash use a comma, a period, or rewrite the sentence to avoid it entirely. Search your response before sending and replace any em dash with a comma or period.
- No filler: "Great question", "Absolutely", "Certainly", "Of course", "Happy to help"
- Never recap what the visitor just said
- Never start a sentence with "I"
- Contractions encouraged: "you're", "it's", "that's"
- Plain prose only, no markdown, bullets, or headers in responses
- Off-topic inputs: one sentence redirect: "What actually brought you here today?"

---

OFF-TOPIC DETECTION:
Only redirect as off-topic when the message is clearly unrelated to security, business, technology, or the visitor context. Examples of real off-topic: recipes, sports scores, jokes, gibberish, explicit content.

NEVER treat these as off-topic:
- Visitor mentions their country, city, or region ("I am from Israel", "we are in London")
- Visitor mentions their industry ("I am in finance", "we are in healthcare", "retail company")
- Visitor mentions their role ("I am a CISO", "I work in security")
- Short clarifying answers that add context
- Questions about the agent itself

For country or industry mentions: acknowledge it naturally and use it as context. Example: if visitor says "I am from Israel" respond with "Good to know, our EMEA team covers Israel specifically. What brings you to Reflectiz today?"

For "what version are you" or "who made you" or similar meta questions: respond with "I am the Reflectiz website assistant. What can I help you with today?"

---

FINANCIAL SERVICES RECOMMENDATION:
When a visitor mentions finance, financial services, banking, or fintech, recommend this specific page: https://www.reflectiz.com/industries/financial-services/ — but only if the visitor is NOT already on that page. If the visitor is already on that page, recommend a relevant case study or blog post from the retrieved content instead.`;

const FORM_PAGES = ["/registration", "/free-trial", "/contact"];

function isFormPage(url) {
  if (!url) return false;
  const u = url.toLowerCase();
  return FORM_PAGES.some(p => u.includes(p));
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json",
};

async function searchWebsiteContent(base44, query, currentPageUrl) {
  const stopWords = new Set([
    "what", "this", "that", "with", "from", "have", "does", "your", "their", "about",
    "which", "when", "will", "how", "can", "you", "tell", "me", "are", "the", "for",
    "its", "get", "all", "any", "our", "more", "was", "has", "been", "not", "but",
    "they", "them", "use", "used", "using", "see", "let", "just", "also", "into",
  ]);

  // FIX 1: Translate Hebrew security terms to English before keyword extraction
  const hebrewKeywords = {
    "שרשרת אספקה": "supply chain",
    "שרשרת": "supply chain",
    "אספקה": "supply chain",
    "צד שלישי": "third party",
    "סקריפט": "script",
    "פיקסל": "pixel",
    "מגקארט": "magecart",
    "אבטחה": "security",
    "ציות": "compliance",
    "פרטיות": "privacy",
    "סיכון": "risk",
    "התקפה": "attack",
    "מאמר": "article blog",
    "מדריך": "guide",
    "דוח": "report",
  };
  let searchQuery = query;
  Object.entries(hebrewKeywords).forEach(([hebrew, english]) => {
    searchQuery = searchQuery.replace(new RegExp(hebrew, "g"), english);
  });

  const queryLower = searchQuery.toLowerCase();
  // Extract keywords and strip trailing 's' for simple plural stemming
  const keywords = queryLower
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length >= 3 && !stopWords.has(w))
    .map(w => w.endsWith("s") && w.length > 4 ? w.slice(0, -1) : w);

  if (keywords.length === 0) return [];

  const META_URL_PATTERNS = ["/event-locations/", "/careers/", "/team/", "/author/", "/tag/", "/category/", "/page/", "/feed/"];

  const allPages = (await base44.asServiceRole.entities.WebsiteContent.list("-lastScanned", 500))
    .filter(p => !META_URL_PATTERNS.some(pat => (p.pageUrl || "").includes(pat)));

  const reflectizPages = allPages.filter(page => (page.pageUrl || "").includes("reflectiz.com"));

  // FIX 1: event/webinar boost keywords
  const eventKeywords = ["event", "webinar", "conference", "upcoming"];
  const hasEventIntent = eventKeywords.some(kw => queryLower.includes(kw));

  // FIX 4: supply chain / content topic boost keywords
  const contentTopicKeywords = ["supply chain", "third party", "fourth party", "script", "magecart", "skimming", "article", "read", "blog", "learn"];
  const hasContentTopicIntent = contentTopicKeywords.some(kw => queryLower.includes(kw));

  const recencySignals = ["upcoming", "register", "live", "join us", "may 2026", "june 2026", "july 2026"];

  const scored = reflectizPages.map(page => {
  const text = ((page.pageTitle || "") + " " + (page.pageContent || "")).toLowerCase();
  const pageUrl = (page.pageUrl || "").toLowerCase();
  const urlBoost = currentPageUrl && page.pageUrl === currentPageUrl ? 5 : 0;
  const score = keywords.reduce((acc, kw) => {
    const matches = (text.match(new RegExp(kw, "g")) || []).length;
    return acc + matches;
  }, 0);

  const urlYearMatch = (page.pageUrl || "").match(/20(2[0-3])/);
  const yearPenalty = urlYearMatch ? 25 : 0;
  const longUrlPenalty = (page.pageUrl || "").length > 80 ? 10 : 0;

  const aiIntent = ["ai", "artificial intelligence", "machine learning", "future", "llm", "chatgpt"].some(kw => queryLower.includes(kw));
  const aiBoost = aiIntent && (
    pageUrl.includes("ai") ||
    (page.pageTitle || "").toLowerCase().includes("ai") ||
    (page.pageTitle || "").toLowerCase().includes("artificial")
  ) ? 15 : 0;

    const recencyBoost = hasEventIntent && recencySignals.some(sig => text.includes(sig)) ? 20 : 0;

    const companyCaseStudyBoost =
      (page.pageType === "case-study" || page.pageType === "customers") &&
      keywords.some(kw =>
        (page.pageTitle || "").toLowerCase().includes(kw) ||
        pageUrl.includes(kw)
      ) ? 10 : 0;

    // FIX 1: boost webinar/event pages
    const eventBoost = hasEventIntent &&
      (page.pageType === "webinar" || pageUrl.includes("/events/") || pageUrl.includes("/webinar/") || pageUrl.includes("/learning-hub/") ||
       (page.pageTitle || "").toLowerCase().includes("webinar") || (page.pageTitle || "").toLowerCase().includes("panel"))
      ? 20 : 0;

    // FIX 4: boost blog/learning hub pages on content topic queries
    const contentTopicBoost = hasContentTopicIntent &&
      (pageUrl.includes("/blog/") || pageUrl.includes("/learning-hub/") || pageUrl.includes("/resources/"))
      ? 10 : 0;

    // FIX 2: boost supply chain specific pages for supply chain queries
    const supplyChainQuery = queryLower.includes("supply chain") || queryLower.includes("supply-chain");
    const supplyChainBoost = supplyChainQuery &&
      (pageUrl.includes("supply-chain") || pageUrl.includes("ai-supply-chain"))
      ? 15 : 0;

    // Magecart intent boost for recent pages
    const magecartIntent = ["magecart", "skimming", "web skimming", "card skimming"].some(kw => queryLower.includes(kw));
    const magecartBoost = magecartIntent &&
      pageUrl.includes("magecart") &&
      !/(202[0-3])/.test(page.pageUrl || "") ? 20 : 0;

    return { page, score: score + urlBoost + companyCaseStudyBoost + eventBoost + contentTopicBoost + recencyBoost + supplyChainBoost + aiBoost + magecartBoost - yearPenalty - longUrlPenalty };
  });

  const sorted = scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  // Force live panel discussion to position 0 for event-intent queries
  if (hasEventIntent) {
    const panelIndex = sorted.findIndex(s => (s.page.pageUrl || "").includes("live-panel-discussion"));
    if (panelIndex > -1) {
      const panelPage = sorted.splice(panelIndex, 1)[0];
      sorted.unshift(panelPage);
    }
  }

  return sorted.slice(0, 3).map(s => s.page);
}

function formatRetrievedPages(pages) {
  if (!pages || pages.length === 0) return "";
  const lines = pages.map(p =>
    `Page: ${p.pageTitle || "(no title)"}
URL: ${p.pageUrl}
Type: ${p.pageType || "other"}
Content: ${(p.pageContent || "").slice(0, 300)}
---`
  );
  return `[RELEVANT WEBSITE CONTENT]
${lines.join("\n")}`;
}

async function classifyIntent(messages, currentPageUrl) {
  const cleanMessages = messages
    .map(m => ({
      role: m.role,
      content: m.content
        .replace(/\[RELEVANT WEBSITE CONTENT\][\s\S]*?\[\/RELEVANT WEBSITE CONTENT\]/g, "")
        .replace(/\[Visitor[^\]]*\]/g, "")
        .replace(/\[Current page[^\]]*\]/g, "")
        .trim()
    }))
    .filter(m => m.content.length > 0);

  const pageContext = currentPageUrl ? `Current page: ${currentPageUrl}\n\n` : "";

  const result = await callGemini({
    max_tokens: 50,
    system: `Classify the visitor's intent from this B2B cybersecurity chat conversation into exactly one category. Return only the category name, nothing else.

Categories and signals:
PCI_COMPLIANCE: mentions PCI, DSS, 4.0, 6.4.3, 11.6.1, audit, QSA, assessment, payment page, compliance deadline, cardholder data
MAGECART_PREVENTION: mentions Magecart, web skimming, card skimming, checkout attack, e-skimming, payment page scripts
PRIVACY_GDPR: mentions GDPR, privacy, pixel tracking, consent, data collection, cookie, CCPA, data leakage
SUPPLY_CHAIN: mentions supply chain, third-party scripts, fourth-party, vendor risk, script monitoring, CDN, tag manager
TOOL_EVALUATION: mentions comparing tools, evaluating vendors, looking for a solution, pricing, competitors, demo request, trial
GENERAL_AWARENESS: visitor is exploring generally with no specific pain point mentioned

Choose PCI_COMPLIANCE if the visitor mentions anything related to compliance or audits.
Choose SUPPLY_CHAIN if the visitor mentions third-party scripts or vendor risk.
Choose TOOL_EVALUATION if the visitor is comparing or evaluating.
Default to GENERAL_AWARENESS only if none of the above apply.`,
    messages: [
      {
        role: "user",
        content: `${pageContext}Conversation:\n${cleanMessages.map(m => `${m.role}: ${m.content}`).join("\n")}\n\nClassify the intent:`,
      },
    ],
  });
  const raw = result.content[0]?.text?.trim() ?? "";
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
  const { message, currentPageUrl, sessionId: incomingSessionId, geo, referralSource, pagesViewed, trackingEvent, clickedUrl, turnNumber, lastIntent, lastTopic, pageTitle: clientPageTitle, pageDescription, timeOnPage, hasActiveConversation } = body;
  let language = body.language;
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

    const HIGH_INTENT_PATHS = ["/registration", "/free-trial", "/plans", "/pricing", "/contact"];
    const isHighIntent = HIGH_INTENT_PATHS.some(p => (clickedUrl ?? "").toLowerCase().includes(p));
    if (isHighIntent && existing) {
      const updatedConv = { ...existing, linksClicked: (existing.linksClicked || 0) + 1, clickedUrl };
      fetch(`${req.url.replace(/\/[^/]+$/, "/slackAlert")}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": req.headers.get("Authorization") ?? "" },
        body: JSON.stringify(updatedConv),
      }).catch(() => {});
    }

    return new Response(JSON.stringify({ success: true }), { headers: CORS_HEADERS });
  }

  // Hardcoded instant openers, no Gemini, no DB, no cost
  const INSTANT_OPENERS = {
    INIT_HOMEPAGE_RETURN_SAME_DAY: "You were here earlier. Did something come up, or still thinking it through?",
    INIT_HOMEPAGE_RETURN_DIFFERENT_DAY: "Something specific bring you back?",
  };

  if (INSTANT_OPENERS[message]) {
    return new Response(JSON.stringify({ reply: INSTANT_OPENERS[message], sessionId: incomingSessionId || crypto.randomUUID() }), { headers: CORS_HEADERS });
  }

  // Dynamic page-aware opener for all INIT variants
  if (message.startsWith("INIT") && message !== "INIT_RETURNING_VISITOR") {
    const sessionId = incomingSessionId || crypto.randomUUID();

    if (isFormPage(currentPageUrl)) {
      return new Response(JSON.stringify({ reply: null, sessionId }), { headers: CORS_HEADERS });
    }

    const base44 = createClientFromRequest(req);

    const contextTitle = clientPageTitle || currentPageUrl;

    // Check cache - must match exact URL
    const cachedResults = await base44.asServiceRole.entities.PageOpeners.filter({ pageUrl: currentPageUrl });
    const cached = cachedResults?.[0];
    console.log("Cache check:", JSON.stringify({ found: !!cached, opener: cached?.opener?.slice(0, 80), contextTitle }));

    if (cached && cached.opener && cached.opener.includes("?") && cached.opener.length > 20 && cached.pageUrl === currentPageUrl) {
      return new Response(JSON.stringify({ reply: cached.opener, bubbleText: cached.bubbleText || "", sessionId }), { headers: CORS_HEADERS });
    }

    const effectiveLanguage = geo === "Israel" ? "en" : (language || "en");

    const pageLower = (currentPageUrl || "").toLowerCase();

    const isValidPageUrl = (
      currentPageUrl &&
      currentPageUrl.length > 30 &&
      !currentPageUrl.includes("wp-admin") &&
      !currentPageUrl.includes("lovable.app") &&
      !currentPageUrl.includes("lovable.dev") &&
      !currentPageUrl.includes("localhost") &&
      !currentPageUrl.includes("base44.app") &&
      currentPageUrl.includes("reflectiz.com")
    );

    const visitorContextBlock = `
Current page: ${currentPageUrl}
Page title: ${contextTitle}
Visitor geo: ${geo || "Unknown"}
Referral source: ${referralSource || "direct"}
Pages viewed this session: ${Array.isArray(pagesViewed) ? pagesViewed.join(" → ") : (pagesViewed || "/")}
Time on page: ${timeOnPage || 0} seconds
Browser language: ${effectiveLanguage || "en"}
Returning visitor: ${hasActiveConversation ? "yes" : "no"}
`;

    const contentLibrary = `
AVAILABLE CASE STUDIES AND CONTENT (pick the most contextually relevant one):

RETAIL/ECOMMERCE + SUPPLY CHAIN:
- Castore (premium sportswear, 30+ online stores): https://www.reflectiz.com/customers/castore-security-success/

GAMING/ENTERTAINMENT + PCI COMPLIANCE:
- Broadway Gaming (online gaming, zero audit findings): https://www.reflectiz.com/customers/broadway-gaming-pci/

UK PAYMENT SECURITY + PCI:
- Apexx Global (UK payment infrastructure, PCI 4.0.1): https://www.reflectiz.com/customers/apexx-global/

TRAVEL/HOSPITALITY + PCI:
- lastminute.com (travel, PCI DSS success): https://www.reflectiz.com/customers/pci-lastminute/

ANZ/AUSTRALIA/NEW ZEALAND + SUPPLY CHAIN:
- ANZ Web Supply Chain Research: https://www.reflectiz.com/blog/supply-chain-anz/

AI THREATS + RETAIL SECURITY:
- AI Retail Security Webinar (on-demand): https://www.reflectiz.com/learning-hub/webinar-ai-retail-feb-2026/

CISO + AI SUPPLY CHAIN:
- CISO Guide to AI Supply Chain Attacks: https://www.reflectiz.com/learning-hub/ai-supply-chain-attacks/

PCI COMPLIANCE GENERAL:
- PCI Use Case Page: https://www.reflectiz.com/use-cases/pci-compliance/

MAGECART/SKIMMING:
- Magecart Use Case: https://www.reflectiz.com/use-cases/magecart-web-skimming/

PRIVACY/GDPR:
- Privacy Compliance Use Case: https://www.reflectiz.com/use-cases/website-privacy-compliance/

SUPPLY CHAIN GENERAL:
- Web Supply Chain Risks: https://www.reflectiz.com/use-cases/web-supply-chain-risks/

FINANCIAL SERVICES:
- Financial Services Industry Page: https://www.reflectiz.com/industries/financial-services/

FREE ASSESSMENT (use as CTA when no specific content matches or visitor shows high intent):
- Free Trial: https://www.reflectiz.com/registration/
`;

    const openerPrompt = `You are Athena, a web security expert for Reflectiz. A visitor just landed on a page. Your job is to deliver immediate relevant value in ONE opening message.

VISITOR SIGNALS:
${visitorContextBlock}

${contentLibrary}

INSTRUCTIONS:
1. Read ALL visitor signals carefully -- geo, referral source, pages viewed, and current page together tell you who this person is and what they care about
2. Pick the SINGLE most relevant content asset from the library based on the combination of signals
3. Write a 2-3 sentence opener that:
   - Sentence 1: One sharp insight relevant to their specific context (mention their industry or topic if you can infer it)
   - Sentence 2: Recommend the chosen content asset using markdown link format with descriptive label (see LINK FORMAT RULE below)
   - Sentence 3: One short soft invitation or statement (max 8 words, NO question mark)
4. No greeting words, no em dashes, no double hyphens
5. Sound like a knowledgeable peer who knows their context
6. If visitor is returning (Returning visitor: yes): skip the insight, go straight to next step CTA

LINK FORMAT RULE:
When including a URL, always format it as markdown with a descriptive label:
[Watch the AI Retail Security Webinar](https://www.reflectiz.com/learning-hub/webinar-ai-retail-feb-2026/)
[Read the Broadway Gaming case study](https://www.reflectiz.com/customers/broadway-gaming-pci/)
[See the Castore success story](https://www.reflectiz.com/customers/castore-security-success/)
[Start your free assessment](https://www.reflectiz.com/registration/)

Never show the raw URL. Always use a descriptive action label.
Never end with a question. End with a statement or soft invitation.

Return only the opener text. Nothing else.`;

    const rawOpenerRes = await callGemini({ messages: [{ role: "user", content: openerPrompt }], max_tokens: 2048 });

    let rawOpener = (rawOpenerRes?.content?.[0]?.text ?? "").trim();
    let opener = rawOpener || null;

    console.log("Opener finishReason:", rawOpenerRes?.candidates?.[0]?.finishReason, "length:", rawOpener?.length);

    // Extract bubbleText from the opener (not a separate generation)
    let bubbleText = null;
    if (opener) {
      const bubblePrompt = `Extract the single most attention-grabbing phrase from this opener to use as a 6-word notification bubble. It must be specific, not generic, and create curiosity.

Opener: ${opener}

Rules:
- Maximum 6 words
- Must reference something specific from the opener (a company name, a number, a specific threat)
- Never use: "your site", "exposure", "think", "manage", "currently"
- Start with an action verb or surprising fact
- No punctuation

Return only the 6 words.`;

      const rawBubble = await callGemini({ messages: [{ role: "user", content: bubblePrompt }], max_tokens: 500 });
      bubbleText = (rawBubble?.content?.[0]?.text ?? "").trim() || opener.split(" ").slice(0, 6).join(" ");
    }

    // Validate opener
    if (!opener || opener.split(" ").length < 8) {
      opener = null;
      bubbleText = null;
    }

    // Ensure opener always has a URL
    if (opener && !opener.includes("https://")) {
      if (opener.toLowerCase().includes("ai retail") || opener.toLowerCase().includes("retail security")) {
        opener += " https://www.reflectiz.com/learning-hub/webinar-ai-retail-feb-2026/";
      } else if (opener.toLowerCase().includes("castore") || opener.toLowerCase().includes("storefront")) {
        opener += " https://www.reflectiz.com/customers/castore-security-success/";
      } else if (opener.toLowerCase().includes("broadway") || opener.toLowerCase().includes("gaming")) {
        opener += " https://www.reflectiz.com/customers/broadway-gaming-pci/";
      } else if (opener.toLowerCase().includes("apexx")) {
        opener += " https://www.reflectiz.com/customers/apexx-global/";
      } else if (opener.toLowerCase().includes("lastminute") || opener.toLowerCase().includes("travel")) {
        opener += " https://www.reflectiz.com/customers/pci-lastminute/";
      } else if (opener.toLowerCase().includes("webinar") || opener.toLowerCase().includes("panel")) {
        opener += " https://www.reflectiz.com/learning-hub/webinar-ai-retail-feb-2026/";
      } else if (opener.toLowerCase().includes("supply chain") || opener.toLowerCase().includes("fourth-party")) {
        opener += " https://www.reflectiz.com/use-cases/web-supply-chain-risks/";
      } else if (opener.toLowerCase().includes("magecart") || opener.toLowerCase().includes("skimming")) {
        opener += " https://www.reflectiz.com/use-cases/magecart-web-skimming/";
      } else if (opener.toLowerCase().includes("privacy") || opener.toLowerCase().includes("gdpr") || opener.toLowerCase().includes("pixel")) {
        opener += " https://www.reflectiz.com/use-cases/website-privacy-compliance/";
      } else if (opener.toLowerCase().includes("financial") || opener.toLowerCase().includes("banking") || opener.toLowerCase().includes("payment")) {
        opener += " https://www.reflectiz.com/industries/financial-services/";
      } else if (opener.toLowerCase().includes("pci") || opener.toLowerCase().includes("compliance") || opener.toLowerCase().includes("audit")) {
        opener += " https://www.reflectiz.com/use-cases/pci-compliance/";
      } else if (opener.toLowerCase().includes("ciso") || opener.toLowerCase().includes("ai supply")) {
        opener += " https://www.reflectiz.com/learning-hub/ai-supply-chain-attacks/";
      } else if (opener.toLowerCase().includes("assessment") || opener.toLowerCase().includes("trial")) {
        opener += " https://www.reflectiz.com/registration/";
      } else {
        opener += " https://www.reflectiz.com/registration/";
      }
    }

    // Page-aware fallbacks if Gemini fails
    if (!opener) {
      opener =
        pageLower.includes("pci") || pageLower.includes("compliance") ? "Requirements 6.4.3 and 11.6.1 are where most teams get caught out. Broadway Gaming solved this with zero audit findings: https://www.reflectiz.com/customers/broadway-gaming-pci/" :
        pageLower.includes("magecart") || pageLower.includes("skimming") ? "Most Magecart attacks hide inside third-party scripts your team did not write. Here is how teams are stopping them: https://www.reflectiz.com/use-cases/magecart-web-skimming/" :
        pageLower.includes("supply-chain") ? "Fourth-party scripts are the blind spot most tools miss. This research shows how widespread the problem is: https://www.reflectiz.com/blog/supply-chain-anz/" :
        pageLower.includes("privacy") || pageLower.includes("gdpr") ? "Your consent banner says one thing but your pixels may be doing another. Here is how to close that gap: https://www.reflectiz.com/use-cases/website-privacy-compliance/" :
        pageLower.includes("ecommerce") || pageLower.includes("retail") ? "E-commerce checkout pages are the highest value target for web skimming. Castore secured 30 stores without touching their code: https://www.reflectiz.com/customers/castore-security-success/" :
        pageLower.includes("financial") || pageLower.includes("finance") ? "Financial services teams face the tightest compliance requirements. Here is how peers are handling it: https://www.reflectiz.com/industries/financial-services/" :
        pageLower.includes("platform") || pageLower.includes("product") ? "Monitoring from outside your stack catches what embedded tools miss. No code installation, full visibility in 48 hours: https://www.reflectiz.com/registration/" :
        pageLower.includes("customers") || pageLower.includes("case-study") ? "Results like this come from continuous monitoring, not one-time scans. See what is running on your own site in 48 hours: https://www.reflectiz.com/registration/" :
        pageLower.includes("vs") || pageLower.includes("compare") ? "The detailed comparison is on this page. Want to see how it looks for your specific setup? https://www.reflectiz.com/registration/" :
        "Your site has blind spots worth finding: https://www.reflectiz.com/registration/";
    }

    if (!bubbleText || bubbleText.split(" ").length > 10) {
      const fallbackBubblePrompt = `Write 5 words that tease the most relevant web security insight for a visitor on this page. Be specific to their context.

Page: ${contextTitle}
URL: ${currentPageUrl}
Geo: ${geo || "Unknown"}
Referral: ${referralSource || "direct"}

Return only 5 words. No punctuation. No generic phrases like "your site has exposure".`;

      const fallbackBubbleRes = await callGemini({
        messages: [{ role: "user", content: fallbackBubblePrompt }],
        max_tokens: 500,
      });
      bubbleText = (fallbackBubbleRes?.content?.[0]?.text ?? "").trim() || null;
    }

    if (isValidPageUrl) {
      await base44.asServiceRole.entities.PageOpeners.create({
        pageUrl: currentPageUrl,
        opener,
        bubbleText,
        generatedAt: new Date().toISOString(),
      }).catch(() => {});
    }

    return new Response(JSON.stringify({ reply: opener, bubbleText, sessionId }), { headers: CORS_HEADERS });
  }

  // client replaced by callClaude helper

  if (message === "INIT_RETURNING_VISITOR") {
    const sessionId = incomingSessionId || crypto.randomUUID();
    const base44 = createClientFromRequest(req);

    const intentOpeners = {
      PCI_COMPLIANCE: "PCI compliance still on the agenda, or did something new come up?",
      MAGECART_PREVENTION: "Still thinking through the supply chain risk angle?",
      TOOL_EVALUATION: "Still in evaluation mode, or has something moved forward?",
      PRIVACY_GDPR: "Still working through the privacy compliance question?",
      SUPPLY_CHAIN: "Supply chain risk still a concern, or did something shift?",
    };
    const intentHint = intentOpeners[lastIntent] || "Something bring you back today?";

    const returningPrompt = `A visitor is returning to the Reflectiz website after more than 2 hours away. Their previous intent classification was: ${lastIntent || "unknown"}.

Generate a natural one-sentence opening message that:
- Uses this intent-based hint as your starting point: "${intentHint}"
- You may use it verbatim or lightly rephrase it to feel natural
- References their previous topic, never the fact they are returning
- Ends with a question
- Maximum 1 sentence total
- NEVER say "Good to see you again", "Welcome back", or "Great to have you back" -- these feel presumptuous and CRM-like
- No em dashes
- Tone: a knowledgeable peer who remembers the topic, not a system recognizing a contact`;

    const returningResponse = await callGemini({
      max_tokens: 1024,
      messages: [{ role: "user", content: returningPrompt }],
    });

    const reply = (returningResponse.content[0]?.text ?? "Something bring you back today?").replace(/—/g, ",");

    // No DB write for INIT — the first real visitor message will create the record and fire slackAlert
    return new Response(JSON.stringify({ reply, sessionId }), { headers: CORS_HEADERS });
  }

  if (!message) {
    return new Response(JSON.stringify({ error: "message is required" }), { status: 400, headers: CORS_HEADERS });
  }

  const sessionId = incomingSessionId || crypto.randomUUID();
  const base44 = createClientFromRequest(req);

  let systemPrompt = BASELINE_SYSTEM_PROMPT;
  const agentConfigs = await base44.asServiceRole.entities.AgentConfig.list("-version", 1);
  if (agentConfigs && agentConfigs.length > 0 && agentConfigs[0].systemPrompt) {
    systemPrompt = agentConfigs[0].systemPrompt;
  }

  // Language detection: Hebrew characters → Hebrew; Israel geo without Hebrew → English; otherwise use browser language
  const containsHebrew = /[\u0590-\u05FF]/.test(message);
  const effectiveLanguage = containsHebrew ? "he" : (geo === "Israel" ? "en" : language);

  const relevantPages = await searchWebsiteContent(base44, message, currentPageUrl);
  const ragBlock = formatRetrievedPages(relevantPages);

  const messages = [...conversationHistory];

  const languageLabel = effectiveLanguage === "he" ? "he (Hebrew -- respond in Hebrew)" : effectiveLanguage;
  const visitorContext = [
    languageLabel ? `[Visitor language: ${languageLabel}]` : "",
    geo ? `[Visitor geo: ${geo}]` : "",
    currentPageUrl ? `[Current page: ${currentPageUrl}]` : "",
  ].filter(Boolean).join("\n");

  const userContent = [ragBlock, visitorContext, message].filter(Boolean).join("\n\n");
  messages.push({ role: "user", content: userContent });

  const response = await callGemini({
    max_tokens: 2048,
    system: systemPrompt,
    messages,
  });

  const rawReply = response.content[0]?.text ?? "";
  let reply = rawReply
    .replace(/—/g, ",")
    .replace(/ -- /g, ", ")
    .replace(/--/g, ",")
    .replace(/–/g, ",");

  reply = reply.replace(/www\.https:\/\/www\./g, "https://www.");
  reply = reply.replace(/www\.https:\/\//g, "https://");

  // Strip any non-reflectiz.com URLs Gemini may have generated
  reply = reply.replace(/https?:\/\/(?!(?:www\.)?reflectiz\.com)[^\s\)\]"']+/g, "");
  reply = reply.trim();

  // SAME PAGE SAFETY NET: Remove any URL in the reply that matches the visitor's current page
  // Exception: skip replacement on competitor comparison pages (they should self-reference)
  const isComparisonPage = (currentPageUrl || "").includes("reflectiz-vs-") || (currentPageUrl || "").includes("-vs-reflectiz");
  if (currentPageUrl && !isComparisonPage) {
    const urlRegex = /https?:\/\/[^\s)\]"']+/g;
    const normalize = (u) => u.replace(/\/$/, "").toLowerCase();
    const normalizedCurrentPage = normalize(currentPageUrl);
    reply = reply.replace(urlRegex, (foundUrl) => {
      if (normalize(foundUrl) === normalizedCurrentPage) {
        return "https://www.reflectiz.com/learning-hub/";
      }
      return foundUrl;
    });
  }

  // FIX 3: If visitor asked for reading material and reply has no URL, append first retrieved page URL
  const asksForContent = /article|read|blog|resource|learn|case study|research/i.test(message);
  const replyHasUrl = /https?:\/\//.test(reply);
  if (asksForContent && !replyHasUrl && relevantPages.length > 0 && relevantPages[0].pageUrl) {
    reply += ` Read more here: ${relevantPages[0].pageUrl}`;
  }
  messages.push({ role: "assistant", content: reply });

  const existingConversation = await base44.asServiceRole.entities.Conversations.filter({ sessionId });
  const userMessageCount = messages.filter(m => m.role === "user").length;

  const intentClassification = await classifyIntent(messages, currentPageUrl);

  const ctaReached = /meeting|trial|contact/i.test(reply);

  function isCleanMessage(m) {
    const c = m.content || "";
    return !c.includes("[RELEVANT WEBSITE CONTENT]") &&
           !c.includes("[Visitor language") &&
           !c.includes("[Visitor geo");
  }

  const cleanTranscript = messages
    .filter(isCleanMessage)
    .map(m => `${m.role === "user" ? "Visitor" : "Agent"}: ${m.content}`)
    .join("\n\n");

  const lastMessageRole = messages[messages.length - 1]?.role || "assistant";

  function calcOutcome(cta, userMsgs) {
    if (cta) return "CONVERTED";
    if (userMsgs >= 3) return "ENGAGED";
    if (userMsgs >= 1) return "DROPPED";
    return "BOUNCED";
  }

  const conversationOutcome = calcOutcome(ctaReached, userMessageCount);

  if (existingConversation && existingConversation.length > 0) {
    // UPDATE existing conversation - no slack alert
    await base44.asServiceRole.entities.Conversations.update(existingConversation[0].id, {
      conversationTranscript: cleanTranscript,
      intentClassification,
      ctaReached,
      conversationTurns: userMessageCount,
      lastMessageRole,
      conversationOutcome,
      pagesViewed: Array.isArray(pagesViewed) ? pagesViewed.join(",") : (pagesViewed ?? ""),
    });
  } else {
    // CREATE new conversation - fire slack alert
    await base44.asServiceRole.entities.Conversations.create({
      sessionId,
      timestamp: new Date().toISOString(),
      geo: geo ?? "",
      referralSource: referralSource ?? "",
      pagesViewed: Array.isArray(pagesViewed) ? pagesViewed.join(",") : (pagesViewed ?? ""),
      intentClassification,
      conversationTranscript: cleanTranscript,
      ctaReached,
      language: language ?? "",
      conversationTurns: userMessageCount,
      lastMessageRole,
      conversationOutcome,
    });

    fetch("https://api.base44.app/api/apps/69edc5de1c84c71c086635e0/functions/slackAlert", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": req.headers.get("Authorization") ?? "" },
      body: JSON.stringify({
        sessionId,
        geo: geo ?? "",
        intentClassification,
        conversationTurns: 1,
        ctaReached,
        linksClicked: 0,
        referralSource: referralSource ?? "",
        conversationTranscript: cleanTranscript,
        pagesViewed: Array.isArray(pagesViewed) ? pagesViewed.join(",") : (pagesViewed ?? ""),
        conversationOutcome: "BOUNCED",
      }),
    }).catch(err => console.error("slackAlert failed:", err.message));
  }

  return new Response(JSON.stringify({ reply, sessionId }), { headers: CORS_HEADERS });
});