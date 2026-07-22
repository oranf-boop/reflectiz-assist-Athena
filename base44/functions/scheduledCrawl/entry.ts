import { JWT } from "npm:google-auth-library@9.15.1";
import { createClientFromRequest } from "npm:@base44/sdk@0.8.25";

const HUB_PAGES_CRAWL = [
  "https://www.reflectiz.com/learning-hub/",
  "https://www.reflectiz.com/events/",
];

// --- Categorization helper ---

const CATEGORIZATION_HUB_PAGES = [
  "https://www.reflectiz.com/blog/",
  "https://www.reflectiz.com/learning-hub/",
  "https://www.reflectiz.com/industries/",
  "https://www.reflectiz.com/events/",
  "https://www.reflectiz.com/customers/",
  "https://www.reflectiz.com/use-cases/",
];

const VALID_CATEGORIES = ["pci", "magecart", "supply-chain", "privacy", "ai-threats", "retail", "healthcare", "financial", "comparison", "pentest", "low-context"];

let _geminiToken = null;
let _geminiTokenExpiry = 0;

async function getGeminiToken() {
  if (_geminiToken && Date.now() < _geminiTokenExpiry) return _geminiToken;
  const sa = JSON.parse(Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON"));
  const jwt = new JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  const { token } = await jwt.getAccessToken();
  _geminiToken = token;
  _geminiTokenExpiry = Date.now() + 55 * 60 * 1000; // 55 min cache
  return token;
}

async function categorizeContent(pageUrl, pageTitle, pageContent) {
  const normalizedUrl = (pageUrl || "").replace(/\/$/, "") + "/";
  if (CATEGORIZATION_HUB_PAGES.includes(normalizedUrl)) return [];
  if ((pageUrl || "").toLowerCase().includes("/learninghub/")) return [];

  try {
    const token = await getGeminiToken();
    const url = `https://us-central1-aiplatform.googleapis.com/v1/projects/dashboarderv0/locations/us-central1/publishers/google/models/gemini-2.5-flash-lite:generateContent`;

    const prompt = `Read this webpage content and determine which topic categories it covers. A page can have multiple categories or none.

CATEGORIES AND DEFINITIONS:
- pci: PCI DSS compliance, payment card security, checkout page security
- magecart: Magecart attacks, web skimming, checkout script injection
- supply-chain: third-party/fourth-party script risk, web supply chain, vendor script risk
- privacy: GDPR, CCPA, PIPEDA, cookie consent, tracking pixels, data privacy regulation
- ai-threats: AI-powered attacks, AI supply chain risk, AI-driven security threats
- retail: Pages specifically about the ecommerce or online retail industry as an industry vertical (e.g. a retail case study, a retail-focused report, retail-specific risks). Only assign if the page's target audience or subject is retailers/online stores/shopping platforms themselves -- NOT just because the page discusses checkout security, payment pages, or web scripts in general (those belong to pci/magecart/supply-chain, not retail).
- healthcare: Pages specifically about the healthcare industry, HIPAA, or patient data as the core subject -- not just any page that mentions "health" or medical examples in passing.
- financial: Pages specifically about the financial services or banking industry as an industry vertical -- not just any page that mentions payments or money in passing.
- comparison: comparing Reflectiz against a competitor
- pentest: penetration testing, offensive security testing
- low-context: general awareness content, broad research reports, introductory material

IMPORTANT: Only assign a category if it is a PRIMARY topic the page is substantively about -- not just mentioned in passing or implied by adjacent keywords. A page about an event dinner that briefly mentions 'payment page integrity' in one sentence is NOT a pci page unless PCI compliance is a core focus of the content. Most pages should have 1-3 categories. If you're tempted to assign 4 or more categories, re-read the content and ask whether it's truly that broad, or whether you're over-matching on keywords. Err toward fewer, more accurate categories.

PAGE TITLE: ${pageTitle || ""}
PAGE CONTENT: ${(pageContent || "").slice(0, 2000)}

Return only a JSON array of matching category strings from the list above, nothing else. Example: ["pci", "retail"]. If no categories clearly apply, return an empty array: []`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 128 },
      }),
    });

    if (!res.ok) return [];
    const data = await res.json();
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "[]";
    const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(c => VALID_CATEGORIES.includes(c));
  } catch (e) {
    console.error(`categorizeContent failed for ${pageUrl}: ${e.message}`);
    return [];
  }
}

function classifyPageType(url) {
  if (url === "https://www.reflectiz.com/" || url === "https://www.reflectiz.com") return "homepage";
  if (url.includes("/blog/")) return "blog";
  if (url.includes("/use-case/") || url.includes("/use-cases/")) return "use-case";
  if (url.includes("/product/")) return "product";
  if (url.includes("/customers/") || url.includes("/case-study/")) return "case-study";
  if (url.includes("/events/") || url.includes("/event/")) return "event";
  if (url.includes("/webinar/") || url.includes("/learning-hub/webinar")) return "webinar";
  if (url.includes("/learning-hub/")) return "other";
  if (url.includes("/vs-") || url.includes("/compare")) return "comparison";
  return "other";
}

