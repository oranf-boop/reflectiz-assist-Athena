import { createClientFromRequest } from "npm:@base44/sdk@0.8.25";

// One-off cleanup: for each pageUrl in the request body, delete every English
// (missing or "en" language) PageOpeners row except the single most recent one.
// Temporary tool, not part of the app's real feature set -- safe to remove after use.
Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  let body = {};
  try { body = await req.json(); } catch (_e) {}
  const urls = Array.isArray(body.pageUrls) ? body.pageUrls : [];
  const results = [];

  for (const pageUrl of urls) {
    const all = await base44.asServiceRole.entities.PageOpeners.filter({ pageUrl });
    const english = (all || []).filter(r => (r.language || "en") === "en");
    const sorted = english.slice().sort((a, b) =>
      String(b.updated_date || b.generatedAt || "").localeCompare(String(a.updated_date || a.generatedAt || ""))
    );
    const keep = sorted[0];
    const toDelete = sorted.slice(1);
    let deleted = 0;
    for (const row of toDelete) {
      try {
        await base44.asServiceRole.entities.PageOpeners.delete(row.id);
        deleted++;
      } catch (e) {
        console.error("delete failed for", row.id, e.message);
      }
    }
    results.push({ pageUrl, totalFound: (all || []).length, englishFound: english.length, kept: keep ? keep.id : null, deleted });
  }

  return Response.json({ results });
});
