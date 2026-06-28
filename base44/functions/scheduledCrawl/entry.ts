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

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const now = new Date().toISOString().split("T")[0];

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

  const summary = {
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
  return Response.json(summary);
});