function extractTextContent(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 10000);
}

function extractTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? match[1].replace(/\s+/g, " ").trim() : "";
}

// Parses sitemap and returns { url, lastmod } pairs
async function parseSitemap(url) {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; Reflectiz-Crawler/1.0)" } });
  const xml = await res.text();
  const entries = [];
  // Match each <url> block to get both loc and lastmod
  const urlBlocks = xml.matchAll(/<url>([\s\S]*?)<\/url>/g);
  for (const block of urlBlocks) {
    const locMatch = block[1].match(/<loc>([\s\S]*?)<\/loc>/);
    const lastmodMatch = block[1].match(/<lastmod>([\s\S]*?)<\/lastmod>/);
    if (!locMatch) continue;
    const u = locMatch[1].trim();
    const lastmod = lastmodMatch ? lastmodMatch[1].trim() : null;
    if (u.endsWith(".xml")) {
      const nested = await parseSitemap(u);
      entries.push(...nested);
    } else {
      entries.push({ url: u, lastmod });
    }
  }
  // Also capture any bare <loc> entries not wrapped in <url> (sitemap index entries)
  if (entries.length === 0) {
    const locMatches = xml.matchAll(/<loc>([\s\S]*?)<\/loc>/g);
    for (const match of locMatches) {
      const u = match[1].trim();
      if (u.endsWith(".xml")) {
        const nested = await parseSitemap(u);
        entries.push(...nested);
      } else {
        entries.push({ url: u, lastmod: null });
      }
    }
  }
  return entries;
}

// Extract internal reflectiz.com links from a hub page HTML
function extractInternalLinks(html, baseHost) {
  const links = new Set();
  const matches = html.matchAll(/href=["'](https?:\/\/www\.reflectiz\.com\/[^"'#?]+)["']/g);
  for (const m of matches) {
    const u = m[1].trim().replace(/\/$/, "") + "/";
    if (u.startsWith(`https://${baseHost}/`) && !u.includes("/wp-content/") && !u.includes("/wp-admin/")) {
      links.add(u);
    }
  }
  return [...links];
}

async function withRetry(fn, maxRetries = 3) {
  let delay = 1000;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const is429 = err?.message?.includes("429") || err?.message?.includes("Rate limit");
      if (is429 && attempt < maxRetries) {
        await new Promise(r => setTimeout(r, delay));
        delay *= 2;
      } else {
        throw err;
      }
    }
  }
}

const DEAD_PAGE_PATTERNS = [
  "temporarily unavailable",
  "page not found",
  "oops",
  "this page doesn't exist",
  "404 error",
  "we can't find the page",
];

function isDeadPage(content) {
  const lower = content.toLowerCase();
  return DEAD_PAGE_PATTERNS.some(p => lower.includes(p));
}

async function crawlPage(pageUrl, base44, now) {
  const pageRes = await fetch(pageUrl, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; Reflectiz-Crawler/1.0)" },
    signal: AbortSignal.timeout(12000),
  });
  if (!pageRes.ok) return { status: "failed", url: pageUrl };

  const html = await pageRes.text();
  const pageTitle = extractTitle(html);
  const pageContent = extractTextContent(html);
  const pageType = classifyPageType(pageUrl);

  const dead = isDeadPage(pageContent) || isDeadPage(html.slice(0, 5000));
  const isActive = !dead;
  const categories = dead ? [] : await categorizeContent(pageUrl, pageTitle, pageContent);

  if (dead) {
    console.log(`[DEAD PAGE] ${pageUrl} — marked inactive, skipping categorization`);
  }

  const existing = await withRetry(() =>
    base44.asServiceRole.entities.WebsiteContent.filter({ pageUrl })
  );

  if (existing && existing.length > 0) {
    const shouldUpdateCategories = !existing[0].lockCategories;
    await withRetry(() =>
      base44.asServiceRole.entities.WebsiteContent.update(existing[0].id, {
        pageTitle,
        pageContent,
        pageType,
        lastScanned: now,
        isActive,
        ...(shouldUpdateCategories ? { categories } : {})
      })
    );
    return { status: "updated", html };
  } else {
    await withRetry(() =>
      base44.asServiceRole.entities.WebsiteContent.create({
        pageUrl, pageTitle, pageContent, pageType, lastScanned: now, isActive, categories,
      })
    );
    return { status: "created", html };
  }
}

