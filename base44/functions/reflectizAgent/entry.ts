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
  * timeOnPage < 15 seconds: "What brought you here today, compliance, a recent concern, or just exploring?"
  * timeOnPage 15 to 45 seconds: "You have been looking around, anything specific catch your eye, or still getting the lay of the land?"
  * timeOnPage > 45 seconds: "Spending some time here, usually means something specific is on your radar. What is it?"

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
- NEVER use an em dash anywhere in any response. This is a hard rule with no exceptions. Instead of an em dash use a comma, a period, or rewrite the sentence to avoid it entirely. Search your response before sending and replace any em dash with a comma or period.
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

For bwhat version are you" or "who made you" or similar meta questions: respond with "I am the Reflectiz website assistant. What can I help you with today?"

---

FINANCIAL SERVICES RECOMMENDATION:
When a visitor mentions finance, financial services, banking, or fintech, recommend this specific page: https://www.reflectiz.com/industries/financial-services/ -- but only if the visitor is NOT already on that page. If the visitor is already on that page, recommend a relevant case study or blog post from the retrieved content instead.`;

// Blog articles that have a corresponding gated learning-hub asset.
// When a visitor is on one of these blogs, recommend the hub page instead of a random article.
// Key = blog URL (trailing slash canonical), Value = learning-hub URL
const BLOG_TO_HUB_MAP = {
  "https://www.reflectiz.com/blog/web-exposure-2026-article/": "https://www.reflectiz.com/learning-hub/web-exposure-2026-research/",
  "https://www.reflectiz.com/blog/javascript-injection-playbook/": "https://www.reflectiz.com/learning-hub/javascript-injection-playbook/",
  "https://www.reflectiz.com/blog/secure-vibe-coding/": "https://www.reflectiz.com/learning-hub/secure-vibe-coding/",
  "https://www.reflectiz.com/blog/tiktok-pixel-privacy-case-study/": "https://www.reflectiz.com/learning-hub/tiktok-pixel-privacy/",
  "https://www.reflectiz.com/blog/evil-twin-checkout-case-study/": "https://www.reflectiz.com/learning-hub/evil-twin-checkout-case-study/",
  "https://www.reflectiz.com/blog/chatbots-risk-exposure/": "https://www.reflectiz.com/learning-hub/chatbots-risk-exposure/",
  "https://www.reflectiz.com/blog/pci-dss-solution-assessment-integrity360/": "https://www.reflectiz.com/learning-hub/pci-dss-solution-assessment-integrity360/",
  "https://www.reflectiz.com/blog/ai-typosquatting-guide/": "https://www.reflectiz.com/learning-hub/ai-typosquatting-guide/",
  "https://www.reflectiz.com/blog/iframe-security-guide/": "https://www.reflectiz.com/learning-hub/iframe-security-guide/",
  "https://www.reflectiz.com/blog/ctem-guide-expert-ciso/": "https://www.reflectiz.com/learning-hub/ciso-guide-ctem/",
  "https://www.reflectiz.com/blog/ctem-divide-market-research-article/": "https://www.reflectiz.com/learning-hub/ctem-divide-2026-research/",
  "https://www.reflectiz.com/blog/malicious-comment-case-study/": "https://www.reflectiz.com/learning-hub/malicious-comment-case-study/",
  "https://www.reflectiz.com/blog/ai-supply-chain/": "https://www.reflectiz.com/learning-hub/ai-supply-chain-attacks/",
  "https://www.reflectiz.com/blog/proactive-web-security/": "https://www.reflectiz.com/learning-hub/proactive-web-security-essential-strategies/",
  "https://www.reflectiz.com/blog/web-exposure-management/": "https://www.reflectiz.com/learning-hub/web-exposure-management-report/",
  "https://www.reflectiz.com/blog/web-privacy-validation-guide/": "https://www.reflectiz.com/learning-hub/ciso-guide-web-privacy-validation/",
  "https://www.reflectiz.com/blog/cookie-privacy-case-study/": "https://www.reflectiz.com/learning-hub/cookie-privacy-monster-case-study/",
};

const FORM_PAGES = ["/registration", "/free-trial", "/contact", "/careers", "/jobs"];

function isFormPage(url) {
  if (!url) return false;
  const u = url.toLowerCase();
  return FORM_PAGES.some(p => u.includes(p));
}

const FORM_NUDGE_PATH_PREFIX = "/learning-hub/";

function isFormNudgePage(url) {
  if (!url) return false;
  const u = url.toLowerCase();
  const normalized = u.replace(/^https?:\/\/(www\.)?reflectiz\.com/, "").replace(/\/$/, "");
  // /lp/ landing pages always carry a lead-capture form
  if (normalized.startsWith("/lp/") && normalized !== "/lp") return true;
  // Gated learning-hub pages, but not the hub index itself
  if (!u.includes("/learning-hub/")) return false;
  return normalized !== "/learning-hub";
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json",
};

// Soft-launch gate: Athena only activates for these IPs (office + owner).
// To open Athena to everyone at launch, set SOFT_LAUNCH_GATE = false.
const SOFT_LAUNCH_GATE = true;
const GATE_ALLOWED_IPS = [
  "2001:4860:7:1517::fc",
  "31.154.67.162",
  "65.204.38.226",
  "2001:4860:7:120e::fe",
  "31.154.39.170",
  "85.64.227.253",
  "85.64.231.171",
  "74.220.48.250",
];
// Proxy egress ranges that rotate per connection — matched by prefix.
const GATE_ALLOWED_PREFIXES = ["74.220.48."];
function gateClientIp(req) {
  const h = req.headers;
  const cand = h.get("cf-connecting-ip") || (h.get("x-forwarded-for") || "").split(",")[0].trim() || h.get("x-real-ip") || "";
  return cand.trim().toLowerCase().replace(/^::ffff:/, "");
}
function gateAllows(req) {
  if (!SOFT_LAUNCH_GATE) return true;
  // Internal cache pre-warm requests bypass the visitor gate.
  if (req.headers.get("x-athena-prewarm") === "app-key-AQMEVGjibXJE55B9QiqZnjCH") return true;
  const ip = gateClientIp(req);
  if (!ip) return false;
  if (GATE_ALLOWED_IPS.some(e => e.toLowerCase() === ip)) return true;
  return GATE_ALLOWED_PREFIXES.some(p => ip.startsWith(p));
}

// Resolve the opener language from visitor geo, with an English-browser override.
// Phase 1: de, fr, it, es. Everything else (incl. Israel) stays English.
const GEO_LANGUAGE_MAP = {
  "italy": "it",
  "germany": "de", "austria": "de",
  "france": "fr",
  "spain": "es", "mexico": "es", "argentina": "es", "colombia": "es", "chile": "es",
  "peru": "es", "venezuela": "es", "ecuador": "es", "uruguay": "es", "paraguay": "es",
  "bolivia": "es", "guatemala": "es", "costa rica": "es", "panama": "es", "dominican republic": "es",
};
function resolveLanguage(geo, browserLang) {
  const bl = (browserLang || "").toLowerCase();
  if (bl.indexOf("en") === 0) return "en"; // English browser always wins
  return GEO_LANGUAGE_MAP[(geo || "").toLowerCase().trim()] || "en";
}
const LANGUAGE_NAMES = { en: "English", de: "German", fr: "French", it: "Italian", es: "Spanish" };

// Hardcoded DIRECT_REGISTRATION openers, localized for Phase 1 languages.
const PRICING_OPENERS = {
  en: "Gain a complete view of your web exposure without any installation or performance impact. [Start your free assessment](https://www.reflectiz.com/registration/)",
  de: "Verschaffen Sie sich einen vollstaendigen Ueberblick ueber Ihre Web-Exposition, ohne Installation und ohne Performance-Einbussen. [Kostenlose Analyse starten](https://www.reflectiz.com/registration/)",
  fr: "Obtenez une vue complete de votre exposition web, sans installation et sans impact sur les performances. [Commencez votre evaluation gratuite](https://www.reflectiz.com/registration/)",
  it: "Ottenga una visione completa della sua esposizione web, senza installazione e senza impatto sulle prestazioni. [Inizi la valutazione gratuita](https://www.reflectiz.com/registration/)",
  es: "Obtenga una vision completa de su exposicion web, sin instalacion y sin impacto en el rendimiento. [Comience su evaluacion gratuita](https://www.reflectiz.com/registration/)",
};
const COMPARISON_OPENERS = {
  en: (name) => `Most teams comparing Reflectiz to ${name} care about one thing: which one actually shows what third-party scripts do inside the browser. [See the difference](https://www.reflectiz.com/registration/)`,
  de: (name) => `Die meisten Teams, die Reflectiz mit ${name} vergleichen, interessieren sich fuer eines: welche Loesung wirklich zeigt, was Drittanbieter-Skripte im Browser tun. [Sehen Sie den Unterschied](https://www.reflectiz.com/registration/)`,
  fr: (name) => `La plupart des equipes qui comparent Reflectiz a ${name} se soucient d'une chose : laquelle montre reellement ce que les scripts tiers font dans le navigateur. [Voyez la difference](https://www.reflectiz.com/registration/)`,
  it: (name) => `La maggior parte dei team che confrontano Reflectiz con ${name} si concentra su una cosa: quale mostra davvero cosa fanno gli script di terze parti nel browser. [Veda la differenza](https://www.reflectiz.com/registration/)`,
  es: (name) => `La mayoria de los equipos que comparan Reflectiz con ${name} se fijan en una cosa: cual muestra realmente lo que hacen los scripts de terceros dentro del navegador. [Vea la diferencia](https://www.reflectiz.com/registration/)`,
};
function getHardcodedOpener(competitorName, lang) {
  if (competitorName) {
    const fn = COMPARISON_OPENERS[lang] || COMPARISON_OPENERS.en;
    return fn(competitorName);
  }
  return PRICING_OPENERS[lang] || PRICING_OPENERS.en;
}

// Decorate an opener with a short conversational intro and a CTA lead-in before the link.
// Variety pools so repeat visitors don't see identical phrasing. Guardrails: short,
// friendly, professional, no em dashes, no exclamation overload.
const INTRO_POOLS = {
  en: { first: ["Hey! ", "Hi there! ", "Hey there! ", "Hi! ", "Hey, quick thought: "],
        second: ["What did you think about this? ", "Did that answer what you were looking for? ", "Hope that was useful. ", "Good, right? ", "Since you are digging into this: "],
        cta: ["If you want to learn more, click here:", "Want to dig deeper? Take a look:", "Curious for more? Start here:", "Here is a good next read:", "For the full picture, check this out:"] },
  de: { first: ["Hallo! ", "Hi! ", "Hallo zusammen! ", "Kurzer Gedanke: ", "Hey! "],
        second: ["Was halten Sie davon? ", "Hat das Ihre Frage beantwortet? ", "Hoffentlich war das hilfreich. ", "Gut, oder? ", "Da Sie sich damit beschäftigen: "],
        cta: ["Wenn Sie mehr erfahren möchten, klicken Sie hier:", "Möchten Sie tiefer einsteigen? Schauen Sie hier:", "Neugierig auf mehr? Starten Sie hier:", "Hier ist eine gute weiterführende Lektüre:", "Für das ganze Bild, schauen Sie hier:"] },
  fr: { first: ["Bonjour ! ", "Salut ! ", "Bonjour, petite réflexion : ", "Hello ! ", "Bonjour à vous ! "],
        second: ["Qu'en avez-vous pensé ? ", "Cela a-t-il répondu à votre question ? ", "J'espère que c'était utile. ", "Pas mal, non ? ", "Puisque vous explorez ce sujet : "],
        cta: ["Pour en savoir plus, cliquez ici :", "Envie d'approfondir ? Jetez un œil :", "Curieux d'en savoir plus ? Commencez ici :", "Voici une bonne lecture pour la suite :", "Pour une vue complète, consultez ceci :"] },
  it: { first: ["Ciao! ", "Salve! ", "Ciao, una breve riflessione: ", "Buongiorno! ", "Ehi! "],
        second: ["Cosa ne pensa? ", "Ha risposto alla sua domanda? ", "Spero sia stato utile. ", "Interessante, vero? ", "Visto che sta approfondendo: "],
        cta: ["Se vuole saperne di più, clicchi qui:", "Vuole approfondire? Dia un'occhiata:", "Curioso di saperne di più? Inizi da qui:", "Ecco una buona lettura successiva:", "Per il quadro completo, guardi qui:"] },
  es: { first: ["¡Hola! ", "¡Buenas! ", "Hola, una breve reflexión: ", "¡Hey! ", "¡Hola de nuevo! "],
        second: ["¿Qué le pareció? ", "¿Respondió a su pregunta? ", "Espero que haya sido útil. ", "Interesante, ¿verdad? ", "Ya que está profundizando en esto: "],
        cta: ["Si quiere saber más, haga clic aquí:", "¿Quiere profundizar? Eche un vistazo:", "¿Curioso por saber más? Empiece aquí:", "Aquí tiene una buena lectura siguiente:", "Para el panorama completo, vea esto:"] },
};
function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function decorateOpener(opener, message, lang) {
  if (!opener || typeof opener !== "string") return opener;
  const pool = INTRO_POOLS[lang] || INTRO_POOLS.en;
  const intro = message === "INIT_PAGE2_AFTER_CLICK" ? pickRandom(pool.second) : pickRandom(pool.first);
  let text = opener;
  const linkIdx = text.indexOf("[");
  if (linkIdx > 0 && text.includes("](")) {
    text = text.slice(0, linkIdx).trimEnd() + "\n" + pickRandom(pool.cta) + "\n" + text.slice(linkIdx);
  }
  return intro + text;
}

