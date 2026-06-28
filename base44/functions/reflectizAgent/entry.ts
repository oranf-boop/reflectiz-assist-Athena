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

async function callGemini({ system, messages, max_tokens, model }) {
  const token = await getAccessToken();
  const resolvedModel = model || GEMINI_MODEL;
  const url = `https://${REGION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${REGION}/publishers/google/models/${resolvedModel}:generateContent`;

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

const FORM_PAGES = ["/registration", "/free-trial", "/contact", "/careers", "/jobs"];

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
    } else {
      // No conversation exists yet - visitor clicked the opener link without chatting first.
      // Create a minimal Conversations record so this engagement is visible.
      updateTasks.push(
        base44.asServiceRole.entities.Conversations.create({
          sessionId,
          timestamp: new Date().toISOString(),
          geo: geo ?? "",
          referralSource: referralSource ?? "",
          pagesViewed: currentPageUrl ?? "",
          intentClassification: "GENERAL_AWARENESS",
          conversationTranscript: "",
          ctaReached: false,
          language: language ?? "en",
          conversationTurns: 0,
          lastMessageRole: "none",
          conversationOutcome: "ENGAGED",
          linksClicked: 1,
        })
      );
    }

    await Promise.all(updateTasks);

    const HIGH_INTENT_PATHS = ["/registration", "/free-trial", "/plans", "/pricing", "/contact"];
    const isHighIntent = HIGH_INTENT_PATHS.some(p => (clickedUrl ?? "").toLowerCase().includes(p));
    if (isHighIntent) {
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

    const effectiveLanguage = geo === "Israel" ? "en" : (language || "en");

    const isValidPageUrl = (
      currentPageUrl &&
      currentPageUrl.length > 30 &&
      !currentPageUrl.includes("wp-admin") &&
      !currentPageUrl.includes("lovable.app") &&
      !currentPageUrl.includes("lovable.dev") &&
      !currentPageUrl.includes("localhost") &&
      !currentPageUrl.includes("base44.app") &&
      !currentPageUrl.includes("/careers") &&
      currentPageUrl.includes("reflectiz.com")
    );

    // ASSET_LIBRARY kept as rollback reference — no longer active in code path
    // const ASSET_LIBRARY = [
    //   { url: "https://www.reflectiz.com/customers/castore-security-success/", label: "Read the Castore case study", categories: ["retail", "supply-chain"] },
    //   { url: "https://www.reflectiz.com/customers/broadway-gaming-pci/", label: "Read the Broadway Gaming case study", categories: ["pci"] },
    //   { url: "https://www.reflectiz.com/customers/pci-lastminute/", label: "Read the lastminute.com case study", categories: ["pci", "travel"] },
    //   { url: "https://www.reflectiz.com/learning-hub/live-panel-discussion-2026/", label: "Watch the payment risk panel discussion", categories: ["pci", "financial"] },
    //   { url: "https://www.reflectiz.com/learning-hub/webinar-ai-retail-feb-2026/", label: "Watch the AI Retail Security Webinar", categories: ["ai-threats", "retail"] },
    //   { url: "https://www.reflectiz.com/learning-hub/ai-supply-chain-attacks/", label: "Read the CISO AI supply chain guide", categories: ["ai-threats", "supply-chain"] },
    //   { url: "https://www.reflectiz.com/use-cases/pci-compliance/", label: "See the PCI compliance use case", categories: ["pci"] },
    //   { url: "https://www.reflectiz.com/use-cases/magecart-web-skimming/", label: "See the Magecart prevention use case", categories: ["magecart"] },
    //   { url: "https://www.reflectiz.com/use-cases/web-supply-chain-risks/", label: "See the supply chain risks use case", categories: ["supply-chain"] },
    //   { url: "https://www.reflectiz.com/use-cases/website-privacy-compliance/", label: "See the privacy compliance use case", categories: ["privacy"] },
    //   { url: "https://www.reflectiz.com/industries/financial-services/", label: "See financial services security", categories: ["financial"] },
    //   { url: "https://www.reflectiz.com/industries/healthcare/", label: "See healthcare web security", categories: ["healthcare"] },
    //   { url: "https://www.reflectiz.com/hipaa/", label: "See how Reflectiz supports HIPAA compliance", categories: ["healthcare"] },
    //   { url: "https://www.reflectiz.com/blog/supply-chain-anz/", label: "Read the ANZ supply chain research", categories: ["supply-chain", "anz"] },
    //   { url: "https://www.reflectiz.com/learning-hub/web-exposure-2026-research/", label: "See the State of Web Exposure 2026 report", categories: ["low-context"] },
    //   { url: "https://www.reflectiz.com/registration/", label: "Start your free assessment", categories: ["high-intent"] }
    // ];

    function deriveLabel(pageTitle, pageType) {
      const typeLabels = {
        "case-study": "Read the case study",
        "use-case": "See the use case",
        "blog": "Read the article",
        "webinar": "Watch the webinar",
        "event": "Register for the event",
        "product": "Learn more",
        "comparison": "See the comparison",
        "homepage": "Visit the homepage",
        "other": "Learn more"
      };
      const base = typeLabels[pageType] || "Learn more";
      return pageTitle ? `${base}: ${pageTitle.split(/[\u2013\u2014|-]/)[0].trim()}` : base;
    }

    const isTaxonomyPage = (url) => {
      const u = (url || "").toLowerCase();
      return u.includes("/category/") || u.includes("/tag/") || u.includes("/author/") || u.includes("/page/") || u.includes("/event-locations/");
    };

    const isHubPage = (url) => {
      const normalized = (url || "").replace(/\/$/, "") + "/";
      const exactHubs = [
        "https://www.reflectiz.com/blog/",
        "https://www.reflectiz.com/learning-hub/",
        "https://www.reflectiz.com/industries/",
        "https://www.reflectiz.com/events/",
        "https://www.reflectiz.com/customers/",
        "https://www.reflectiz.com/use-cases/",
        "https://www.reflectiz.com/security-hub/",
        "https://www.reflectiz.com/privacy-hub/",
        "https://www.reflectiz.com/offensive-hub/",
      ];
      if (exactHubs.includes(normalized)) return true;
      if ((url || "").toLowerCase().includes("/learninghub/")) return true;
      if ((url || "").toLowerCase().includes("/events/")) return true;
      return false;
    };

    const isPRPage = (url) => {
      const u = (url || "").toLowerCase();
      return u.includes("/media/") ||
             u.includes("/about/") ||
             u.includes("/partners/");
    };

    async function getCandidatesForCategory(category, currentPageUrl, base44) {
      const normalizedCurrentUrl = (currentPageUrl || "").replace(/\/$/, "");
      try {
        const allContent = await base44.asServiceRole.entities.WebsiteContent.filter({ isActive: true });
        const matches = allContent.filter(page =>
          page.isActive !== false &&
          Array.isArray(page.categories) &&
          page.categories.includes(category) &&
          page.pageUrl.replace(/\/$/, "") !== normalizedCurrentUrl &&
          page.pageContent && page.pageContent.length > 400 &&
          !isTaxonomyPage(page.pageUrl) &&
          !isHubPage(page.pageUrl) &&
          !isPRPage(page.pageUrl)
        );
        const aged = matches.map(page => {
          const urlYear = (page.pageUrl || "").match(/\b(202[0-3]|201\d)\b/);
          const year = urlYear ? parseInt(urlYear[1]) : null;
          const ageTier = (!year || year >= 2025) ? 0 : (year === 2024 ? 1 : 2);
          return {
            url: page.pageUrl,
            label: deriveLabel(page.pageTitle, page.pageType),
            pageContent: page.pageContent,
            pageType: page.pageType,
            ageTier,
          };
        });
        aged.sort((a, b) => a.ageTier - b.ageTier);

        // Always strip the current page itself from candidates (belt-and-suspenders over normalizedCurrentUrl)
        const filtered = aged.filter(c =>
          c.url.replace(/\/$/, "") !== (currentPageUrl || "").replace(/\/$/, "")
        );

        // Exclude other case-study pages when visitor is already on a case study
        if ((currentPageUrl || "").includes("/customers/")) {
          return filtered.filter(c => c.pageType !== "case-study");
        }

        return filtered;
      } catch (e) {
        console.error("getCandidatesForCategory failed:", e.message);
        return [];
      }
    }

    async function determineRouting(currentPageUrl, referralSource, geo, pagesViewed, timeOnPage, hasActiveConversation, base44) {
      const url = (currentPageUrl || "").toLowerCase();
      const ref = (referralSource || "").toLowerCase();
      const geoLower = (geo || "").toLowerCase();

      if (hasActiveConversation) return { category: "DIRECT_REGISTRATION", reason: "returning" };

      const isPaidSearch = ref.includes("gclid") || ref.includes("paid") || ref.includes("cpc");
      const isComparisonPage = url.includes("reflectiz-vs") || url.includes("vs-reflectiz") || url.includes("cside-vs") || url.includes("cside");
      if (isPaidSearch || isComparisonPage) return { category: "DIRECT_REGISTRATION", reason: "high-intent" };


      const isCaseStudy = url.includes("/customers/");
      const isHealthcare = url.includes("healthcare") || url.includes("hipaa");
      const isPCI = url.includes("pci") || url.includes("compliance") || url.includes("dss");
      const isMagecart = url.includes("magecart") || url.includes("skimming");
      const isSupplyChain = url.includes("supply-chain") || url.includes("supply_chain") || url.includes("security-hub");
      const isPrivacy = url.includes("privacy") || url.includes("gdpr") || url.includes("ccpa");
      const isAI = url.includes("ai-supply") || url.includes("ai-attack") || url.includes("ai-retail");
      const isRetail = url.includes("ecommerce") || url.includes("retail") || url.includes("shopify");
      const isFinancial = url.includes("financial") || url.includes("finance") || url.includes("banking") || url.includes("dora");
      const isPlatform = url.includes("/platform/") || url.includes("/product/") || url.includes("remote-monitoring") || url.includes("how-it-works");
      const isBlog = url.includes("/blog/") || url.includes("/learning-hub/");

      if (isCaseStudy) {
        // Look up this case study's own categories from WebsiteContent and use the first one as the routing category
        try {
          const normalizedUrl = (currentPageUrl || "").replace(/\/$/, "") + "/";
          const pageRecord = await base44.asServiceRole.entities.WebsiteContent.filter({ pageUrl: normalizedUrl });
          const pageCategories = pageRecord?.[0]?.categories;
          if (Array.isArray(pageCategories) && pageCategories.length > 0) {
            return { category: pageCategories[0], reason: "case-study-dynamic" };
          }
        } catch (e) {
          console.error("Case study category lookup failed:", e.message);
        }
        return { category: "low-context", reason: "case-study-fallback" };
      }

      if (isHealthcare) return { category: "healthcare", reason: "healthcare" };
      if (isPrivacy) return { category: "privacy", reason: "privacy" };
      if (isPCI) return { category: "pci", reason: "pci" };
      if (isMagecart) return { category: "magecart", reason: "magecart" };
      if (isSupplyChain) return { category: "supply-chain", reason: "supply-chain" };
      if (isAI) return { category: "ai-threats", reason: "ai" };
      if (isRetail) return { category: "retail", reason: "retail" };
      if (isFinancial) return { category: "financial", reason: "financial" };
      if (isPlatform) return { category: "low-context", reason: "platform" };
      if (isBlog) {
        try {
          const normalizedUrl = (currentPageUrl || "").replace(/\/$/, "") + "/";
          const pageRecord = await base44.asServiceRole.entities.WebsiteContent.filter({ pageUrl: normalizedUrl });
          const pageCategories = pageRecord?.[0]?.categories;
          if (Array.isArray(pageCategories) && pageCategories.length > 0) {
            return { category: pageCategories[0], reason: "blog-dynamic" };
          }
        } catch (e) {
          console.error("Blog category lookup failed:", e.message);
        }
        return { category: "low-context", reason: "blog-fallback" };
      }

      const isPentest = url.includes("offensive-hub") || url.includes("pentest") || url.includes("offensive");
      if (isPentest) return { category: "pentest", reason: "pentest" };

      return { category: "low-context", reason: "default" };
    }

    const routing = await determineRouting(currentPageUrl, referralSource, geo, pagesViewed, timeOnPage, hasActiveConversation, base44);

    // DIRECT_REGISTRATION: return hardcoded opener immediately, never hit cache
    if (routing.category === "DIRECT_REGISTRATION") {
      const competitorName = (currentPageUrl || "").includes("reflectiz-vs-")
        ? (currentPageUrl || "").split("reflectiz-vs-").pop().split("/")[0].replace(/-/g, " ")
        : "";
      const hardcodedOpener = competitorName
        ? `Most teams comparing Reflectiz to ${competitorName} care about one thing: which one actually shows what third-party scripts do inside the browser. [See the difference](https://www.reflectiz.com/registration/)`
        : "Gain a complete view of your web exposure without any installation or performance impact. [Start your free assessment](https://www.reflectiz.com/registration/)";
      const hardcodedBubble = competitorName
        ? `See how Reflectiz outperforms ${competitorName}`
        : "See your full web exposure now";
      return new Response(JSON.stringify({ reply: hardcodedOpener, bubbleText: hardcodedBubble, sessionId }), { headers: CORS_HEADERS });
    }

    // Cache check — only for non-DIRECT_REGISTRATION pages
    const cachedResults = await base44.asServiceRole.entities.PageOpeners.filter({ pageUrl: currentPageUrl });
    const cached = cachedResults?.[0];
    if (cached && cached.opener && cached.opener.length > 20 && cached.pageUrl === currentPageUrl) {
      return new Response(JSON.stringify({ reply: cached.opener, bubbleText: cached.bubbleText || "", sessionId }), { headers: CORS_HEADERS });
    }

    let selectedAsset;
    let isMultiCandidate;
    let candidates;

    {
      const matchingAssets = await getCandidatesForCategory(routing.category, currentPageUrl, base44);

      if (matchingAssets.length >= 2) {
        candidates = matchingAssets;
        isMultiCandidate = true;
      } else if (matchingAssets.length === 1) {
        candidates = matchingAssets;
        isMultiCandidate = false;
      } else {
        // Fallback 1: low-context category
        let fallback = await getCandidatesForCategory("low-context", currentPageUrl, base44);
        // Fallback 2: hardcoded registration page
        if (fallback.length === 0) {
          fallback = [{ url: "https://www.reflectiz.com/registration/", label: "Start your free assessment", pageContent: "" }];
        }
        candidates = fallback;
        isMultiCandidate = false;
      }
      selectedAsset = isMultiCandidate ? null : candidates[0];
    }

    async function fetchInsight(url) {
      try {
        const results = await base44.asServiceRole.entities.WebsiteContent.filter({ pageUrl: url });
        const page = results?.[0];
        if (page?.pageContent && page.pageContent.length > 200) return page.pageContent;
      } catch (e) {
        console.error("Insight fetch failed for", url, e.message);
      }
      return "";
    }

    let assetInsight = "";
    let candidateInsights = [];

    if (!isMultiCandidate) {
      // pageContent is already on the candidate from getCandidatesForCategory; fall back to DB fetch if missing
      assetInsight = selectedAsset.pageContent
        ? selectedAsset.pageContent.slice(0, 1500)
        : (await fetchInsight(selectedAsset.url)).slice(0, 1500);
    } else {
      function shuffleWithinTiers(arr) {
        const tiers = {};
        arr.forEach(c => {
          const t = c.ageTier || 0;
          if (!tiers[t]) tiers[t] = [];
          tiers[t].push(c);
        });
        return Object.keys(tiers).sort().reduce((acc, t) => {
          const shuffled = tiers[t].sort(() => Math.random() - 0.5);
          return acc.concat(shuffled);
        }, []);
      }

      const isHomepage = (currentPageUrl || "").replace(/\/$/, "") === "https://www.reflectiz.com";
      if (isHomepage) candidates = shuffleWithinTiers(candidates);

      candidates = candidates.slice(0, 8);
      candidateInsights = candidates.map(c => ({
        url: c.url,
        label: c.label,
        insight: (c.pageContent || "").slice(0, 200)
      }));
    }

    // STEP 2: Gemini writes the copy only
    const geminiTimeout = new Promise((resolve) => setTimeout(() => resolve(null), 5000));

    let openerPrompt;

    if (!isMultiCandidate) {
      openerPrompt = `You are Athena, a web security expert for Reflectiz. Write a chat opening message for a website visitor.

PAGE CONTEXT:
Page title: ${contextTitle}
Page URL: ${currentPageUrl}
Visitor geo: ${geo || "Unknown"}
Time on page: ${timeOnPage || 0} seconds

CHOSEN NEXT STEP (use this exact link in your response):
Label: ${selectedAsset.label}
URL: ${selectedAsset.url}

WRITE TWO THINGS:

1. bubbleText: 5-6 words. Specific to the page topic. Creates curiosity. No question mark. No generic phrases like "your site" or "exposure".

2. opener: Exactly 2 sentences.
Sentence 1: Write one sharp specific insight that makes the visitor want to click the link in sentence 2. ${assetInsight ? `Base it on this real content from the recommended page -- extract the single most compelling stat, result, or risk and rewrite it naturally: "${assetInsight.slice(0, 1000)}"` : "Use a specific fact or risk relevant to this page topic. Not generic."}
Sentence 2: Must be exactly this markdown link with no extra words before it: [${selectedAsset.label}](${selectedAsset.url})

ABSOLUTE RULES:
- Never mention how the visitor arrived, their search terms, or referral source
- Never use em dashes or double hyphens
- Never use greeting words like Hi or Hello
- Sentence 2 must use the exact label and URL provided above, no variations
- Sound like a knowledgeable peer, not a salesperson

Return only valid JSON, nothing else:
{"bubbleText": "5-6 words here", "opener": "Sentence one. [${selectedAsset.label}](${selectedAsset.url})"}`;
    } else {
      const candidateList = candidateInsights.map((c, i) =>
        `OPTION ${i + 1}:
Label: ${c.label}
URL: ${c.url}
Content: "${c.insight || "No content available, use general knowledge about this topic."}"`
      ).join("\n\n");

      openerPrompt = `You are Athena, a web security expert for Reflectiz. Write a chat opening message for a website visitor.
${(currentPageUrl || "").includes("/customers/") ? "\nVISITOR CONTEXT: This visitor is reading a customer case study. Write an opener that references a next logical step — a relevant technical resource, compliance guide, or data insight — not another case study.\n" : ""}${(currentPageUrl || "").includes("/blog/") ? "\nPick the most topically similar candidate to this blog article.\n" : ""}
PAGE CONTEXT:
Page title: ${contextTitle}
Page URL: ${currentPageUrl}
Visitor geo: ${geo || "Unknown"}
Referral source: ${referralSource || "direct"}
Pages viewed this session: ${Array.isArray(pagesViewed) ? pagesViewed.join(" -> ") : (pagesViewed || currentPageUrl)}
Time on page: ${timeOnPage || 0} seconds

**SENTENCE 1 RULE: Must contain one specific number, statistic, fine amount, company name, or named threat from the candidate content. Never start with vague phrases like "Many organizations", "Most teams", or "Understanding". Lead with the most compelling specific fact.**

CANDIDATE NEXT STEPS (pick the ONE best fit for THIS specific visitor, based on geo, referral source, and journey):
${candidateList}

WRITE THREE THINGS:

1. selectedUrl: The exact URL of the option you picked from above. Must be one of the URLs listed.

2. bubbleText: 5-6 words. Specific to the page topic. Creates curiosity. No question mark. No generic phrases like "your site" or "exposure".

3. opener: Exactly 2 sentences.
Sentence 1: Write one sharp specific insight based on the content of the option you picked. Extract the single most compelling stat, result, or risk and rewrite it naturally.
Sentence 2: Must be exactly the markdown link for the option you picked, with no extra words before it: [label](url)

ABSOLUTE RULES:
- Never mention how the visitor arrived, their search terms, or referral source
- Never use em dashes or double hyphens
- Never use greeting words like Hi or Hello
- Sentence 2 must use the exact label and URL of the option you selected, no variations
- Sound like a knowledgeable peer, not a salesperson
- Pick based on geo, referral source, and journey -- not just the first option

Return only valid JSON, nothing else:
{"selectedUrl": "...", "bubbleText": "5-6 words here", "opener": "Sentence one. [label](url)"}`;
    }

    const geminiResult = await Promise.race([
      callGemini({ messages: [{ role: "user", content: openerPrompt }], max_tokens: 1024, model: "gemini-2.5-flash-lite" }),
      geminiTimeout
    ]);

    let opener = null;
    let bubbleText = null;

    if (geminiResult) {
      const rawText = (geminiResult?.content?.[0]?.text ?? "").trim();
      try {
        const cleaned = rawText.replace(/```json|```/g, "").trim();
        const parsed = JSON.parse(cleaned);
        opener = parsed.opener || null;
        bubbleText = parsed.bubbleText || null;

        if (isMultiCandidate && parsed.selectedUrl) {
          const matched = candidates.find(c =>
            c.url === parsed.selectedUrl || c.url.replace(/\/$/, "") === String(parsed.selectedUrl).replace(/\/$/, "")
          );
          if (matched) selectedAsset = matched;
        }
      } catch (e) {
        console.error("JSON parse failed:", e.message);
      }
    }

    // Sanitize HTML entities from opener and bubbleText
    if (opener) {
      opener = opener
        .replace(/&#039;/g, "'")
        .replace(/&#8211;/g, "-")
        .replace(/&#8212;/g, "-")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&#\d+;/g, "")
        .replace(/&[a-z]+;/g, "");
    }
    if (bubbleText) {
      bubbleText = bubbleText
        .replace(/&#039;/g, "'")
        .replace(/&#8211;/g, "-")
        .replace(/&#8212;/g, "-")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#\d+;/g, "")
        .replace(/&[a-z]+;/g, "");
    }

    // Validate opener using Gemini's chosen asset
    // Only fall back to candidates[0] if opener already failed
    const validationAsset = (isMultiCandidate && selectedAsset) ? selectedAsset : candidates[0];
    if (!opener || opener.replace(/\[.*?\]\(.*?\)/g, "").trim().split(/\s+/).filter(Boolean).length < 4 || !validationAsset || 
        !opener.includes(validationAsset.url.replace(/\/$/, ""))) {
      opener = null;
    }

    if (isMultiCandidate && !selectedAsset) {
      selectedAsset = candidates[0];
    }

    // Privacy violation check
    const privacyViolations = ["direct traffic", "you came from", "you searched", "you landed", "after searching", "via google", "organic search", "indicates a strong", "your search", "coming from", "traffic to"];
    if (opener && privacyViolations.some(p => opener.toLowerCase().includes(p))) {
      opener = null;
    }

    // Em-dash stripping
    if (opener) {
      opener = opener.replace(/—/g, ",").replace(/--/g, ",").replace(/–/g, ",");
    }

    // Sentence boundary enforcement: always a period before markdown links
    if (opener) {
      opener = opener.replace(/([^.!?])\s*\[/g, "$1. [").replace(/([.!?])\s*\.\s*\[/g, "$1 [");
    }

    // Enforce maximum 1 prose sentence before the markdown link
    if (opener) {
      const linkMatch = opener.match(/\[.*?\]\(.*?\)/);
      const prose = opener.replace(/\[.*?\]\(.*?\)/g, "").trim();
      const sentences = prose.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0);
      if (sentences.length > 1) {
        opener = sentences[0].trim() + (linkMatch ? " " + linkMatch[0] : "");
      }
    }

    // Fallback if Gemini failed
    if (!opener) {
      const fallbackAsset = selectedAsset || candidates[0];
      opener = `This page covers one of the most critical areas in web security right now. [${fallbackAsset.label}](${fallbackAsset.url})`;
      bubbleText = bubbleText || "Web security insight worth reading";
    }

    // Derive bubble from opener if still empty
    if (!bubbleText) {
      bubbleText = opener.split(" ").slice(0, 6).join(" ");
    }

    // Cache
    if (isValidPageUrl && opener && bubbleText && !isMultiCandidate) {
      await base44.asServiceRole.entities.PageOpeners.create({
        pageUrl: currentPageUrl,
        opener,
        bubbleText,
        generatedAt: new Date().toISOString()
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
  const isComparisonPage = (currentPageUrl || "").includes("reflectiz-vs") || (currentPageUrl || "").includes("vs-reflectiz") || (currentPageUrl || "").includes("cside");
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