async function processBatch(urls, base44, now, batchSize = 3, delayMs = 600) {
  let created = 0, updated = 0, failed = 0;
  for (let i = 0; i < urls.length; i += batchSize) {
    const batch = urls.slice(i, i + batchSize);
    const results = await Promise.allSettled(batch.map(url => crawlPage(url, base44, now)));
    for (const result of results) {
      if (result.status === "fulfilled") {
        if (result.value.status === "created") created++;
        else if (result.value.status === "updated") updated++;
        else failed++;
      } else {
        failed++;
      }
    }
    if (i + batchSize < urls.length) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  return { created, updated, failed };
}

// --- PageOpeners nightly cache pre-warm ---
// Generates and caches openers in-process (reusing the same candidate-selection and
// Gemini-prompt pattern as reflectizAgent's INIT flow) instead of making an HTTP call
// to reflectizAgent. No shared module exists between the two Base44 functions, so the
// pipeline is ported here rather than imported.

const PREWARM_HIGH_VALUE_CATS = ["pci", "magecart", "healthcare", "financial", "pentest"];
const PREWARM_MAX_MS = 4 * 60 * 1000;
const PREWARM_BATCH_SIZE = 5;
const PREWARM_BATCH_DELAY_MS = 2000;
const PREWARM_LANG = "en";

// Blog URLs with a learning-hub companion take reflectizAgent's hub-companion branch,
// which generates a fresh opener via Gemini on every call and never reads the
// PageOpeners cache first. Warming these would write rows nobody ever serves from.
const PREWARM_BLOG_TO_HUB_KEYS = new Set([
  "https://www.reflectiz.com/blog/web-exposure-2026-article/",
  "https://www.reflectiz.com/blog/javascript-injection-playbook/",
  "https://www.reflectiz.com/blog/secure-vibe-coding/",
  "https://www.reflectiz.com/blog/tiktok-pixel-privacy-case-study/",
  "https://www.reflectiz.com/blog/evil-twin-checkout-case-study/",
  "https://www.reflectiz.com/blog/chatbots-risk-exposure/",
  "https://www.reflectiz.com/blog/pci-dss-solution-assessment-integrity360/",
  "https://www.reflectiz.com/blog/ai-typosquatting-guide/",
  "https://www.reflectiz.com/blog/iframe-security-guide/",
  "https://www.reflectiz.com/blog/ctem-guide-expert-ciso/",
  "https://www.reflectiz.com/blog/ctem-divide-market-research-article/",
  "https://www.reflectiz.com/blog/malicious-comment-case-study/",
  "https://www.reflectiz.com/blog/ai-supply-chain/",
  "https://www.reflectiz.com/blog/proactive-web-security/",
  "https://www.reflectiz.com/blog/web-exposure-management/",
  "https://www.reflectiz.com/blog/web-privacy-validation-guide/",
  "https://www.reflectiz.com/blog/cookie-privacy-case-study/",
]);

function prewarmNormalizeUrl(url) {
  if (!url) return "";
  return url.toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "").trim();
}

function prewarmCacheUrl(url) {
  if (!url) return "";
  let u = String(url).split("#")[0].split("?")[0].trim().toLowerCase();
  if (u && !u.endsWith("/")) u += "/";
  return u;
}

// Pages that never read the PageOpeners cache on the live INIT path:
//   - DIRECT_REGISTRATION pages (comparison, plans, pricing) return a hardcoded
//     opener before the cache is even checked.
//   - Form-nudge pages (/learning-hub/ subpages other than the index, /lp/ pages)
//     always generate fresh via Gemini and never consult the cache first.
//   - Blog pages in PREWARM_BLOG_TO_HUB_KEYS take the hub-companion branch, which
//     also generates fresh every call.
function prewarmIsNeverCached(pageUrl) {
  const s = (pageUrl || "").toLowerCase();
  if (s.includes("reflectiz-vs") || s.includes("vs-reflectiz") || s.includes("cside") || s.includes("/plans") || s.includes("/pricing")) return true;
  const normalized = s.replace(/^https?:\/\/(www\.)?reflectiz\.com/, "").replace(/\/$/, "");
  if (normalized.startsWith("/lp/") && normalized !== "/lp") return true;
  if (s.includes("/learning-hub/") && normalized !== "/learning-hub") return true;
  if (PREWARM_BLOG_TO_HUB_KEYS.has(prewarmCacheUrl(pageUrl))) return true;
  return false;
}

function prewarmPriority(page) {
  const u = (page.pageUrl || "").toLowerCase();
  const cats = Array.isArray(page.categories) ? page.categories : [];
  // The homepage has no dedicated tier in the original priority list and would
  // otherwise compete with every low-value blog post in tier 5 with no
  // deterministic ordering, risking it falling outside a 100-page nightly limit.
  // It is the single highest-value cacheable page, so it always warms first.
  if (u.replace(/\/$/, "") === "https://www.reflectiz.com") return 0;
  if (u.includes("/use-cases/")) return 1;
  if (u.includes("/blog/") && PREWARM_HIGH_VALUE_CATS.some(c => cats.includes(c))) return 2;
  if (u.includes("/learning-hub/")) return 3;
  if (u.includes("/platform/")) return 4;
  return 5;
}

