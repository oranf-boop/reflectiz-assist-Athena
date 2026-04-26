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
  // Remove scripts, styles, nav, footer, header
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Limit to 10000 chars to avoid hitting field size limits
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
    // Recurse into nested sitemaps
    if (u.endsWith(".xml")) {
      const nested = await parseSitemap(u);
      urls.push(...nested);
    } else {
      urls.push(u);
    }
  }
  return urls;
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();

  if (user?.role !== "admin") {
    return Response.json({ error: "Forbidden: Admin access required" }, { status: 403 });
  }

  const urls = await parseSitemap("https://www.reflectiz.com/sitemap.xml");

  let created = 0;
  let updated = 0;
  let failed = 0;
  const now = new Date().toISOString().split("T")[0];

  for (const pageUrl of urls) {
    try {
      const pageRes = await fetch(pageUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; Reflectiz-Crawler/1.0)" },
      });
      if (!pageRes.ok) { failed++; continue; }

      const html = await pageRes.text();
      const pageTitle = extractTitle(html);
      const pageContent = extractTextContent(html);
      const pageType = classifyPageType(pageUrl);

      const existing = await base44.asServiceRole.entities.WebsiteContent.filter({ pageUrl });

      if (existing && existing.length > 0) {
        await base44.asServiceRole.entities.WebsiteContent.update(existing[0].id, {
          pageTitle,
          pageContent,
          pageType,
          lastScanned: now,
          isActive: true,
        });
        updated++;
      } else {
        await base44.asServiceRole.entities.WebsiteContent.create({
          pageUrl,
          pageTitle,
          pageContent,
          pageType,
          lastScanned: now,
          isActive: true,
        });
        created++;
      }
    } catch (e) {
      failed++;
    }
  }

  return Response.json({
    total: urls.length,
    created,
    updated,
    failed,
  });
});