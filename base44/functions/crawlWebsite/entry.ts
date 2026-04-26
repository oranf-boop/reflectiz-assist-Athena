import { createClientFromRequest } from "npm:@base44/sdk@0.8.25";

function classifyPageType(url) {
  if (url === "https://www.reflectiz.com/" || url === "https://www.reflectiz.com") return "homepage";
  if (url.includes("/blog/")) return "blog";
  if (url.includes("/use-case/") || url.includes("/use-cases/")) return "use-case";
  if (url.includes("/product/")) return "product";
  if (url.includes("/customers/") || url.includes("/case-study/")) return "case-study";
  if (url.includes("/webinar/") || url.includes("/event/")) return "webinar";
  if (url.includes("/vs-") || url.includes("/compare")) return "comparison";
  return "other";
}

function extractTextContent(html) {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, 10000);
}

function extractTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? match[1].replace(/\s+/g, " ").trim() : "";
}

async function parseSitemap(url) {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; Reflectiz-Crawler/1.0)" } });
  const xml = await res.text();
  const urls = [];
  const locMatches = xml.matchAll(/<loc>([\s\S]*?)<\/loc>/g);
  for (const match of locMatches) {
    const u = match[1].trim();
    if (u.endsWith(".xml")) {
      const nested = await parseSitemap(u);
      urls.push(...nested);
    } else {
      urls.push(u);
    }
  }
  return urls;
}

async function withRetry(fn, maxRetries = 4) {
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

async function crawlPage(pageUrl, base44, now) {
  const pageRes = await fetch(pageUrl, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; Reflectiz-Crawler/1.0)" },
    signal: AbortSignal.timeout(10000),
  });
  if (!pageRes.ok) return { status: "failed" };

  const html = await pageRes.text();
  const pageTitle = extractTitle(html);
  const pageContent = extractTextContent(html);
  const pageType = classifyPageType(pageUrl);

  const existing = await withRetry(() =>
    base44.asServiceRole.entities.WebsiteContent.filter({ pageUrl })
  );

  if (existing && existing.length > 0) {
    await withRetry(() =>
      base44.asServiceRole.entities.WebsiteContent.update(existing[0].id, {
        pageTitle, pageContent, pageType, lastScanned: now, isActive: true,
      })
    );
    return { status: "updated" };
  } else {
    await withRetry(() =>
      base44.asServiceRole.entities.WebsiteContent.create({
        pageUrl, pageTitle, pageContent, pageType, lastScanned: now, isActive: true,
      })
    );
    return { status: "created" };
  }
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();

  if (user?.role !== "admin") {
    return Response.json({ error: "Forbidden: Admin access required" }, { status: 403 });
  }

  const reqBody = await req.json().catch(() => ({}));
  // offset + limit allow paginated chunk crawling
  const offset = reqBody.offset || 0;
  const limit = reqBody.limit || 50;
  const batchSize = reqBody.batchSize || 3;
  const delayMs = reqBody.delayMs !== undefined ? reqBody.delayMs : 800;

  const allUrls = await parseSitemap("https://www.reflectiz.com/sitemap.xml");
  const chunk = allUrls.slice(offset, offset + limit);

  let created = 0, updated = 0, failed = 0;
  const now = new Date().toISOString().split("T")[0];

  for (let i = 0; i < chunk.length; i += batchSize) {
    const batch = chunk.slice(i, i + batchSize);
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
    if (i + batchSize < chunk.length) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  return Response.json({
    total_in_sitemap: allUrls.length,
    offset,
    processed: chunk.length,
    created,
    updated,
    failed,
    next_offset: offset + limit < allUrls.length ? offset + limit : null,
  });
});