async function searchWebsiteContent(base44, query, currentPageUrl) {
  const stopWords = new Set([
    "what", "this", "that", "with", "from", "have", "does", "your", "their", "about",
    "which", "when", "will", "how", "can", "you", "tell", "me", "are", "the", "for",
    "its", "get", "all", "any", "our", "more", "was", "has", "been", "not", "but",
    "they", "them", "use", "used", "using", "see", "let", "just", "also", "into",
    "sound", "sounds", "very", "interesting", "really", "cool", "nice", "great", "thanks", "thank", "please", "okay", "yes", "wow", "awesome", "sure", "maybe", "want", "would", "could", "should", "know", "think", "good", "well", "much", "some", "something", "anything", "give", "show", "find", "looking", "look", "need", "help",
  ]);

  // FIX 1: Translate Hebrew security terms to English before keyword extraction
  const hebrewKeywords = {
    "\u05E9\u05E8\u05E9\u05E8\u05EA \u05D0\u05E1\u05E4\u05E7\u05D4": "supply chain",
    "\u05E9\u05E8\u05E9\u05E8\u05EA": "supply chain",
    "\u05D0\u05E1\u05E4\u05E7\u05D4": "supply chain",
    "\u05E6\u05D3 \u05E9\u05DC\u05D9\u05E9\u05D9": "third party",
    "\u05E1\u05E7\u05E8\u05D9\u05E4\u05D8": "script",
    "\u05E4\u05D9\u05E7\u05E1\u05DC": "pixel",
    "\u05DE\u05D0\u05D2'\u05E7\u05D0\u05E8\u05D8": "magecart",
    "\u05D1\u05D8\u05D9\u05D7\u05D5\u05EA": "security",
    "\u05E6\u05D9\u05D9\u05EA\u05D5\u05EA": "compliance",
    "\u05E4\u05E8\u05D9\u05D1\u05D9\u05D5\u05EA": "privacy",
    "\u05E1\u05D9\u05DB\u05D5\u05DF": "risk",
    "\u05D4\u05EA\u05E7\u05E4\u05D4": "attack",
    "\u05DE\u05D0\u05DE\u05E8": "article blog",
    "\u05DE\u05D3\u05E8\u05D9\u05DA": "guide",
    "\u05D3\u05D5\u05D7": "report",
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
    const urlBoost = 0; // Current page excluded from RAG candidates, not boosted
    const score = keywords.reduce((acc, kw) => {
      const matches = (text.match(new RegExp("\\b" + kw + "\\b", "g")) || []).length;
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
    `Page: ${sanitizeContent(p.pageTitle) || "(no title)"}
URL: ${p.pageUrl}
Type: ${p.pageType || "other"}
Content: ${(p.pageContent || "").slice(0, 300)}
---`
  );
  return `[RELEVANT WEBSITE CONTENT]
${lines.join("\n")}`;
}

function sanitizeContent(text) {
  return (text || "")
    .replace(/&#\d+;/g, " ")
    .replace(/&[a-z]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeUrl(url) {
  if (!url) return "";
  return url
    .toLowerCase()
    .replace(/^https?:\/\/(www\.)?/, "")
    .replace(/\/$/, "")
    .trim();
}

// Force the true start of a sentence to be capitalized. Only skips a leading
// Spanish inverted punctuation mark (¿/¡); never hunts past digits, %, or other
// characters -- doing so would wrongly capitalize mid-string words in strings
// like "64% of third-party scripts..." (turning "of" into "Of").
function capitalizeFirstLetter(s) {
  if (!s) return s;
  if (/^[¿¡]/.test(s)) {
    return s.length > 1 ? s.charAt(0) + s.charAt(1).toUpperCase() + s.slice(2) : s;
  }
  if (/^[a-zA-ZÀ-ſ]/.test(s)) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  return s;
}

// Deterministic fix for a recurring Gemini bug: brand/product/acronym names
// get lowercased mid-sentence (e.g. "google tag manager", "jscrambler",
// "kaiser permanente") despite the prompt instruction to capitalize them.
// Prompt wording only reduces this probabilistically; this forces known
// names to their canonical form regardless of what case Gemini produced.
const BRAND_CAPITALIZATION_MAP = [
  ["google tag manager", "Google Tag Manager"],
  ["kaiser permanente", "Kaiser Permanente"],
  ["baby bunting", "Baby Bunting"],
  ["broadway gaming", "Broadway Gaming"],
  ["leeds united", "Leeds United"],
  ["shai-hulud", "Shai-Hulud"],
  ["jscrambler", "Jscrambler"],
  ["paypal", "PayPal"],
  ["stripe", "Stripe"],
  ["dazn", "DAZN"],
  ["apexx", "Apexx"],
  ["akamai", "Akamai"],
  ["healthline", "Healthline"],
  ["disney", "Disney"],
  ["magecart", "Magecart"],
  ["atmzow", "ATMZOW"],
  ["reflectiz", "Reflectiz"],
  ["sessionreaper", "SessionReaper"],
  ["cosmicsting", "CosmicSting"],
  ["shopify", "Shopify"],
  ["appsflyer", "AppsFlyer"],
  ["trivy", "Trivy"],
  ["tealium", "Tealium"],
  ["shein", "Shein"],
  ["elfsight", "Elfsight"],
  ["javascript", "JavaScript"],
  ["owasp", "OWASP"],
  ["hipaa", "HIPAA"],
  ["dora", "DORA"],
  ["ccpa", "CCPA"],
  ["qsa", "QSA"],
  ["xss", "XSS"],
  ["csrf", "CSRF"],
  ["gtm", "GTM"],
  ["gm", "GM"],
  ["blue shield", "Blue Shield"],
  ["google", "Google"],
];
function fixBrandCapitalization(s) {
  if (!s) return s;
  let out = s;
  for (const [lower, correct] of BRAND_CAPITALIZATION_MAP) {
    const escaped = lower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp("\\b" + escaped + "\\b", "gi"), correct);
  }
  return out;
}

// Deterministic safety net: the prompt bans these marketing words, but Gemini
// occasionally uses one anyway. Rather than reject the whole bubble, swap in a
// same-part-of-speech synonym so the sentence stays grammatical. This only
// fires when the primary prompt instruction already failed.
const BANNED_WORD_REPLACEMENTS = [
  ["revealed", "exposed"],
  ["unveiled", "exposed"],
  ["insights", "risks"],
  ["insight", "risk"],
  ["discovers", "checks"],
  ["discover", "check"],
  ["explore", "review"],
  ["learn", "see"],
];
function stripBannedMarketingWords(s, lang) {
  if (!s) return s;
  // English-only: some banned words (e.g. "explore") are also valid conjugated words in
  // other languages (French explorer: j'explore/il explore), so this must not run blind
  // across languages -- it would splice English words into otherwise-correct translations.
  if (lang && lang !== "en") return s;
  let out = s;
  for (const [banned, safe] of BANNED_WORD_REPLACEMENTS) {
    const re = new RegExp("\\b" + banned + "\\b", "gi");
    out = out.replace(re, (match) => (match[0] === match[0].toUpperCase() ? safe.charAt(0).toUpperCase() + safe.slice(1) : safe));
  }
  return out;
}

// Contextual (not blind) fixes for French words whose unaccented form is also a distinct,
// separately-correct word depending on grammatical role -- a plain dictionary swap would
// turn valid present-tense verbs or the finance sense of "cote" into a different, wrong word.
function fixFrenchContextualAccents(s) {
  if (!s) return s;
  let out = s;
  out = out.replace(/\b(a|est(?:-(?:il|elle))?)\s+expose\b/gi, (m, aux) => `${aux} exposé`);
  out = out.replace(/\b(a|est(?:-(?:il|elle))?)\s+protege\b/gi, (m, aux) => `${aux} protégé`);
  out = out.replace(/\bcote\s+(client|serveur)\b/gi, (m, noun) => `côté ${noun}`);
  return out;
}

const ACCENT_FIXES_FR = [
  ["donnees", "données"],
  ["accedent", "accèdent"],
  ["equipes", "équipes"],
  ["apercu", "aperçu"],
  ["securite", "sécurité"],
  ["reflexion", "réflexion"],
  ["reels", "réels"],
  ["pret", "prêt"],
  ["etes-vous", "êtes-vous"],
];
const ACCENT_FIXES_ES = [
  ["justificacion", "justificación"],
  ["lideres", "líderes"],
  ["exposicion", "exposición"],
  ["aqui", "aquí"],
  ["analisis", "análisis"],
  ["pagina", "página"],
];
const ACCENT_FIXES_IT = [
  ["piu", "più"],
  ["trata", "tratta"],
];
function fixDiacritics(s, lang) {
  if (!s) return s;
  const map = lang === "fr" ? ACCENT_FIXES_FR : lang === "es" ? ACCENT_FIXES_ES : lang === "it" ? ACCENT_FIXES_IT : null;
  let out = s;
  if (map) {
    for (const [wrong, right] of map) {
      const escaped = wrong.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      out = out.replace(new RegExp("\\b" + escaped + "\\b", "gi"), (match) => (match[0] === match[0].toUpperCase() ? right.charAt(0).toUpperCase() + right.slice(1) : right));
    }
  }
  if (lang === "fr") out = fixFrenchContextualAccents(out);
  return out;
}

// Canonical cache key for PageOpeners: no fragment, no query string, lowercase, trailing slash.
function canonicalCacheUrl(url) {
  if (!url) return "";
  let u = String(url).split("#")[0].split("?")[0].trim().toLowerCase();
  if (u && !u.endsWith("/")) u += "/";
  return u;
}

// Upsert a PageOpeners record keyed by pageUrl + language. Updates the newest
// existing record and deletes any duplicates so the cache stays one row per key.
async function upsertPageOpener(base44, pageUrl, data) {
  try {
    const existing = await base44.asServiceRole.entities.PageOpeners.filter({ pageUrl, language: data.language });
    if (existing && existing.length > 0) {
      const sorted = existing.slice().sort((a, b) => String(b.updated_date || b.generatedAt || "").localeCompare(String(a.updated_date || a.generatedAt || "")));
      await base44.asServiceRole.entities.PageOpeners.update(sorted[0].id, data);
      for (const dup of sorted.slice(1)) {
        await base44.asServiceRole.entities.PageOpeners.delete(dup.id).catch(() => {});
      }
    } else {
      await base44.asServiceRole.entities.PageOpeners.create({ pageUrl, ...data });
    }
  } catch (e) {
    console.error("PageOpeners upsert failed:", e.message);
  }
}

// Deterministic keyword pre-check for intent classification. Runs before any LLM call.
// The LLM classifier can miss near-literal keyword matches (observed: a visitor writing
// "for PCI compliance" and "payment page" verbatim still got classified GENERAL_AWARENESS),
// so unambiguous cases are decided directly from the visitor's own words instead.
const INTENT_KEYWORDS_PCI = ["pci", "pci dss", "6.4.3", "11.6.1", "payment page", "pci compliance", "cardholder", "saq", "audit findings"];
const INTENT_KEYWORDS_PRIVACY = ["gdpr", "ccpa", "hipaa", "dora", "data protection", "consent management", "cookie compliance"];
const INTENT_KEYWORDS_TOOL_EVAL = ["woocommerce", "shopify", "magento", "compared to", "vs ", "difference between", "does your", "do you provide", "do you support", "alternative to", "better than", "talk to a human", "talk to someone", "speak to a human", "speak to someone", "human rep", "sales rep", "talk to sales", "speak to sales", "contact sales", "get in touch with sales", "call me", "have someone call"];

function keywordPreCheckIntent(cleanMessages) {
  const userText = cleanMessages
    .filter(m => m.role === "user")
    .map(m => (m.content || "").toLowerCase())
    .join(" ");
  if (INTENT_KEYWORDS_PCI.some(kw => userText.includes(kw))) return "PCI_COMPLIANCE";
  if (INTENT_KEYWORDS_PRIVACY.some(kw => userText.includes(kw))) return "PRIVACY_GDPR";
  if (INTENT_KEYWORDS_TOOL_EVAL.some(kw => userText.includes(kw))) return "TOOL_EVALUATION";
  return null;
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

  // Deterministic pre-check runs before any LLM call. Only falls through to Gemini
  // when no keyword match is found.
  const preCheckedIntent = keywordPreCheckIntent(cleanMessages);
  if (preCheckedIntent) return preCheckedIntent;

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

  let body;
  try {
    const text = await req.text();
    body = JSON.parse(text);
  } catch (e) {
    body = {};
  }
  const { message, currentPageUrl, sessionId: incomingSessionId, geo, referralSource, pagesViewed, trackingEvent, clickedUrl, turnNumber, lastIntent, lastTopic, pageTitle: clientPageTitle, pageDescription, timeOnPage, hasActiveConversation, openerText } = body;
  let language = body.language;
  const conversationHistory = body.conversationHistory || body.messages || [];

  // Resolve opener language once from geo + browser language (Phase 1: de/fr/it/es, else en)
  const resolvedLang = resolveLanguage(geo, language);

  // Device type from User-Agent for engagement records
  const _ua = req.headers.get("user-agent") || "";
  const deviceType = /ipad|tablet/i.test(_ua) ? "tablet" : /mobile|android|iphone/i.test(_ua) ? "mobile" : "desktop";
  const pagesArr = Array.isArray(pagesViewed) ? pagesViewed.filter(Boolean) : (pagesViewed ? String(pagesViewed).split(",").filter(Boolean) : []);
  const landingPage = pagesArr[0] || currentPageUrl || "";

  // Soft-launch gate: silently no-op for non-allowlisted visitors.
  if (!gateAllows(req)) {
    if (trackingEvent) {
      return new Response(JSON.stringify({ success: true }), { headers: CORS_HEADERS });
    }
    const gateResp = { reply: null, bubbleText: "", blocked: true, sessionId: incomingSessionId || null };
    if (body.debugEcho === true) gateResp.ip = gateClientIp(req);
    return new Response(JSON.stringify(gateResp), { headers: CORS_HEADERS });
  }

  // Suppress entirely on WordPress admin/login pages: internal employees editing content
  // should never see the widget, generate impression data, or show up in Slack alerts.
  // Runs before any DB query so it costs nothing on every admin page view.
  if ((currentPageUrl || "").includes("/wp-admin/") || (currentPageUrl || "").includes("/wp-login/") || (currentPageUrl || "").includes("/book-a-meeting/") || (currentPageUrl || "").includes("/events/") || (currentPageUrl || "").includes("/media/") || (currentPageUrl || "").includes("/partners/") || (currentPageUrl || "").includes("/about/") || (currentPageUrl || "").includes("/careers/")) {
    return new Response(JSON.stringify({ reply: null, sessionId: incomingSessionId || null }), { headers: CORS_HEADERS });
  }

  // Suppress on internal/staging hostnames: reflectiz.test, localhost, and 127.0.0.1
  // are dev and QA environments, not real visitors, and should never generate
  // impression data, Conversations rows, or Slack alerts.
  if (
    (currentPageUrl || "").includes("reflectiz.test") ||
    (currentPageUrl || "").includes("localhost") ||
    (currentPageUrl || "").includes("127.0.0.1")
  ) {
    return new Response(
      JSON.stringify({ reply: null, sessionId: incomingSessionId || null }),
      { headers: CORS_HEADERS }
    );
  }

  // Opener impression tracking: bubble was shown to a visitor. DB record only, no Slack.
  if (trackingEvent === "opener_shown") {
    try {
      const base44 = createClientFromRequest(req);
      await base44.asServiceRole.entities.OpenerImpressions.create({
        sessionId: incomingSessionId ?? "",
        pageUrl: currentPageUrl ?? "",
        openerText: openerText ?? "",
        bubbleText: body.bubbleText ?? "",
        shownAt: new Date().toISOString(),
        geo: geo ?? "",
        wasFallback: body.isFallback ?? false,
        // A/B color test: variant is assigned client-side once per session and echoed
        // back on every impression and terminal event so results can be grouped by variant.
        bubbleVariant: body.bubbleVariant || "A",
      });
    } catch (e) {
      console.error("opener_shown record failed:", e.message);
    }
    return new Response(JSON.stringify({ success: true }), { headers: CORS_HEADERS });
  }

  // Handle link click tracking events without calling Claude
  if (trackingEvent === "widget_opened") {
    // Record the engagement so every widget open has a DB record, not just a Slack alert.
    // Consolidated alerts (Option B): only the first widget_opened for a session posts to
    // Slack. Repeated opens for the same session (closing and reopening the panel) stay
    // silent. firstMessageAlertSent doubles as the "opening announcement already sent"
    // flag shared with the chat handler below, so whichever event happens first (open or
    // first message) claims the single opening slot and the other does not duplicate it.
    let shouldAlert = false;
    if (incomingSessionId) {
      try {
        const base44 = createClientFromRequest(req);
        const [existing] = await base44.asServiceRole.entities.Conversations.filter({ sessionId: incomingSessionId });
        if (existing) {
          shouldAlert = existing.widgetOpened !== true;
          await base44.asServiceRole.entities.Conversations.update(existing.id, {
            widgetOpened: true,
            lastPage: currentPageUrl ?? existing.lastPage ?? "",
            ...(!existing.landingPage && landingPage && { landingPage }),
            ...(!existing.deviceType && { deviceType }),
            ...(openerText && !existing.openerText && { openerText }),
            ...(!existing.firstMessageAlertSent && { firstMessageAlertSent: true }),
          });
        } else {
          shouldAlert = true;
          await base44.asServiceRole.entities.Conversations.create({
            sessionId: incomingSessionId,
            timestamp: new Date().toISOString(),
            geo: geo ?? "",
            referralSource: referralSource ?? "",
            pagesViewed: pagesArr.length > 0 ? pagesArr.join(",") : (currentPageUrl ?? ""),
            landingPage,
            lastPage: currentPageUrl ?? "",
            intentClassification: "GENERAL_AWARENESS",
            conversationTranscript: openerText ? `Agent: ${openerText}` : "",
            ctaReached: false,
            language: language ?? "en",
            conversationTurns: 0,
            conversationOutcome: "BOUNCED",
            linksClicked: 0,
            widgetOpened: true,
            openerText: openerText ?? "",
            deviceType,
            firstMessageAlertSent: true,
          });
        }
      } catch (e) {
        console.error("widget_opened DB record failed:", e.message);
      }
    }
    if (shouldAlert) {
      await fetch("https://api.base44.app/api/apps/69edc5de1c84c71c086635e0/functions/slackAlert", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer app-key-AQMEVGjibXJE55B9QiqZnjCH" },
        body: JSON.stringify({
          sessionId: incomingSessionId ?? "",
          eventType: "widget_opened",
          triggerUrl: currentPageUrl ?? "",
          geo: geo ?? "",
          referralSource: referralSource ?? "",
          language: language ?? "en",
          pagesViewed: Array.isArray(pagesViewed) ? pagesViewed.join(",") : (pagesViewed ?? currentPageUrl ?? ""),
          isWidgetOpen: true,
        }),
      }).catch((e) => console.error("slackAlert widget_opened failed:", e.message));
    }
    return new Response(JSON.stringify({ success: true }), { headers: CORS_HEADERS });
  }

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
          pagesViewed: [existing.pagesViewed, clickedUrl].filter(Boolean).join(","),
          lastPage: clickedUrl ?? existing.lastPage ?? "",
          ...(!existing.landingPage && landingPage && { landingPage }),
          ...(!existing.deviceType && { deviceType }),
          ...(openerText && !existing.openerText && { openerText }),
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
          pagesViewed: [currentPageUrl, clickedUrl].filter(Boolean).join(","),
          landingPage,
          lastPage: clickedUrl ?? "",
          intentClassification: "GENERAL_AWARENESS",
          conversationTranscript: openerText ? `Agent: ${openerText}` : "",
          ctaReached: false,
          language: language ?? "en",
          conversationTurns: 0,
          lastMessageRole: "none",
          conversationOutcome: "ENGAGED",
          linksClicked: 1,
          openerText: openerText ?? "",
          deviceType,
        })
      );
    }

    await Promise.all(updateTasks);

    const HIGH_INTENT_PATHS = ["/registration", "/free-trial", "/plans", "/pricing", "/contact"];
    const isHighIntent = HIGH_INTENT_PATHS.some(p => (clickedUrl ?? "").toLowerCase().includes(p));
    // Consolidated alerts (Option B): only high-intent link clicks post to Slack.
    // Ordinary content clicks stay silent so one visitor does not generate several messages.
    if (isHighIntent) {
      await fetch("https://api.base44.app/api/apps/69edc5de1c84c71c086635e0/functions/slackAlert", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer app-key-AQMEVGjibXJE55B9QiqZnjCH" },
        body: JSON.stringify({
          sessionId,
          eventType: "link_click",
          clickedUrl: clickedUrl ?? "",
          triggerUrl: currentPageUrl ?? "",
          geo: geo ?? "",
          referralSource: referralSource ?? "",
          language: language ?? "en",
          pagesViewed: [...(Array.isArray(pagesViewed) && pagesViewed.length > 0 ? pagesViewed : [currentPageUrl || ""]), clickedUrl].filter(Boolean).join(","),
          isHighIntentClick: isHighIntent,
        }),
      }).catch((e) => console.error("slackAlert link_click failed:", e.message));
    }

    return new Response(JSON.stringify({ success: true }), { headers: CORS_HEADERS });
  }

  // Bubble lifecycle events: record on the session's latest impression for this page.
  if (trackingEvent === "bubble_dismissed" || trackingEvent === "bubble_expired" || trackingEvent === "bubble_abandoned") {
    try {
      if (incomingSessionId) {
        const base44 = createClientFromRequest(req);
        const rows = await base44.asServiceRole.entities.OpenerImpressions.filter({ sessionId: incomingSessionId });
        const samePage = (rows || []).filter(r => (r.pageUrl || "") === (currentPageUrl ?? ""));
        const pool = samePage.length > 0 ? samePage : (rows || []);
        const target = pool.sort((a, b) => String(b.shownAt || "").localeCompare(String(a.shownAt || "")))[0];
        if (target) {
          const terminalField = trackingEvent === "bubble_dismissed" ? "dismissed" : trackingEvent === "bubble_abandoned" ? "abandoned" : "expired";
          await base44.asServiceRole.entities.OpenerImpressions.update(target.id, {
            [terminalField]: true,
            timeVisibleMs: typeof body.timeVisibleMs === "number" ? body.timeVisibleMs : typeof body.timeVisible === "number" ? body.timeVisible : 0,
            wasFallback: !!body.isFallback,
            // Same variant echo as opener_shown above, kept in sync per terminal event.
            bubbleVariant: body.bubbleVariant || "A",
          });
        }
      }
    } catch (e) {
      console.error("bubble event record failed:", e.message);
    }
    return new Response(JSON.stringify({ success: true }), { headers: CORS_HEADERS });
  }

  // Safety net: swallow any unrecognized tracking event so it can never fall through
  // to the chat handler and be processed as a visitor message.
  if (trackingEvent) {
    return new Response(JSON.stringify({ success: true }), { headers: CORS_HEADERS });
  }

  // Dynamic page-aware opener for all INIT variants
  const CURATED_BUBBLES_EN = {
    "https://www.reflectiz.com/": "64% of third-party scripts access your data without justification -- is yours one of them?",
    "https://www.reflectiz.com/blog/trust-wallet-hack/": "Browser extensions are the new attack vector. Is yours monitored?",
    "https://www.reflectiz.com/blog/what-is-ctem/": "Most CTEM programs miss the web layer entirely. Does yours?",
    "https://www.reflectiz.com/learning-hub/pentest-agent-webinar/": "Traditional pentesting misses dynamic web apps. There is a better way.",
    "https://www.reflectiz.com/learning-hub/ciso-guide-web-privacy-validation/": "Healthline paid $1.55M for ignoring client-side privacy. Are you exposed?",
    "https://www.reflectiz.com/use-cases/pci-compliance/": "Requirements 6.4.3 and 11.6.1 are catching teams off guard. Are you ready?",
    "https://www.reflectiz.com/use-cases/magecart-web-skimming/": "Magecart hid inside Google Tag Manager for months undetected. Check yours?",
    "https://www.reflectiz.com/use-cases/web-supply-chain-risks/": "64% of your third-party vendors access sensitive data without justification.",
    "https://www.reflectiz.com/learning-hub/web-exposure-2026-research/": "Only 16% of security leaders have mature web exposure management. Are you one?",
    "https://www.reflectiz.com/customers/apexx-pci-dss-success/": "Apexx achieved zero PCI audit findings. Here is how they did it.",
    "https://www.reflectiz.com/use-cases/website-privacy-compliance/": "Healthline paid $1.55M for ignoring client-side privacy risks. Is your site exposed?",
    "https://www.reflectiz.com/blog/paypal-breach-2026/": "PayPal's breach exposed millions of payment records. Is your checkout next?",
    "https://www.reflectiz.com/blog/dora-compliance-checklist/": "DORA mandates continuous oversight of third-party digital risk. Are your gaps covered?",
    "https://www.reflectiz.com/blog/agentic-pentest-webinar/": "Traditional pentesting can't keep up with modern web apps. Is yours being tested continuously?",
    "https://www.reflectiz.com/learning-hub/pci-dss-solution-assessment-integrity360/": "An independent QSA confirmed Reflectiz meets PCI DSS v4.0.1 requirements 6.4.3 and 11.6.1.",
    "https://www.reflectiz.com/blog/disney-ccpa-fine-biggest-so-far/": "Disney's $2.75M CCPA fine shows client-side tracking risks are very real. Is yours covered?",
    "https://www.reflectiz.com/plans/": "Most teams on this page already have a platform and a compliance driver in mind. Which is yours -- Shopify, WooCommerce, or Magento?",
  };
  const CURATED_BUBBLES_DE: Record<string, string> = {
    "https://www.reflectiz.com/": "64 % Ihrer Drittanbieter-Skripte greifen unbefugt auf Daten zu -- auch Ihre?",
    "https://www.reflectiz.com/use-cases/pci-compliance/": "PCI-Anforderungen 6.4.3 und 11.6.1 -- sind Sie vorbereitet?",
    "https://www.reflectiz.com/use-cases/magecart-web-skimming/": "Magecart versteckte sich monatelang im Google Tag Manager. Pruefen Sie Ihres?",
    "https://www.reflectiz.com/use-cases/web-supply-chain-risks/": "64 % Ihrer Drittanbieter greifen ohne Berechtigung auf sensible Daten zu.",
    "https://www.reflectiz.com/learning-hub/web-exposure-2026-research/": "Nur 16 % der Sicherheitsverantwortlichen managen Web-Exposition reif. Gehoeren Sie dazu?",
    "https://www.reflectiz.com/customers/apexx-pci-dss-success/": "Apexx erzielte null PCI-Auditbefunde. So haben sie es geschafft.",
    "https://www.reflectiz.com/blog/trust-wallet-hack/": "Browser-Erweiterungen sind der neue Angriffsvektor. Ist Ihre ueberwacht?",
    "https://www.reflectiz.com/blog/what-is-ctem/": "Die meisten CTEM-Programme uebersehen die Web-Ebene komplett. Ihres auch?",
    "https://www.reflectiz.com/learning-hub/pentest-agent-webinar/": "Klassische Pentests uebersehen dynamische Web-Apps. Es gibt einen besseren Weg.",
    "https://www.reflectiz.com/learning-hub/ciso-guide-web-privacy-validation/": "Healthline zahlte 1,55 Mio. $ wegen ignorierter Client-seitiger Privatsphaere. Sind Sie exponiert?",
    "https://www.reflectiz.com/use-cases/website-privacy-compliance/": "Healthline zahlte 1,55 Mio. $ fuer ignorierte Client-seitige Risiken. Ist Ihre Seite exponiert?",
    "https://www.reflectiz.com/blog/paypal-breach-2026/": "PayPals Datenleck legte Millionen Zahlungsdaten offen. Ist Ihre Kasse als naechstes dran?",
    "https://www.reflectiz.com/blog/dora-compliance-checklist/": "DORA verlangt laufende Kontrolle von Drittanbieter-Risiken. Sind Ihre Luecken geschlossen?",
    "https://www.reflectiz.com/blog/agentic-pentest-webinar/": "Klassische Pentests halten mit modernen Web-Apps nicht mit. Wird Ihre laufend getestet?",
    "https://www.reflectiz.com/learning-hub/pci-dss-solution-assessment-integrity360/": "Ein unabhaengiger QSA bestaetigte, dass Reflectiz die PCI DSS v4.0.1 Anforderungen 6.4.3 und 11.6.1 erfuellt.",
    "https://www.reflectiz.com/blog/disney-ccpa-fine-biggest-so-far/": "Disneys 2,75-Mio.-$-CCPA-Strafe zeigt, wie real Client-seitige Tracking-Risiken sind. Ist Ihre Seite geschuetzt?",
  };
  const CURATED_BUBBLES_FR: Record<string, string> = {
    "https://www.reflectiz.com/": "64 % de vos scripts tiers accedent a vos donnees sans justification -- les votres aussi?",
    "https://www.reflectiz.com/use-cases/pci-compliance/": "Les exigences PCI 6.4.3 et 11.6.1 prennent les equipes de court. Etes-vous pret?",
    "https://www.reflectiz.com/use-cases/magecart-web-skimming/": "Magecart s'est cache dans Google Tag Manager pendant des mois. Verifiez le votre?",
    "https://www.reflectiz.com/use-cases/web-supply-chain-risks/": "64 % de vos fournisseurs tiers accedent a des donnees sensibles sans justification.",
    "https://www.reflectiz.com/learning-hub/web-exposure-2026-research/": "Seulement 16 % des responsables securite gerent maturite l'exposition web. Et vous?",
    "https://www.reflectiz.com/customers/apexx-pci-dss-success/": "Apexx a obtenu zero constat lors de son audit PCI. Voici comment ils y sont parvenus.",
    "https://www.reflectiz.com/blog/disney-ccpa-fine-biggest-so-far/": "L'amende CCPA de Disney ($2,75M) montre que les risques de tracking cote client sont bien reels. Votre site est-il protege?",
    "https://www.reflectiz.com/blog/trust-wallet-hack/": "Les extensions de navigateur sont le nouveau vecteur d'attaque. La votre est-elle surveillee?",
    "https://www.reflectiz.com/blog/what-is-ctem/": "La plupart des programmes CTEM ignorent completement la couche web. Le votre aussi?",
    "https://www.reflectiz.com/learning-hub/pentest-agent-webinar/": "Les pentests traditionnels ratent les applications web dynamiques. Il existe une meilleure facon.",
    "https://www.reflectiz.com/learning-hub/ciso-guide-web-privacy-validation/": "Healthline a paye 1,55 M$ pour avoir ignore la confidentialite cote client. Etes-vous expose?",
    "https://www.reflectiz.com/use-cases/website-privacy-compliance/": "Healthline a paye 1,55 M$ pour avoir ignore ces risques cote client. Votre site est-il expose?",
    "https://www.reflectiz.com/blog/paypal-breach-2026/": "La faille de PayPal a expose des millions de paiements. Votre caisse est-elle la prochaine?",
    "https://www.reflectiz.com/blog/dora-compliance-checklist/": "DORA exige une surveillance continue des risques tiers. Vos lacunes sont-elles couvertes?",
    "https://www.reflectiz.com/blog/agentic-pentest-webinar/": "Les pentests traditionnels ne suivent plus les applications web modernes. Le votre est-il teste en continu?",
    "https://www.reflectiz.com/learning-hub/pci-dss-solution-assessment-integrity360/": "Un QSA independant a confirme que Reflectiz respecte les exigences PCI DSS v4.0.1 6.4.3 et 11.6.1.",
  };
  const CURATED_BUBBLES_ES: Record<string, string> = {
    "https://www.reflectiz.com/": "El 64 % de sus scripts de terceros acceden a sus datos sin justificacion -- incluidos los suyos?",
    "https://www.reflectiz.com/use-cases/pci-compliance/": "Los requisitos PCI 6.4.3 y 11.6.1 toman por sorpresa a los equipos. Esta listo?",
    "https://www.reflectiz.com/use-cases/magecart-web-skimming/": "Magecart se escondia en Google Tag Manager durante meses. Compruebe el suyo?",
    "https://www.reflectiz.com/use-cases/web-supply-chain-risks/": "El 64 % de sus proveedores acceden a datos sensibles sin justificacion.",
    "https://www.reflectiz.com/learning-hub/web-exposure-2026-research/": "Solo el 16 % de los lideres de seguridad gestionan bien la exposicion web. Es usted uno?",
    "https://www.reflectiz.com/customers/apexx-pci-dss-success/": "Apexx logro cero hallazgos en su auditoria PCI. Asi es como lo lograron.",
    "https://www.reflectiz.com/blog/trust-wallet-hack/": "Las extensiones del navegador son el nuevo vector de ataque. Esta vigilada la suya?",
    "https://www.reflectiz.com/blog/what-is-ctem/": "La mayoria de los programas CTEM ignoran por completo la capa web. El suyo tambien?",
    "https://www.reflectiz.com/learning-hub/pentest-agent-webinar/": "El pentesting tradicional no detecta apps web dinamicas. Hay una forma mejor.",
    "https://www.reflectiz.com/learning-hub/ciso-guide-web-privacy-validation/": "Healthline pago 1,55 M$ por ignorar la privacidad del lado del cliente. Esta usted expuesto?",
    "https://www.reflectiz.com/use-cases/website-privacy-compliance/": "Healthline pago 1,55 M$ por ignorar estos riesgos del lado del cliente. Esta su sitio expuesto?",
    "https://www.reflectiz.com/blog/paypal-breach-2026/": "La brecha de PayPal expuso millones de registros de pago. Sera su caja la siguiente?",
    "https://www.reflectiz.com/blog/dora-compliance-checklist/": "DORA exige supervision continua del riesgo digital de terceros. Estan cubiertas sus brechas?",
    "https://www.reflectiz.com/blog/agentic-pentest-webinar/": "El pentesting tradicional no sigue el ritmo de las apps web modernas. Se prueba la suya de forma continua?",
    "https://www.reflectiz.com/learning-hub/pci-dss-solution-assessment-integrity360/": "Un QSA independiente confirmo que Reflectiz cumple los requisitos PCI DSS v4.0.1 6.4.3 y 11.6.1.",
    "https://www.reflectiz.com/blog/disney-ccpa-fine-biggest-so-far/": "La multa CCPA de Disney (2,75 M$) muestra que los riesgos de tracking del lado del cliente son reales. Esta protegido su sitio?",
  };
  const CURATED_BUBBLES_IT: Record<string, string> = {
    "https://www.reflectiz.com/": "Il 64% degli script di terze parti accede ai tuoi dati senza giustificazione -- anche i tuoi?",
    "https://www.reflectiz.com/use-cases/pci-compliance/": "I requisiti PCI 6.4.3 e 11.6.1 colgono di sorpresa i team. Sei pronto?",
    "https://www.reflectiz.com/use-cases/magecart-web-skimming/": "Magecart si e nascosto in Google Tag Manager per mesi. Controlla il tuo?",
    "https://www.reflectiz.com/use-cases/web-supply-chain-risks/": "Il 64% dei tuoi fornitori terzi accede a dati sensibili senza giustificazione.",
    "https://www.reflectiz.com/learning-hub/web-exposure-2026-research/": "Solo il 16% dei responsabili sicurezza gestisce maturamente l'esposizione web. Sei tra loro?",
    "https://www.reflectiz.com/customers/apexx-pci-dss-success/": "Apexx ha ottenuto zero rilievi nell'audit PCI. Ecco come ci sono riusciti.",
    "https://www.reflectiz.com/blog/trust-wallet-hack/": "Le estensioni del browser sono il nuovo vettore di attacco. La tua e monitorata?",
    "https://www.reflectiz.com/blog/what-is-ctem/": "La maggior parte dei programmi CTEM ignora completamente il livello web. Anche il tuo?",
    "https://www.reflectiz.com/learning-hub/pentest-agent-webinar/": "Il pentesting tradizionale non rileva le web app dinamiche. C'e un modo migliore.",
    "https://www.reflectiz.com/learning-hub/ciso-guide-web-privacy-validation/": "Healthline ha pagato 1,55 milioni di $ per aver ignorato la privacy lato client. Sei esposto?",
    "https://www.reflectiz.com/use-cases/website-privacy-compliance/": "Healthline ha pagato 1,55 milioni di $ per questi rischi lato client. Il tuo sito e esposto?",
    "https://www.reflectiz.com/blog/paypal-breach-2026/": "La violazione di PayPal ha esposto milioni di dati di pagamento. Il tuo checkout e il prossimo?",
    "https://www.reflectiz.com/blog/dora-compliance-checklist/": "DORA richiede il controllo continuo del rischio digitale di terze parti. Le tue lacune sono coperte?",
    "https://www.reflectiz.com/blog/agentic-pentest-webinar/": "Il pentesting tradizionale non tiene il passo con le web app moderne. La tua viene testata di continuo?",
    "https://www.reflectiz.com/learning-hub/pci-dss-solution-assessment-integrity360/": "Un QSA indipendente ha confermato che Reflectiz soddisfa i requisiti PCI DSS v4.0.1 6.4.3 e 11.6.1.",
    "https://www.reflectiz.com/blog/disney-ccpa-fine-biggest-so-far/": "La multa CCPA di Disney (2,75 milioni di $) dimostra che i rischi di tracciamento lato client sono reali. Il tuo sito e protetto?",
  };
  function getCuratedBubble(pageUrl: string, lang: string): string | null {
    const url = canonicalCacheUrl(pageUrl);
    const map: Record<string, string> =
      lang === "de" ? CURATED_BUBBLES_DE :
      lang === "fr" ? CURATED_BUBBLES_FR :
      lang === "es" ? CURATED_BUBBLES_ES :
      lang === "it" ? CURATED_BUBBLES_IT :
      CURATED_BUBBLES_EN;
    return map[url] || CURATED_BUBBLES_EN[url] || null;
  }
  if (message.startsWith("INIT") && message !== "INIT_RETURNING_VISITOR") {
    const sessionId = incomingSessionId || crypto.randomUUID();
    const resolvedLangEarly = (language || "").split("-")[0].toLowerCase();
    const curatedBubble = getCuratedBubble(currentPageUrl, resolvedLangEarly) || null;

    if (isFormPage(currentPageUrl)) {
      return new Response(JSON.stringify({ reply: null, sessionId }), { headers: CORS_HEADERS });
    }

    // Form nudge: learning-hub gated/webinar pages get a form-focused opener instead of an article link
    if (isFormNudgePage(currentPageUrl)) {
      const base44 = createClientFromRequest(req);
      const contextTitle = clientPageTitle || currentPageUrl;

      // Fetch page content from DB for context
      let pageContent = "";
      try {
        const normalizedUrl = (currentPageUrl || "").replace(/\/$/, "") + "/";
        const pageRecord = await base44.asServiceRole.entities.WebsiteContent.filter({ pageUrl: normalizedUrl });
        pageContent = pageRecord?.[0]?.pageContent || "";
      } catch (e) {
        console.error("Form nudge page content fetch failed:", e.message);
      }

      const formNudgePrompt = `You are Athena, a web security expert for Reflectiz. A visitor is on a gated content or webinar registration page and may be hesitating to fill out the form.

PAGE CONTEXT:
Page title: ${contextTitle}
Page URL: ${currentPageUrl}
Page content: "${pageContent.slice(0, 800)}"

WRITE TWO THINGS:

1. bubbleText: 5-6 words. Specific to what they get by filling the form. Start with an action verb. Example: "Get the CISO guide free" or "Watch the webinar - 2 min"

2. opener: Exactly 2 sentences.
Sentence 1: One sharp specific insight about the topic of this page. Must include at least one of: a specific stat, a named company, a named threat or attack, or a dollar/regulatory figure. Never start vague.
Sentence 2: Plain text only (absolutely NO markdown links) — a natural nudge encouraging them to fill out the form above. Example: "Fill out the form above to get instant access." or "The form above takes under a minute to unlock it."

ABSOLUTE RULES:
- No em dashes
- No greeting words
- Sentence 2 must be plain text — no URLs, no markdown, no brackets
- Sound like a peer, not a salesperson
- bubbleText must start with a capital letter
- Never use marketing words like revealed, unveiled, insights, discover, explore, or learn, in any language (this includes their translated equivalents such as scopri/scoprire, decouvrez/decouvrir, entdecken/erfahren, descubre/descubra)
- Always capitalize company names, product names, and acronyms correctly (for example PayPal, Stripe, OWASP, XSS, CSRF), never lowercase a brand name

Return only valid JSON, nothing else:
{"bubbleText": "...", "opener": "Insight sentence. Plain text form nudge sentence."}${resolvedLang !== "en" ? `\nCRITICAL LANGUAGE REQUIREMENT: The ENTIRE response must be written in ${LANGUAGE_NAMES[resolvedLang]}. Do not write any sentence in English. Keep brand names and standard names like PCI DSS unchanged.${resolvedLang === "de" ? " Follow German capitalization rules: all nouns are capitalized, not just sentence starts." : ""}` : ""}`;

      const geminiTimeout = new Promise((resolve) => setTimeout(() => resolve(null), 5000));
      const geminiResult = await Promise.race([
        callGemini({ messages: [{ role: "user", content: formNudgePrompt }], max_tokens: 512, model: "gemini-2.5-flash-lite" }),
        geminiTimeout
      ]);

      let opener = null;
      let bubbleText = null;

      if (geminiResult) {
        try {
          const cleaned = (geminiResult?.content?.[0]?.text ?? "").trim().replace(/```json|```/g, "").trim();
          const parsed = JSON.parse(cleaned);
          opener = parsed.opener || null;
          bubbleText = parsed.bubbleText || null;
        } catch (e) {
          console.error("Form nudge JSON parse failed:", e.message);
        }
      }

      // Sanitize
      if (opener) opener = opener.replace(/\u2014/g, ",").replace(/\u2013/g, "-").replace(/--/g, ",").replace(/&#[0-9]+;/g, "").replace(/&[a-z]+;/g, "");
      if (bubbleText) bubbleText = bubbleText.replace(/&#[0-9]+;/g, "").replace(/&[a-z]+;/g, "");

      // Safety: strip any accidental links from opener
      if (opener) opener = opener.replace(/\[.*?\]\(.*?\)/g, "").replace(/https?:\/\/\S+/g, "").trim();

      if (!opener) opener = "This topic is one of the fastest-moving areas in web security right now. Fill out the form above to get access.";
      if (!bubbleText) bubbleText = "Fill the form to get access";
      if (curatedBubble) bubbleText = curatedBubble;
      if (bubbleText) bubbleText = fixDiacritics(stripBannedMarketingWords(fixBrandCapitalization(capitalizeFirstLetter(bubbleText)), resolvedLang), resolvedLang);
      if (curatedBubble && opener && bubbleText) {
        await upsertPageOpener(base44, canonicalCacheUrl(currentPageUrl), {
          opener,
          bubbleText,
          language: resolvedLang,
          generatedAt: new Date().toISOString(),
          isActive: true,
          isCurated: true,
        });
      }

      return new Response(JSON.stringify({ reply: decorateOpener(opener, message, resolvedLang), bubbleText, lang: resolvedLang, sessionId }), { headers: CORS_HEADERS });
    }

    const base44 = createClientFromRequest(req);
    const contextTitle = clientPageTitle || currentPageUrl;

    // Blog -> Hub companion: if this blog has a gated learning-hub counterpart, recommend it directly
    const canonicalBlogUrl = (currentPageUrl || "").replace(/\/$/, "") + "/";
    const hubCompanionUrl = BLOG_TO_HUB_MAP[canonicalBlogUrl];
    if (hubCompanionUrl) {
      // Fetch hub page content from DB for the opener
      let hubContent = "";
      let hubTitle = "";
      try {
        const hubRecord = await base44.asServiceRole.entities.WebsiteContent.filter({ pageUrl: hubCompanionUrl });
        hubContent = hubRecord?.[0]?.pageContent || "";
        hubTitle = hubRecord?.[0]?.pageTitle || "";
      } catch (e) {
        console.error("Hub companion fetch failed:", e.message);
      }

      const hubLabel = hubTitle ? `Get the full resource: ${sanitizeContent(hubTitle).split(/[|\-\u2013\u2014]/)[0].trim()}` : "Get the full resource";
      const hubPrompt = `You are Athena, a web security expert for Reflectiz. A visitor is reading a blog article. There is a deeper gated resource on the same topic in the learning hub.

BLOG PAGE:
Title: ${contextTitle}
URL: ${currentPageUrl}

GATED HUB RESOURCE:
Title: ${hubTitle}
URL: ${hubCompanionUrl}
Content preview: "${sanitizeContent(hubContent).slice(0, 800)}"

WRITE TWO THINGS:

1. bubbleText: 5-6 words. Tease the deeper resource without giving it away. No question mark.

2. opener: Exactly 2 sentences.
Sentence 1: One sharp specific insight from the hub resource content -- a stat, named company, named threat, or regulatory figure. Make them want more.
Sentence 2: Must be exactly this markdown link with no extra words before it: [${hubLabel}](${hubCompanionUrl})

ABSOLUTE RULES:
- No em dashes
- No greeting words
- Sentence 2 must use the exact label and URL above
- Sound like a peer, not a salesperson
- bubbleText must start with a capital letter
- Never use marketing words like revealed, unveiled, insights, discover, explore, or learn, in any language (this includes their translated equivalents such as scopri/scoprire, decouvrez/decouvrir, entdecken/erfahren, descubre/descubra)
- Always capitalize company names, product names, and acronyms correctly (for example PayPal, Stripe, OWASP, XSS, CSRF), never lowercase a brand name

Return only valid JSON:
{"bubbleText": "5-6 words here", "opener": "Insight sentence. [${hubLabel}](${hubCompanionUrl})"}${resolvedLang !== "en" ? `\nCRITICAL LANGUAGE REQUIREMENT: The ENTIRE response (bubbleText and opener sentence 1) must be written in ${LANGUAGE_NAMES[resolvedLang]}. Do not write any sentence in English. Keep brand names, standard names like PCI DSS, and the exact markdown link in sentence 2 unchanged.${resolvedLang === "de" ? " Follow German capitalization rules: all nouns are capitalized, not just sentence starts." : ""}` : ""}`;

      const geminiTimeout = new Promise((resolve) => setTimeout(() => resolve(null), 5000));
      const geminiResult = await Promise.race([
        callGemini({ messages: [{ role: "user", content: hubPrompt }], max_tokens: 512, model: "gemini-2.5-flash-lite" }),
        geminiTimeout
      ]);

      let opener = null;
      let bubbleText = null;
      if (geminiResult) {
        try {
          const cleaned = (geminiResult?.content?.[0]?.text ?? "").trim().replace(/```json|```/g, "").trim();
          const parsed = JSON.parse(cleaned);
          opener = parsed.opener || null;
          bubbleText = parsed.bubbleText || null;
        } catch (e) {
          console.error("Hub companion JSON parse failed:", e.message);
        }
      }

      if (opener) opener = opener.replace(/\u2014/g, ",").replace(/\u2013/g, "-").replace(/--/g, ",").replace(/&#[0-9]+;/g, "").replace(/&[a-z]+;/g, "");
      if (bubbleText) bubbleText = bubbleText.replace(/&#[0-9]+;/g, "").replace(/&[a-z]+;/g, "");

      if (!opener || !opener.includes(hubCompanionUrl.replace(/\/$/, ""))) {
        opener = `This topic goes deeper than most articles cover. [${hubLabel}](${hubCompanionUrl})`;
      }
      if (!bubbleText) bubbleText = "There's a deeper resource on this";
      if (curatedBubble) bubbleText = curatedBubble;
      if (bubbleText) bubbleText = fixDiacritics(stripBannedMarketingWords(fixBrandCapitalization(capitalizeFirstLetter(bubbleText)), resolvedLang), resolvedLang);

      // Cache this result
      if (opener && bubbleText) {
        await upsertPageOpener(base44, canonicalCacheUrl(currentPageUrl), {
          opener,
          bubbleText,
          language: resolvedLang,
          generatedAt: new Date().toISOString(),
          isActive: true,
          isCurated: !!curatedBubble,
        });
      }

      return new Response(JSON.stringify({ reply: decorateOpener(opener, message, resolvedLang), bubbleText, lang: resolvedLang, sessionId }), { headers: CORS_HEADERS });
    }

    // Fetch current page's own DB content for richer opener personalization
    let currentPageContent = "";
    try {
      const normalizedCurrentUrl = (currentPageUrl || "").replace(/\/$/, "") + "/";
      const currentPageRecord = await base44.asServiceRole.entities.WebsiteContent.filter({ pageUrl: normalizedCurrentUrl });
      currentPageContent = (currentPageRecord?.[0]?.pageContent || "").replace(/\s+/g, " ").trim().slice(0, 700);
    } catch (e) {
      console.error("Current page content fetch failed:", e.message);
    }

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
      const cleanTitle = pageTitle ? sanitizeContent(pageTitle).split(/\s[\u2013\u2014|-]\s/)[0].replace(/[\[\]]/g, "").trim() : "";
      return cleanTitle || base;
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

    async function getCandidatesForCategory(category, currentPageUrl, base44, pagesViewed = []) {
      // Build a set of all URLs the visitor has already seen (current + full journey)
      const visitedNormalized = new Set([
        normalizeUrl(currentPageUrl),
        ...(Array.isArray(pagesViewed) ? pagesViewed.map(u => normalizeUrl(u)) : [normalizeUrl(pagesViewed)]).filter(Boolean),
      ]);
      try {
        // Fetch ALL active records and filter in-memory -- DB array-field queries are unreliable
        const allContent = await base44.asServiceRole.entities.WebsiteContent.list("-lastScanned", 1000);
        const matches = allContent.filter(page =>
          page.isActive === true &&
          Array.isArray(page.categories) &&
          page.categories.includes(category) &&
          !visitedNormalized.has(normalizeUrl(page.pageUrl)) &&
          normalizeUrl(page.pageUrl) !== "reflectiz.com" &&
          page.pageContent && page.pageContent.length > 400 &&
          !isTaxonomyPage(page.pageUrl) &&
          !isHubPage(page.pageUrl) &&
          !isPRPage(page.pageUrl)
        );
        const aged = matches.map(page => {
          const urlYear = (page.pageUrl || "").match(/\b(202[0-3]|201\d)\b/);
          let effYear = urlYear ? parseInt(urlYear[1]) : null;
          if (!effYear) {
            const textSample = ((page.pageTitle || "") + " " + (page.pageContent || "").slice(0, 3000));
            const mentioned = textSample.match(/\b20(1\d|2[0-6])\b/g);
            if (mentioned && mentioned.length > 0) {
              effYear = Math.max(...mentioned.map(Number));
            }
          }
          const ageTier = (!effYear || effYear >= 2025) ? 0 : (effYear === 2024 ? 1 : 2);
          // performanceScore written by analyzeAndLearn: 0-30, higher = more converting.
          // Default 10 (neutral) for pages with no click data yet.
          const performanceScore = typeof page.performanceScore === "number" ? page.performanceScore : 10;
          return {
            url: page.pageUrl,
            label: deriveLabel(page.pageTitle, page.pageType),
            pageContent: page.pageContent,
            pageType: page.pageType,
            ageTier,
            performanceScore,
          };
        });
        // Sort: newer content first (ageTier), then by performance score (higher = better) within same tier.
        aged.sort((a, b) => {
          if (a.ageTier !== b.ageTier) return a.ageTier - b.ageTier;
          return b.performanceScore - a.performanceScore;
        });

        // Always strip all visited pages from candidates
        const filtered = aged.filter(c => !visitedNormalized.has(normalizeUrl(c.url)));

        // Exclude other case-study pages when visitor is already on a case study
        if ((currentPageUrl || "").includes("/customers/")) {
          return filtered.filter(c => c.pageType !== "case-study");
        }

        // Homepage: recommend product/solution/use-case content and customer success stories, never blog posts
        if (normalizeUrl(currentPageUrl) === "reflectiz.com") {
          const nonBlog = filtered.filter(c => c.pageType !== "blog");
          const caseStudies = allContent
            .filter(p => p.isActive === true &&
              p.pageType === "case-study" &&
              p.pageContent && p.pageContent.length > 400 &&
              !visitedNormalized.has(normalizeUrl(p.pageUrl)) &&
              !nonBlog.some(c => normalizeUrl(c.url) === normalizeUrl(p.pageUrl)))
            .map(p => ({
              url: p.pageUrl,
              label: deriveLabel(p.pageTitle, p.pageType),
              pageContent: p.pageContent,
              pageType: p.pageType,
              ageTier: 0,
              performanceScore: typeof p.performanceScore === "number" ? p.performanceScore : 10,
            }));
          return nonBlog.concat(caseStudies);
        }

        return filtered.filter(c => !visitedNormalized.has(normalizeUrl(c.url)));
      } catch (e) {
        console.error("getCandidatesForCategory failed:", e.message);
        return [];
      }
    }

    async function determineRouting(currentPageUrl, referralSource, geo, pagesViewed, timeOnPage, hasActiveConversation, base44) {
      const url = (currentPageUrl || "").toLowerCase();
      const ref = (referralSource || "").toLowerCase();
      const geoLower = (geo || "").toLowerCase();
      const normalizedCurrentUrl = normalizeUrl(currentPageUrl);

      // PANEL PRIORITY: panel/webinar URL detection must run FIRST, before the T11 DB-category
      // override, otherwise panel pages tagged categories:["pci"] route to "pci" and panel routing never fires.
      if (url.includes("panel-discussion") || url.includes("live-panel") || url.includes("/webinar/")) {
        return { category: "panel", reason: "panel-priority" };
      }

      const isPaidSearch = ref.includes("gclid") || ref.includes("paid") || ref.includes("cpc");
      if (isPaidSearch) return { category: "DIRECT_REGISTRATION", reason: "high-intent" };

      // Comparison pages signal the highest purchase intent: visitor is actively evaluating vendors.
      // Route directly to registration -- same logic as paid search traffic.
      const isComparisonPage = url.includes("reflectiz-vs") || url.includes("vs-reflectiz") || url.includes("cside-vs") || url.includes("cside");
      if (isComparisonPage) return { category: "DIRECT_REGISTRATION", reason: "comparison" };

      // Pricing page = active evaluation, same intent level as comparison pages
      const isPricingPage = url.includes("/plans") || url.includes("/pricing");
      if (isPricingPage) return { category: "DIRECT_REGISTRATION", reason: "pricing" };

      // T11 FIX: DB categories take priority over URL slug heuristics for all non-comparison, non-case-study pages
      const isHomepageUrl = url.replace(/\/$/, "") === "https://www.reflectiz.com";
      if (!isHomepageUrl) {
        try {
          const normalizedUrl = (currentPageUrl || "").replace(/\/$/, "") + "/";
          const pageRecord = await base44.asServiceRole.entities.WebsiteContent.filter({ pageUrl: normalizedUrl });
          const dbCategories = pageRecord?.[0]?.categories;
          if (Array.isArray(dbCategories) && dbCategories.length > 0) {
            const CATEGORY_PRIORITY = ["pci", "magecart", "supply-chain", "consent", "privacy", "ai-threats", "retail", "financial", "healthcare", "pentest", "comparison", "low-context"];
            const matched = CATEGORY_PRIORITY.find(c => dbCategories.includes(c));
            if (matched) return { category: matched, reason: "db-categories" };
          }
        } catch (e) {
          console.error("DB category priority lookup failed:", e.message);
        }
      }

      const isCaseStudy = url.includes("/customers/");
      const isHealthcare = url.includes("healthcare") || url.includes("hipaa");
      const isPCI = url.includes("pci") || url.includes("compliance") || url.includes("dss");
      const isMagecart = url.includes("magecart") || url.includes("skimming");
      const isSupplyChain = url.includes("supply-chain") || url.includes("supply_chain") || url.includes("security-hub");
      const isConsent = url.includes("consent") || url.includes("cookie-banner") || url.includes("shein") || url.includes("ccpa");
      const isPrivacy = url.includes("privacy") || url.includes("gdpr");
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
      if (isPCI) return { category: "pci", reason: "pci" };
      if (isMagecart) return { category: "magecart", reason: "magecart" };
      if (isSupplyChain) return { category: "supply-chain", reason: "supply-chain" };
      if (isConsent) return { category: "consent", reason: "consent" };
      if (isPrivacy) return { category: "privacy", reason: "privacy" };
      if (isAI) return { category: "ai-threats", reason: "ai" };
      if (isRetail) return { category: "retail", reason: "retail" };
      if (isFinancial) return { category: "financial", reason: "financial" };
      if (isPlatform) return { category: "low-context", reason: "platform" };
      if (isBlog) {
        // BUG 3 FIX: panel/webinar pages get priority routing to other panel/event pages
        if (url.includes("live-panel-discussion") || url.includes("panel-discussion") || url.includes("/webinar") || url.includes("webinar-")) {
          try {
            const allPages = await base44.asServiceRole.entities.WebsiteContent.list("-lastScanned", 500);
            const panelKws = ["panel-discussion", "live-panel", "/webinar/", "/events/"];
            const otherPanelPages = allPages.filter(p =>
              p.isActive === true &&
              normalizeUrl(p.pageUrl) !== normalizeUrl(currentPageUrl) &&
              panelKws.some(kw => (p.pageUrl || "").includes(kw))
            );
            if (otherPanelPages.length > 0) {
              return { category: "panel", reason: "panel-priority" };
            }
          } catch (e) {
            console.error("Panel priority lookup failed:", e.message);
          }
        }
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

      if (url.includes("offensive-hub") || url.includes("pentest") || url.includes("offensive")) {
        return { category: "pentest", reason: "pentest" };
      }

      return { category: "low-context", reason: "default" };
    }

    const routing = await determineRouting(currentPageUrl, referralSource, geo, pagesViewed, timeOnPage, hasActiveConversation, base44);

    // DIRECT_REGISTRATION: return hardcoded opener immediately, never hit cache
    if (routing.category === "DIRECT_REGISTRATION") {
      if ((currentPageUrl || "").includes("/plans/")) {
        const plansBubble = "Which platform are you securing: Shopify, WooCommerce, or Magento?";
        const plansOpener = "Most teams on the plans page already have a platform and a compliance driver in mind -- like PCI DSS for a WooCommerce or Shopify store. Tell us yours and we will show you exactly what is covered: [Start your free assessment](https://www.reflectiz.com/registration/)";
        return new Response(JSON.stringify({
          reply: decorateOpener(plansOpener, message, resolvedLang),
          bubbleText: plansBubble,
          lang: resolvedLang,
          sessionId
        }), { headers: CORS_HEADERS });
      }
      const competitorName = (currentPageUrl || "").includes("reflectiz-vs-")
        ? (currentPageUrl || "").split("reflectiz-vs-").pop().split("/")[0].replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase())
        : "";
      const hardcodedOpener = getHardcodedOpener(competitorName, resolvedLang);
      const COMPETITOR_BUBBLE: Record<string, string> = {
        en: competitorName ? `See how Reflectiz outperforms ${competitorName}` : "See your full web exposure now",
        de: competitorName ? `So schlägt Reflectiz ${competitorName}` : "Sehen Sie Ihre volle Web-Exposition",
        fr: competitorName ? `Voyez comment Reflectiz surpasse ${competitorName}` : "Voyez votre exposition web complète",
        es: competitorName ? `Vea cómo Reflectiz supera a ${competitorName}` : "Vea su exposición web completa",
        it: competitorName ? `Ecco come Reflectiz batte ${competitorName}` : "Vedi la tua esposizione web completa",
      };
      const hardcodedBubble = COMPETITOR_BUBBLE[resolvedLang] || COMPETITOR_BUBBLE.en;
      return new Response(JSON.stringify({ reply: decorateOpener(hardcodedOpener, message, resolvedLang), bubbleText: hardcodedBubble, lang: resolvedLang, sessionId }), { headers: CORS_HEADERS });
    }

    // Cache check -- only for non-DIRECT_REGISTRATION pages
    const cacheUrl = canonicalCacheUrl(currentPageUrl);
    const cachedResults = await base44.asServiceRole.entities.PageOpeners.filter({ pageUrl: cacheUrl, language: resolvedLang });
    let cached = cachedResults?.[0];
    if (cachedResults && cachedResults.length > 1) {
      // One-time duplicate cleanup: keep the freshest record, delete the rest.
      const sorted = cachedResults.slice().sort((a, b) => String(b.updated_date || b.generatedAt || "").localeCompare(String(a.updated_date || a.generatedAt || "")));
      cached = sorted[0];
      for (const dup of sorted.slice(1)) {
        await base44.asServiceRole.entities.PageOpeners.delete(dup.id).catch(() => {});
      }
    }
    if (cached && cached.opener && cached.opener.length > 20 && cached.pageUrl === cacheUrl) {
      const normalizedCurrent = normalizeUrl(currentPageUrl);
      const openerText = cached.opener || "";
      const linksSamePage = openerText.includes(normalizedCurrent) || openerText.includes(currentPageUrl.replace(/\/$/, ""));
      if (!linksSamePage) {
        const sanitizeCache = (s) => (s || "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#039;/g, "'").replace(/&#8211;/g, "-").replace(/&#8212;/g, "-");
        return new Response(JSON.stringify({ reply: decorateOpener(sanitizeCache(cached.opener), message, resolvedLang), bubbleText: sanitizeCache(cached.bubbleText || ""), lang: resolvedLang, sessionId }), { headers: CORS_HEADERS });
      }
    }

    let selectedAsset;
    let isMultiCandidate;
    let candidates;

    // Panel routing -- fetch companion panel/event pages dynamically from DB
    if (routing.reason === "panel-priority") {
      try {
        const allPages = await base44.asServiceRole.entities.WebsiteContent.list("-lastScanned", 500);
        const panelKeywords = ["panel-discussion", "live-panel", "/webinar/"];
        const securityEventKws = ["pci", "security", "compliance", "privacy", "supply", "pentest", "magecart", "threat", "breach", "risk"];
        const panelPages = allPages.filter(p => {
          if (!p.isActive || normalizeUrl(p.pageUrl) === normalizeUrl(currentPageUrl)) return false;
          if (!p.pageContent || p.pageContent.length <= 400) return false;
          const pUrl = (p.pageUrl || "").toLowerCase();
          const pTitle = (p.pageTitle || "").toLowerCase();
          // Core panel/webinar URLs always qualify
          if (panelKeywords.some(kw => pUrl.includes(kw))) return true;
          // /events/ pages only qualify if they are security-relevant
          if (pUrl.includes("/events/")) {
            return securityEventKws.some(kw => pUrl.includes(kw) || pTitle.includes(kw));
          }
          return false;
        }).map(p => ({
          url: p.pageUrl,
          label: deriveLabel(p.pageTitle, p.pageType),
          pageContent: p.pageContent,
          pageType: p.pageType,
          ageTier: 0,
        }));
        if (panelPages.length > 0) {
          candidates = panelPages;
          isMultiCandidate = panelPages.length >= 2;
          selectedAsset = isMultiCandidate ? null : panelPages[0];
        }
      } catch (e) {
        console.error("Panel candidate fetch failed:", e.message);
      }
    }

    if (!candidates) {
      const matchingAssets = await getCandidatesForCategory(routing.category, currentPageUrl, base44, pagesViewed);

      if (matchingAssets.length >= 2) {
        candidates = matchingAssets;
        isMultiCandidate = true;
      } else if (matchingAssets.length === 1) {
        candidates = matchingAssets;
        isMultiCandidate = false;
      } else {
        // Fallback: only pages explicitly tagged low-context in DB
        const fallback = await getCandidatesForCategory("low-context", currentPageUrl, base44, pagesViewed);
        candidates = fallback;
        isMultiCandidate = false;
      }
      selectedAsset = isMultiCandidate ? null : candidates[0];
    }

    // Never recommend the page the visitor is already on
    if (candidates && candidates.length > 0) {
      candidates = candidates.filter(c => normalizeUrl(c.url) !== normalizeUrl(currentPageUrl));
      if (selectedAsset && normalizeUrl(selectedAsset.url) === normalizeUrl(currentPageUrl)) {
        selectedAsset = candidates.length === 1 ? candidates[0] : null;
        isMultiCandidate = candidates.length >= 2;
      }
    }

    // Safety net: if no candidates found at all, return hardcoded registration opener
    if (!candidates || candidates.length === 0) {
      return new Response(JSON.stringify({
        reply: decorateOpener(getHardcodedOpener(null, resolvedLang), message, resolvedLang),
        bubbleText: "See your full web exposure now",
        lang: resolvedLang,
        sessionId
      }), { headers: CORS_HEADERS });
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

    function extractStatDenseSegment(raw) {
      const cleaned = sanitizeContent(raw);
      // Skip short lines (nav/title/header boilerplate); extract first dense paragraphs
      const paras = cleaned.split(/\n+/).filter(p => p.trim().length >= 80);
      return paras.length > 0 ? paras.slice(0, 6).join(" ").slice(0, 1500) : cleaned.slice(0, 1500);
    }

    if (!isMultiCandidate) {
      // pageContent is already on the candidate from getCandidatesForCategory; fall back to DB fetch if missing
      assetInsight = selectedAsset.pageContent
        ? extractStatDenseSegment(selectedAsset.pageContent)
        : extractStatDenseSegment(await fetchInsight(selectedAsset.url));
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
      candidates = shuffleWithinTiers(candidates);

      candidates = candidates.slice(0, 8);
      candidateInsights = candidates.map(c => ({
        url: c.url,
        label: c.label,
        insight: sanitizeContent(c.pageContent).slice(0, 600),
        performanceScore: c.performanceScore ?? 10,
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
Page meta description: ${pageDescription || "(none)"}
Current page content: "${currentPageContent || "(not in DB yet)"}"
Visitor geo: ${geo || "Unknown"}
Time on page: ${timeOnPage || 0} seconds — calibrate tone: under 10s visitor just arrived (be curious and broad); 15-60s actively reading (build on what they are reading); over 60s deeply engaged (go technical and specific)
Session journey: ${Array.isArray(pagesViewed) ? pagesViewed.join(" → ") : (pagesViewed || currentPageUrl)}
Journey note: if the visitor has seen multiple pages, infer their research angle from the sequence (e.g. compliance research, vendor evaluation, incident investigation) and use it to sharpen sentence 1.

CHOSEN NEXT STEP (use this exact link in your response):
Label: ${selectedAsset.label}
URL: ${selectedAsset.url}

WRITE TWO THINGS:

1. bubbleText: This is the thought bubble a visitor sees before they open the chat. It must feel like a person talking, not a headline. Write it the way a colleague would say it out loud.
Prefer a question over a statement when the page topic naturally invites one. Example: "Is your checkout actually secure?" beats "Checkout security risks revealed".
Must contain at least one of: a specific number, a named company, a named regulation, a named threat, or a direct you or your reference to the visitor.
Minimum 4 words, maximum 10 words. Sentence case only, never Title Case.
Never use marketing words like revealed, unveiled, insights, discover, explore, or learn, in any language (this includes their translated equivalents such as scopri/scoprire, decouvrez/decouvrir, entdecken/erfahren, descubre/descubra).
Always capitalize company names, product names, and acronyms correctly (for example PayPal, Stripe, OWASP, Jscrambler, XSS, CSRF), even mid-sentence -- never lowercase a brand name.
When the page title or content names a specific company, product, or incident, reference it by name instead of writing a generic sentence.

2. opener: Exactly 2 sentences.
REQUIRED: Your opener MUST include at least one of: (a) a specific percentage or number, (b) a named company or brand, (c) a named attack or threat vector, (d) a specific dollar or regulatory figure. Do not use vague openers.
Sentence 1: Write one sharp specific insight that makes the visitor want to click the link in sentence 2. ${assetInsight ? `Base it on this real content from the recommended page -- extract the single most compelling stat, result, or risk and rewrite it naturally: "${assetInsight.slice(0, 1000)}"` : "Use a specific fact or risk relevant to this page topic. Not generic."}
Sentence 2: Must be exactly this markdown link with no extra words before it: [${selectedAsset.label}](${selectedAsset.url})

ABSOLUTE RULES:
- Never mention how the visitor arrived, their search terms, or referral source
- Never use em dashes or double hyphens
- Never use greeting words like Hi or Hello
- Sentence 2 must use the exact label and URL provided above, no variations
- Sound like a knowledgeable peer, not a salesperson

Return only valid JSON, nothing else:
{"bubbleText": "5-6 words here", "opener": "Sentence one. [${selectedAsset.label}](${selectedAsset.url})"}${resolvedLang !== "en" ? `\nIMPORTANT: Write the opener sentence, the link label text (the text in square brackets), and the bubbleText in ${LANGUAGE_NAMES[resolvedLang]}. Keep the URL inside the parentheses exactly unchanged. Keep product names, brand names, and standard names like PCI DSS in their original form.${resolvedLang === "de" ? " Follow German capitalization rules: all nouns are capitalized, not just sentence starts." : ""}` : ""}`;
    } else {
      const candidateList = candidateInsights.map((c, i) =>
        `OPTION ${i + 1} [performance score: ${c.performanceScore}/30]:
Label: ${c.label}
URL: ${c.url}
Content: "${c.insight || "No content available, use general knowledge about this topic."}"`
      ).join("\n\n");

      openerPrompt = `You are Athena, a web security expert for Reflectiz. Write a chat opening message for a website visitor.
${(currentPageUrl || "").replace(/\/$/, "") === "https://www.reflectiz.com" ? "\nVISITOR CONTEXT: This visitor is on the homepage. Prefer recommending a specific product module, solution page, or customer success story (case study). Customer success stories with named brands and concrete results are a strong differentiator. Avoid blog posts. Homepage visitors need to discover what Reflectiz does and proof that it works.\n" : ""}${(currentPageUrl || "").includes("/customers/") ? "\nVISITOR CONTEXT: This visitor is reading a customer success story. Connect the recommendation to their context -- if the content is about retail/e-commerce security threats, frame it in terms of retail brand protection and revenue risk.\n" : ""}${(currentPageUrl || "").includes("/blog/") && routing && routing.category === "pci" ? "\nVISITOR CONTEXT: This visitor is reading educational blog content. Prefer recommending a solution/product page (such as a module page or use-case page) over another blog post or case study, as the visitor needs a clear next action.\n" : (currentPageUrl || "").includes("/blog/") ? "\nPick the most topically similar candidate to this blog article.\n" : ""}${routing && routing.reason === "comparison-pool" ? "\nVISITOR CONTEXT: This visitor is on a competitor comparison page. Pick the candidate that best highlights a concrete Reflectiz differentiator -- a specific technical advantage, a named customer proof point, or a quantified outcome. Lead with the differentiator, not a generic insight.\n" : ""}${routing && routing.reason === "panel-priority" ? "\nVISITOR CONTEXT: This visitor is on a panel/webinar page. Strongly prefer recommending the companion registration or related event page over other content.\n" : ""}${routing && routing.category === "pentest" ? "\nVISITOR CONTEXT: The visitor is reading about penetration testing methodology. Prefer recommending a pentest demo, pentest webinar, or offensive security product page as the next step.\n" : ""}
PAGE CONTEXT:
Page title: ${contextTitle}
Page URL: ${currentPageUrl}
Page meta description: ${pageDescription || "(none)"}
Current page content: "${currentPageContent || "(not in DB yet)"}"
Visitor geo: ${geo || "Unknown"}
Referral source: ${referralSource || "direct"}
Session journey: ${Array.isArray(pagesViewed) ? pagesViewed.join(" → ") : (pagesViewed || currentPageUrl)}
Journey note: analyze the page sequence. A visitor who went compliance page → supply-chain page → blog is in deep research mode and needs a specific technical angle. A visitor on their first page is still exploring. Use the journey to pick the sharpest, most relevant candidate and angle for this specific visitor.
Time on page: ${timeOnPage || 0} seconds — calibrate tone: under 10s visitor just arrived; 15-60s actively reading; over 60s deeply engaged (go more technical and specific).

**SENTENCE 1 RULE: REQUIRED -- your opener MUST include at least one of: (a) a specific percentage or number, (b) a named company or brand, (c) a named attack or threat vector, (d) a specific dollar or regulatory figure. Never start with vague phrases like "Many organizations", "Most teams", or "Understanding". If the current page content above contains a specific stat or fact, prefer using it in sentence 1 since the visitor is already engaged with that topic. If you cannot produce an opener meeting this requirement from the chosen candidate content, pick a DIFFERENT selectedUrl from the list that has more specific facts.

After the stat or named threat, connect it to the visitor directly with you or your, or end with a question that makes it personal. Example: "184 million patient records were stolen in 2024 -- is your healthcare site one of the exposure points?" is stronger than stopping at the stat alone. Write it as if you are starting a conversation with a security professional, not opening an article.**

CANDIDATE NEXT STEPS (pick the ONE best fit for THIS specific visitor, based on geo, referral source, and journey):
${candidateList}

WRITE THREE THINGS:

1. selectedUrl: The exact URL of the option you picked from above. Must be one of the URLs listed.

2. bubbleText: This is the thought bubble a visitor sees before they open the chat. It must feel like a person talking, not a headline. Write it the way a colleague would say it out loud.
Prefer a question over a statement when the page topic naturally invites one. Example: "Is your checkout actually secure?" beats "Checkout security risks revealed".
Must contain at least one of: a specific number, a named company, a named regulation, a named threat, or a direct you or your reference to the visitor.
Minimum 4 words, maximum 10 words. Sentence case only, never Title Case.
Never use marketing words like revealed, unveiled, insights, discover, explore, or learn, in any language (this includes their translated equivalents such as scopri/scoprire, decouvrez/decouvrir, entdecken/erfahren, descubre/descubra).
Always capitalize company names, product names, and acronyms correctly (for example PayPal, Stripe, OWASP, Jscrambler, XSS, CSRF), even mid-sentence -- never lowercase a brand name.
When the page title or content names a specific company, product, or incident, reference it by name instead of writing a generic sentence.
If the page is a competitor comparison page, the bubble must name the competitor. Example: "How does Reflectiz actually beat c/side?" not "Web security comparison insights".

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
{"selectedUrl": "...", "bubbleText": "5-6 words here", "opener": "Sentence one. [label](url)"}${resolvedLang !== "en" ? `\nIMPORTANT: Write the opener sentence, the link label text (the text in square brackets), and the bubbleText in ${LANGUAGE_NAMES[resolvedLang]}. Keep the URL inside the parentheses exactly unchanged. Keep product names, brand names, and standard names like PCI DSS in their original form.${resolvedLang === "de" ? " Follow German capitalization rules: all nouns are capitalized, not just sentence starts." : ""}` : ""}`;
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

    // Repair nested brackets inside markdown labels: [text [x] more](url) -> [text x more](url)
    if (opener) {
      opener = opener.replace(/\[([^\]]*)\[([^\]]*)\]([^\]]*)\]\(/g, "[$1$2$3](");
    }

    // Validate opener using Gemini's chosen asset
    // Only fall back to candidates[0] if opener already failed
    const validationAsset = (isMultiCandidate && selectedAsset) ? selectedAsset : candidates[0];
    const currentPageStripped = (currentPageUrl || "").replace(/\/$/, "");
    if (!opener || opener.replace(/\[.*?\]\(.*?\)/g, "").trim().split(/\s+/).filter(Boolean).length < 4 || !validationAsset ||
      !opener.includes(validationAsset.url.replace(/\/$/, "")) ||
      (currentPageStripped && opener.includes(currentPageStripped + ")")) ||
      (currentPageStripped && opener.includes(currentPageStripped + "/)"))) {
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
      opener = opener.replace(/\u2014/g, ",").replace(/\u2013/g, "-").replace(/--/g, ",");
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
      const FALLBACK_SENTENCES = {
        en: "This page covers one of the most critical areas in web security right now.",
        de: "Diese Seite behandelt einen der derzeit wichtigsten Bereiche der Web-Sicherheit.",
        fr: "Cette page couvre l'un des domaines les plus critiques de la sécurité web actuellement.",
        it: "Questa pagina tratta una delle aree più critiche della sicurezza web di oggi.",
        es: "Esta página cubre una de las áreas más críticas de la seguridad web actual.",
      };
      opener = `${FALLBACK_SENTENCES[resolvedLang] || FALLBACK_SENTENCES.en} [${fallbackAsset.label}](${fallbackAsset.url})`;
      const FALLBACK_BUBBLES = {
        en: "Web security insight worth reading",
        de: "Lesenswerte Web-Sicherheits-Einblicke",
        fr: "Un aperçu sécurité web à lire",
        it: "Approfondimento di sicurezza web da leggere",
        es: "Análisis de seguridad web que vale la pena leer",
      };
      bubbleText = bubbleText || (FALLBACK_BUBBLES[resolvedLang] || FALLBACK_BUBBLES.en);
    }

    // Derive bubble from opener if still empty
    if (!bubbleText) {
      bubbleText = opener.split(" ").slice(0, 6).join(" ");
    }

    // Curated bubble overrides generated one -- opener stays Gemini-generated
    if (curatedBubble) bubbleText = curatedBubble;

    // Ensure bubbleText starts with a capital letter (skips leading punctuation like ¿), known brand names are capitalized correctly, and no banned marketing words slipped through
    if (bubbleText) bubbleText = fixDiacritics(stripBannedMarketingWords(fixBrandCapitalization(capitalizeFirstLetter(bubbleText)), resolvedLang), resolvedLang);

    // Strip any Unicode en/em dashes from bubbleText
    if (bubbleText) bubbleText = bubbleText.replace(/[–—]/g, "--");

    // Cache
    if (isValidPageUrl && opener && bubbleText) {
      await upsertPageOpener(base44, canonicalCacheUrl(currentPageUrl), {
        opener,
        bubbleText,
        language: resolvedLang,
        generatedAt: new Date().toISOString(),
        isActive: true,
        isCurated: !!curatedBubble,
      });
    }

    return new Response(JSON.stringify({ reply: decorateOpener(opener, message, resolvedLang), bubbleText, lang: resolvedLang, sessionId }), { headers: CORS_HEADERS });
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

    const reply = (returningResponse.content[0]?.text ?? "Something bring you back today?").replace(/\u2014/g, ",").replace(/\u2013/g, "-");

    // No DB write for INIT -- the first real visitor message will create the record and fire slackAlert
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
  systemPrompt += `\n\nLANGUAGE RULE (CRITICAL, overrides everything else): Detect the language of the visitor's most recent message and reply in EXACTLY that language. The visitor's location or browser settings are irrelevant — if they write in English, answer in English, even if they are in France or Germany. Only if their message has no identifiable language (a URL, a number, one ambiguous word) reply in ${LANGUAGE_NAMES[resolvedLang] || "English"}.`;

  // Language detection: Hebrew characters => Hebrew; Israel geo without Hebrew => English; otherwise use browser language
  const containsHebrew = /[\u0590-\u05FF]/.test(message);
  const effectiveLanguage = containsHebrew ? "he" : (geo === "Israel" ? "en" : language);

  const relevantPages = await searchWebsiteContent(base44, message, currentPageUrl);
  const ragBlock = formatRetrievedPages(relevantPages);

  const messages = [...conversationHistory];

  const languageLabel = effectiveLanguage === "he" ? "he (Hebrew -- respond in Hebrew)" : "";
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
    .replace(/\u2014/g, ",")
    .replace(/ -- /g, ", ")
    .replace(/--/g, ",")
    .replace(/\u2013/g, "-");

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
    const normalizedCurrentPage = normalizeUrl(currentPageUrl);
    reply = reply.replace(urlRegex, (foundUrl) => {
      if (normalizeUrl(foundUrl) === normalizedCurrentPage) {
        return "https://www.reflectiz.com/learning-hub/";
      }
      return foundUrl;
    });
  }

  messages.push({ role: "assistant", content: reply });

  const existingConversation = await base44.asServiceRole.entities.Conversations.filter({ sessionId });
  const userMessageCount = messages.filter(m => m.role === "user").length;

  const intentClassification = await classifyIntent(messages, currentPageUrl);

  const ctaReached = /meeting|trial|contact|assessment|registration|sign up|demo/i.test(reply);

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
    const prevConv = existingConversation[0];
    const prevCtaReached = prevConv.ctaReached;

    // Consolidated alerts (Option B): only two transitions post a new Slack message here,
    // conversion (CTA reached) and the first-message fallback (used only when no
    // widget_opened event claimed the opening slot first). The former "engaged" milestone
    // at 3+ turns no longer posts anything -- ordinary mid-conversation turns stay silent.
    const fireConversionAlert = ctaReached && !prevCtaReached;
    const fireFirstMessageAlert = !fireConversionAlert && userMessageCount >= 1 && !prevConv.firstMessageAlertSent;

    await base44.asServiceRole.entities.Conversations.update(prevConv.id, {
      conversationTranscript: cleanTranscript,
      intentClassification,
      ctaReached,
      conversationTurns: userMessageCount,
      lastMessageRole,
      conversationOutcome,
      pagesViewed: Array.isArray(pagesViewed) ? pagesViewed.join(",") : (pagesViewed ?? ""),
      ...(fireFirstMessageAlert && { firstMessageAlertSent: true }),
      ...(fireConversionAlert && { firstMessageAlertSent: true }),
    });

    if (fireConversionAlert) {
      fetch("https://api.base44.app/api/apps/69edc5de1c84c71c086635e0/functions/slackAlert", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer app-key-AQMEVGjibXJE55B9QiqZnjCH" },
        body: JSON.stringify({
          sessionId,
          eventType: "conversion",
          triggerUrl: currentPageUrl ?? "",
          geo: geo ?? "",
          intentClassification,
          conversationTurns: userMessageCount,
          ctaReached: true,
          linksClicked: prevConv.linksClicked ?? 0,
          language: language ?? "en",
          referralSource: referralSource ?? "",
          conversationTranscript: cleanTranscript,
          pagesViewed: Array.isArray(pagesViewed) ? pagesViewed.join(",") : (pagesViewed ?? ""),
          conversationOutcome,
          isConversion: true,
        }),
      }).catch(err => console.error("slackAlert conversion notification failed:", err.message));
    } else if (fireFirstMessageAlert) {
      fetch("https://api.base44.app/api/apps/69edc5de1c84c71c086635e0/functions/slackAlert", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer app-key-AQMEVGjibXJE55B9QiqZnjCH" },
        body: JSON.stringify({
          sessionId,
          eventType: "new_conversation",
          triggerUrl: currentPageUrl ?? "",
          geo: geo ?? "",
          intentClassification,
          conversationTurns: userMessageCount,
          ctaReached,
          linksClicked: prevConv.linksClicked ?? 0,
          language: language ?? "en",
          referralSource: referralSource ?? "",
          conversationTranscript: cleanTranscript,
          pagesViewed: Array.isArray(pagesViewed) ? pagesViewed.join(",") : (pagesViewed ?? ""),
          conversationOutcome,
        }),
      }).catch(err => console.error("slackAlert conversation alert failed:", err.message));
    }
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
      firstMessageAlertSent: true,
    });

    fetch("https://api.base44.app/api/apps/69edc5de1c84c71c086635e0/functions/slackAlert", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer app-key-AQMEVGjibXJE55B9QiqZnjCH" },
      body: JSON.stringify({
        sessionId,
        eventType: "new_conversation",
        triggerUrl: currentPageUrl ?? "",
        geo: geo ?? "",
        intentClassification,
        conversationTurns: 1,
        ctaReached: ctaReached ?? false,
        linksClicked: 0,
        language: language ?? "en",
        referralSource: referralSource ?? "",
        conversationTranscript: cleanTranscript,
        pagesViewed: Array.isArray(pagesViewed) ? pagesViewed.join(",") : (pagesViewed ?? ""),
        conversationOutcome: "BOUNCED",
      }),
    }).catch(() => {});
  }

  return new Response(JSON.stringify({ reply, sessionId }), { headers: CORS_HEADERS });
});