async function prewarmUpsertOpener(base44, pageUrl, data) {
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
    console.error("prewarm upsert failed:", e.message);
  }
}

function prewarmSanitizeContent(text) {
  return (text || "").replace(/&#\d+;/g, " ").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim();
}

function prewarmDeriveLabel(pageTitle, pageType) {
  const typeLabels = {
    "case-study": "Read the case study", "use-case": "See the use case", "blog": "Read the article",
    "webinar": "Watch the webinar", "event": "Register for the event", "product": "Learn more",
    "comparison": "See the comparison", "homepage": "Visit the homepage", "other": "Learn more",
  };
  const base = typeLabels[pageType] || "Learn more";
  const cleanTitle = pageTitle ? prewarmSanitizeContent(pageTitle).split(/\s[–—|-]\s/)[0].replace(/[\[\]]/g, "").trim() : "";
  return cleanTitle || base;
}

function prewarmIsTaxonomyPage(url) {
  const u = (url || "").toLowerCase();
  return u.includes("/category/") || u.includes("/tag/") || u.includes("/author/") || u.includes("/page/") || u.includes("/event-locations/");
}

function prewarmIsHubPage(url) {
  const normalized = (url || "").replace(/\/$/, "") + "/";
  const exactHubs = [
    "https://www.reflectiz.com/blog/", "https://www.reflectiz.com/learning-hub/", "https://www.reflectiz.com/industries/",
    "https://www.reflectiz.com/events/", "https://www.reflectiz.com/customers/", "https://www.reflectiz.com/use-cases/",
    "https://www.reflectiz.com/security-hub/", "https://www.reflectiz.com/privacy-hub/", "https://www.reflectiz.com/offensive-hub/",
  ];
  if (exactHubs.includes(normalized)) return true;
  if ((url || "").toLowerCase().includes("/learninghub/")) return true;
  if ((url || "").toLowerCase().includes("/events/")) return true;
  return false;
}

function prewarmIsPRPage(url) {
  const u = (url || "").toLowerCase();
  return u.includes("/media/") || u.includes("/about/") || u.includes("/partners/");
}

const PREWARM_CATEGORY_PRIORITY = ["pci", "magecart", "supply-chain", "consent", "privacy", "ai-threats", "retail", "financial", "healthcare", "pentest", "comparison", "low-context"];

// Mirrors reflectizAgent's determineRouting for the content-driven branches only.
// A synthetic pre-warm visitor has no referral source or journey, so the
// paid-search and comparison-page DIRECT_REGISTRATION branches never apply here
// (those pages are excluded earlier by prewarmIsNeverCached anyway).
function prewarmDetermineCategory(page) {
  const url = (page.pageUrl || "").toLowerCase();
  const cats = Array.isArray(page.categories) ? page.categories : [];
  const isHomepageUrl = url.replace(/\/$/, "") === "https://www.reflectiz.com";

  if (!isHomepageUrl && cats.length > 0) {
    const matched = PREWARM_CATEGORY_PRIORITY.find(c => cats.includes(c));
    if (matched) return matched;
  }
  if (url.includes("/customers/")) return cats[0] || "low-context";
  if (url.includes("healthcare") || url.includes("hipaa")) return "healthcare";
  if (url.includes("pci") || url.includes("compliance") || url.includes("dss")) return "pci";
  if (url.includes("magecart") || url.includes("skimming")) return "magecart";
  if (url.includes("supply-chain") || url.includes("supply_chain") || url.includes("security-hub")) return "supply-chain";
  if (url.includes("consent") || url.includes("cookie-banner") || url.includes("shein") || url.includes("ccpa")) return "consent";
  if (url.includes("privacy") || url.includes("gdpr")) return "privacy";
  if (url.includes("ai-supply") || url.includes("ai-attack") || url.includes("ai-retail")) return "ai-threats";
  if (url.includes("ecommerce") || url.includes("retail") || url.includes("shopify")) return "retail";
  if (url.includes("financial") || url.includes("finance") || url.includes("banking") || url.includes("dora")) return "financial";
  if (url.includes("/platform/") || url.includes("/product/") || url.includes("remote-monitoring") || url.includes("how-it-works")) return "low-context";
  if (url.includes("/blog/") || url.includes("/learning-hub/")) return cats[0] || "low-context";
  if (url.includes("offensive-hub") || url.includes("pentest") || url.includes("offensive")) return "pentest";
  return "low-context";
}

// Mirrors reflectizAgent's getCandidatesForCategory.
function prewarmGetCandidates(category, currentPageUrl, allContent) {
  const currentNormalized = prewarmNormalizeUrl(currentPageUrl);
  const matches = allContent.filter(page =>
    page.isActive === true &&
    Array.isArray(page.categories) &&
    page.categories.includes(category) &&
    prewarmNormalizeUrl(page.pageUrl) !== currentNormalized &&
    prewarmNormalizeUrl(page.pageUrl) !== "reflectiz.com" &&
    page.pageContent && page.pageContent.length > 400 &&
    !prewarmIsTaxonomyPage(page.pageUrl) && !prewarmIsHubPage(page.pageUrl) && !prewarmIsPRPage(page.pageUrl)
  );
  const aged = matches.map(page => {
    const urlYear = (page.pageUrl || "").match(/\b(202[0-3]|201\d)\b/);
    let effYear = urlYear ? parseInt(urlYear[1]) : null;
    if (!effYear) {
      const textSample = ((page.pageTitle || "") + " " + (page.pageContent || "").slice(0, 3000));
      const mentioned = textSample.match(/\b20(1\d|2[0-6])\b/g);
      if (mentioned && mentioned.length > 0) effYear = Math.max(...mentioned.map(Number));
    }
    const ageTier = (!effYear || effYear >= 2025) ? 0 : (effYear === 2024 ? 1 : 2);
    const performanceScore = typeof page.performanceScore === "number" ? page.performanceScore : 10;
    return { url: page.pageUrl, label: prewarmDeriveLabel(page.pageTitle, page.pageType), pageContent: page.pageContent, pageType: page.pageType, ageTier, performanceScore };
  });
  aged.sort((a, b) => a.ageTier !== b.ageTier ? a.ageTier - b.ageTier : b.performanceScore - a.performanceScore);

  if ((currentPageUrl || "").includes("/customers/")) return aged.filter(c => c.pageType !== "case-study");

  if (currentNormalized === "reflectiz.com") {
    const nonBlog = aged.filter(c => c.pageType !== "blog");
    const caseStudies = allContent
      .filter(p => p.isActive === true && p.pageType === "case-study" && p.pageContent && p.pageContent.length > 400 &&
        prewarmNormalizeUrl(p.pageUrl) !== currentNormalized &&
        !nonBlog.some(c => prewarmNormalizeUrl(c.url) === prewarmNormalizeUrl(p.pageUrl)))
      .map(p => ({ url: p.pageUrl, label: prewarmDeriveLabel(p.pageTitle, p.pageType), pageContent: p.pageContent, pageType: p.pageType, ageTier: 0, performanceScore: typeof p.performanceScore === "number" ? p.performanceScore : 10 }));
    return nonBlog.concat(caseStudies);
  }
  return aged;
}

function prewarmExtractStatDenseSegment(raw) {
  const cleaned = prewarmSanitizeContent(raw);
  const paras = cleaned.split(/\n+/).filter(p => p.trim().length >= 80);
  return paras.length > 0 ? paras.slice(0, 6).join(" ").slice(0, 1500) : cleaned.slice(0, 1500);
}

function prewarmShuffleWithinTiers(arr) {
  const tiers = {};
  arr.forEach(c => { const t = c.ageTier || 0; if (!tiers[t]) tiers[t] = []; tiers[t].push(c); });
  return Object.keys(tiers).sort().reduce((acc, t) => acc.concat(tiers[t].sort(() => Math.random() - 0.5)), []);
}

async function callGeminiForPrewarm(prompt) {
  const token = await getGeminiToken();
  const url = `https://us-central1-aiplatform.googleapis.com/v1/projects/dashboarderv0/locations/us-central1/publishers/google/models/gemini-2.5-flash-lite:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 1024 } }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

const PREWARM_FALLBACK_SENTENCE_EN = "This page covers one of the most critical areas in web security right now.";
const PREWARM_FALLBACK_BUBBLE_EN = "Web security insight worth reading";

// Mirrors reflectizAgent's INIT opener pipeline: candidate selection, Gemini prompt,
// JSON parse, validation, fallback. Returns null when there is truly nothing to
// recommend, matching the live path, which also never writes to cache in that case.
async function prewarmGenerateOpener(page, allContent) {
  const currentPageUrl = page.pageUrl;
  const category = prewarmDetermineCategory(page);
  let candidates = prewarmGetCandidates(category, currentPageUrl, allContent);
  if (candidates.length === 0) candidates = prewarmGetCandidates("low-context", currentPageUrl, allContent);
  candidates = candidates.filter(c => prewarmNormalizeUrl(c.url) !== prewarmNormalizeUrl(currentPageUrl));
  if (candidates.length === 0) return null;

  const isMultiCandidate = candidates.length >= 2;
  let selectedAsset = isMultiCandidate ? null : candidates[0];
  const contextTitle = page.pageTitle || currentPageUrl;
  const currentPageContent = (page.pageContent || "").replace(/\s+/g, " ").trim().slice(0, 700);

  let openerPrompt;
  if (!isMultiCandidate) {
    const assetInsight = prewarmExtractStatDenseSegment(selectedAsset.pageContent || "");
    openerPrompt = `You are Athena, a web security expert for Reflectiz. Write a chat opening message for a website visitor.

PAGE CONTEXT:
Page title: ${contextTitle}
Page URL: ${currentPageUrl}
Current page content: "${currentPageContent || "(not in DB yet)"}"

CHOSEN NEXT STEP (use this exact link in your response):
Label: ${selectedAsset.label}
URL: ${selectedAsset.url}

WRITE TWO THINGS:

1. bubbleText: 5-6 words. Specific to the page topic. Creates curiosity. No question mark. No generic phrases like "your site" or "exposure".

2. opener: Exactly 2 sentences.
REQUIRED: Your opener MUST include at least one of: (a) a specific percentage or number, (b) a named company or brand, (c) a named attack or threat vector, (d) a specific dollar or regulatory figure. Do not use vague openers.
Sentence 1: Write one sharp specific insight that makes the visitor want to click the link in sentence 2. ${assetInsight ? `Base it on this real content from the recommended page, extract the single most compelling stat, result, or risk and rewrite it naturally: "${assetInsight.slice(0, 1000)}"` : "Use a specific fact or risk relevant to this page topic. Not generic."}
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
    candidates = prewarmShuffleWithinTiers(candidates).slice(0, 8);
    const candidateInsights = candidates.map(c => ({ url: c.url, label: c.label, insight: prewarmSanitizeContent(c.pageContent).slice(0, 600), performanceScore: c.performanceScore ?? 10 }));
    const candidateList = candidateInsights.map((c, i) =>
      `OPTION ${i + 1} [performance score: ${c.performanceScore}/30]:\nLabel: ${c.label}\nURL: ${c.url}\nContent: "${c.insight || "No content available, use general knowledge about this topic."}"`
    ).join("\n\n");

    openerPrompt = `You are Athena, a web security expert for Reflectiz. Write a chat opening message for a website visitor.
${currentPageUrl.replace(/\/$/, "") === "https://www.reflectiz.com" ? "\nVISITOR CONTEXT: This visitor is on the homepage. Prefer recommending a specific product module, solution page, or customer success story (case study). Avoid blog posts.\n" : ""}${(currentPageUrl || "").includes("/customers/") ? "\nVISITOR CONTEXT: This visitor is reading a customer success story. Connect the recommendation to their context.\n" : ""}

PAGE CONTEXT:
Page title: ${contextTitle}
Page URL: ${currentPageUrl}
Current page content: "${currentPageContent || "(not in DB yet)"}"

**SENTENCE 1 RULE: REQUIRED, your opener MUST include at least one of: (a) a specific percentage or number, (b) a named company or brand, (c) a named attack or threat vector, (d) a specific dollar or regulatory figure. Never start with vague phrases like "Many organizations", "Most teams", or "Understanding". If you cannot produce an opener meeting this requirement from the chosen candidate content, pick a DIFFERENT selectedUrl from the list that has more specific facts.**

CANDIDATE NEXT STEPS (pick the ONE best fit for this page's topic):
${candidateList}

WRITE THREE THINGS:

1. selectedUrl: The exact URL of the option you picked from above. Must be one of the URLs listed.

2. bubbleText: 5-6 words. Specific to the page topic. Creates curiosity. No question mark.

3. opener: Exactly 2 sentences.
Sentence 1: Write one sharp specific insight based on the content of the option you picked.
Sentence 2: Must be exactly the markdown link for the option you picked, with no extra words before it: [label](url)

ABSOLUTE RULES:
- Never use em dashes or double hyphens
- Never use greeting words like Hi or Hello
- Sentence 2 must use the exact label and URL of the option you selected, no variations
- Sound like a knowledgeable peer, not a salesperson

Return only valid JSON, nothing else:
{"selectedUrl": "...", "bubbleText": "5-6 words here", "opener": "Sentence one. [label](url)"}`;
  }

  let opener = null;
  let bubbleText = null;
  try {
    const rawText = await callGeminiForPrewarm(openerPrompt);
    const cleaned = rawText.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    opener = parsed.opener || null;
    bubbleText = parsed.bubbleText || null;
    if (isMultiCandidate && parsed.selectedUrl) {
      const matched = candidates.find(c => c.url === parsed.selectedUrl || c.url.replace(/\/$/, "") === String(parsed.selectedUrl).replace(/\/$/, ""));
      if (matched) selectedAsset = matched;
    }
  } catch (e) {
    console.error("prewarm Gemini call or parse failed for", currentPageUrl, e.message);
  }

  if (opener) {
    opener = opener.replace(/&#039;/g, "'").replace(/&#8211;/g, "-").replace(/&#8212;/g, "-").replace(/&/g, "&").replace(/"/g, '"').replace(/</g, "<").replace(/>/g, ">").replace(/&#\d+;/g, "").replace(/&[a-z]+;/g, "");
    opener = opener.replace(/\[([^\]]*)\[([^\]]*)\]([^\]]*)\]\(/g, "[$1$2$3](");
  }
  if (bubbleText) {
    bubbleText = bubbleText.replace(/&#039;/g, "'").replace(/&#8211;/g, "-").replace(/&#8212;/g, "-").replace(/&/g, "&").replace(/"/g, '"').replace(/&#\d+;/g, "").replace(/&[a-z]+;/g, "");
  }

  const validationAsset = (isMultiCandidate && selectedAsset) ? selectedAsset : candidates[0];
  const currentPageStripped = (currentPageUrl || "").replace(/\/$/, "");
  if (!opener || opener.replace(/\[.*?\]\(.*?\)/g, "").trim().split(/\s+/).filter(Boolean).length < 4 || !validationAsset ||
    !opener.includes(validationAsset.url.replace(/\/$/, "")) ||
    (currentPageStripped && opener.includes(currentPageStripped + ")")) ||
    (currentPageStripped && opener.includes(currentPageStripped + "/)"))) {
    opener = null;
  }
  if (isMultiCandidate && !selectedAsset) selectedAsset = candidates[0];

  const privacyViolations = ["direct traffic", "you came from", "you searched", "you landed", "after searching", "via google", "organic search", "indicates a strong", "your search", "coming from", "traffic to"];
  if (opener && privacyViolations.some(p => opener.toLowerCase().includes(p))) opener = null;

  if (opener) {
    opener = opener.replace(/—/g, ",").replace(/–/g, "-").replace(/--/g, ",");
    opener = opener.replace(/([^.!?])\s*\[/g, "$1. [").replace(/([.!?])\s*\.\s*\[/g, "$1 [");
    const linkMatch = opener.match(/\[.*?\]\(.*?\)/);
    const prose = opener.replace(/\[.*?\]\(.*?\)/g, "").trim();
    const sentences = prose.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0);
    if (sentences.length > 1) opener = sentences[0].trim() + (linkMatch ? " " + linkMatch[0] : "");
  }

  if (!opener) {
    const fallbackAsset = selectedAsset || candidates[0];
    opener = `${PREWARM_FALLBACK_SENTENCE_EN} [${fallbackAsset.label}](${fallbackAsset.url})`;
    bubbleText = bubbleText || PREWARM_FALLBACK_BUBBLE_EN;
  }
  if (!bubbleText) bubbleText = opener.split(" ").slice(0, 6).join(" ");

  return { opener, bubbleText };
}

async function prewarmPageOpeners(base44, limit) {
  const jobStart = Date.now();
  const result = { candidates: 0, warmed: 0, skipped_fresh: 0, skipped_never_cached: 0, no_candidates: 0, failed: 0, timed_out: false, elapsedMs: 0 };
  try {
    const allContent = await base44.asServiceRole.entities.WebsiteContent.list("-lastScanned", 1000);
    const eligible = (allContent || []).filter(p => p.isActive === true && Array.isArray(p.categories) && p.categories.length > 0 && p.pageUrl);
    result.skipped_never_cached = eligible.filter(p => prewarmIsNeverCached(p.pageUrl)).length;

    const candidates = eligible
      .filter(p => !prewarmIsNeverCached(p.pageUrl))
      .sort((a, b) => prewarmPriority(a) - prewarmPriority(b))
      .slice(0, limit);
    result.candidates = candidates.length;

    const freshCutoff = Date.now() - 23 * 60 * 60 * 1000;

    for (let i = 0; i < candidates.length; i += PREWARM_BATCH_SIZE) {
      if (Date.now() - jobStart > PREWARM_MAX_MS) {
        result.timed_out = true;
        console.log(`Pre-warm timeout safety triggered after ${i} of ${candidates.length} pages`);
        break;
      }
      const batch = candidates.slice(i, i + PREWARM_BATCH_SIZE);
      await Promise.allSettled(batch.map(async (page) => {
        try {
          const cacheUrl = prewarmCacheUrl(page.pageUrl);
          const existing = await base44.asServiceRole.entities.PageOpeners.filter({ pageUrl: cacheUrl, language: PREWARM_LANG });
          const fresh = (existing || []).some(r => r.opener && r.opener.length > 20 && r.generatedAt && new Date(r.generatedAt).getTime() > freshCutoff);
          if (fresh) { result.skipped_fresh++; return; }

          const generated = await prewarmGenerateOpener(page, allContent);
          if (!generated) { result.no_candidates++; return; }

          await prewarmUpsertOpener(base44, cacheUrl, {
            opener: generated.opener,
            bubbleText: generated.bubbleText,
            language: PREWARM_LANG,
            generatedAt: new Date().toISOString(),
            isActive: true,
          });
          result.warmed++;
        } catch (e) {
          console.error("prewarm failed for", page.pageUrl, e.message);
          result.failed++;
        }
      }));
      if (i + PREWARM_BATCH_SIZE < candidates.length) {
        await new Promise(r => setTimeout(r, PREWARM_BATCH_DELAY_MS));
      }
    }
  } catch (e) {
    console.error("prewarmPageOpeners fatal:", e.message);
  }

  result.elapsedMs = Date.now() - jobStart;
  console.log("PageOpeners prewarm:", JSON.stringify(result));

  const attempted = result.warmed + result.failed;
  if (attempted > 0 && result.failed / attempted > 0.2) {
    const SLACK_WEBHOOK_URL = Deno.env.get("SLACK_WEBHOOK_URL");
    if (SLACK_WEBHOOK_URL) {
      const text = `:warning: Pre-warm job completed with high failure rate: ${result.failed} of ${attempted} pages failed. Check Gemini quota.`;
      await fetch(SLACK_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      }).catch(err => console.error("Slack prewarm failure alert failed:", err.message));
    }
  }

  return result;
  }

  Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const now = new Date().toISOString().split("T")[0];
  let options = {};
  try { options = await req.json(); } catch (_e) { options = {}; }

  let summary = { prewarm_only: true, run_date: now };
  if (!options.prewarmOnly) {
  // Calculate cutoff: only crawl pages modified in the last 2 days (catch new + recently updated)
  const cutoffDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  // STEP 1: Parse sitemap and filter to recently modified pages
  const allEntries = await parseSitemap("https://www.reflectiz.com/sitemap.xml");

  // Filter: pages with lastmod >= cutoff OR no lastmod (crawl them to be safe)
  const recentEntries = allEntries.filter(e => !e.lastmod || e.lastmod.slice(0, 10) >= cutoffDate);
  const recentUrls = recentEntries.map(e => e.url).filter(u => 
    !u.includes("?faq_category=") && 
    !u.includes("?taxonomy=") &&
    !u.includes("?job_divisions") &&
    !u.includes("?tag=") &&
    !u.includes("?author=") &&
    !u.includes("?s=") &&
    !u.includes("/blog/category/") &&
    !u.includes("/security-hub/") &&
    !u.includes("/offensive-hub/") &&
    !u.includes("/privacy-hub/") &&
    !u.includes("/lp/")
  );

  console.log(`Sitemap total: ${allEntries.length}, recent (last 2 days): ${recentUrls.length}`);

  // STEP 2: Discover off-sitemap URLs from hub pages
  const hubUrls = new Set();
  for (const hubPage of HUB_PAGES_CRAWL) {
    try {
      const res = await fetch(hubPage, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; Reflectiz-Crawler/1.0)" },
        signal: AbortSignal.timeout(12000),
      });
      if (res.ok) {
        const html = await res.text();
        const links = extractInternalLinks(html, "www.reflectiz.com");
        links.forEach(l => hubUrls.add(l));
        console.log(`Hub ${hubPage}: found ${links.length} links`);
      }
    } catch (e) {
      console.log(`Hub fetch failed for ${hubPage}: ${e.message}`);
    }
  }

  // Combine: recent sitemap URLs + hub-discovered URLs not already in sitemap
  const sitemapUrlSet = new Set(allEntries.map(e => e.url));
  const offSitemapUrls = [...hubUrls].filter(u => !sitemapUrlSet.has(u) && !/\/page\/\d+\/?$/.test(u));
  console.log(`Off-sitemap URLs discovered from hubs: ${offSitemapUrls.length}`);

  const urlsToCrawl = [...new Set([...recentUrls, ...offSitemapUrls])];
  console.log(`Total URLs to crawl this run: ${urlsToCrawl.length}`);

  // STEP 3: Crawl all collected URLs
  const { created, updated, failed } = await processBatch(urlsToCrawl, base44, now);

  summary = {
    sitemap_total: allEntries.length,
    recent_from_sitemap: recentUrls.length,
    off_sitemap_discovered: offSitemapUrls.length,
    total_crawled: urlsToCrawl.length,
    created,
    updated,
    failed,
    cutoff_date: cutoffDate,
    run_date: now,
  };

  console.log("Scheduled crawl complete:", JSON.stringify(summary));
  }

  // STEP 4: PageOpeners cache pre-warm. Runs strictly after the crawl above has completed.
  summary.prewarm = await prewarmPageOpeners(base44, options.prewarmLimit || 100);
  console.log("Crawl + prewarm run finished:", JSON.stringify(summary));
  return Response.json(summary);
});