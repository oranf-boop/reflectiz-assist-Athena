import { JWT } from "npm:google-auth-library@9.15.1";
import { createClientFromRequest } from "npm:@base44/sdk@0.8.25";

const PROJECT_ID = "dashboarderv0";
const REGION = "us-central1";
const GEMINI_MODEL = "gemini-2.5-flash-lite";

const VALID_CATEGORIES = ["pci", "magecart", "supply-chain", "privacy", "ai-threats", "retail", "healthcare", "financial", "comparison", "pentest", "low-context"];

const HUB_PAGES = [
  "https://www.reflectiz.com/blog/",
  "https://www.reflectiz.com/learning-hub/",
  "https://www.reflectiz.com/industries/",
  "https://www.reflectiz.com/events/",
  "https://www.reflectiz.com/customers/",
  "https://www.reflectiz.com/use-cases/",
];

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

async function classifyWithGemini(record, token) {
  const url = `https://${REGION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${REGION}/publishers/google/models/${GEMINI_MODEL}:generateContent`;

  const categoryPrompt = `Read this webpage content and determine which topic categories it covers. A page can have multiple categories or none.

CATEGORIES AND DEFINITIONS:
- pci: PCI DSS compliance, payment card security, checkout page security
- magecart: Magecart attacks, web skimming, checkout script injection
- supply-chain: third-party/fourth-party script risk, web supply chain, vendor script risk
- privacy: GDPR, CCPA, PIPEDA, cookie consent, tracking pixels, data privacy regulation
- ai-threats: AI-powered attacks, AI supply chain risk, AI-driven security threats
- retail: ecommerce, online retail, shopping platforms
- healthcare: HIPAA, patient data, healthcare industry security
- financial: banking, financial services industry security
- comparison: comparing Reflectiz against a competitor
- pentest: penetration testing, offensive security testing
- low-context: general awareness content, broad research reports, introductory material

IMPORTANT: Only assign a category if it is a PRIMARY topic the page is substantively about -- not just mentioned in passing or implied by adjacent keywords. A page about an event dinner that briefly mentions 'payment page integrity' in one sentence is NOT a pci page unless PCI compliance is a core focus of the content. Most pages should have 1-3 categories. If you're tempted to assign 4 or more categories, re-read the content and ask whether it's truly that broad, or whether you're over-matching on keywords. Err toward fewer, more accurate categories.

PAGE TITLE: ${record.pageTitle || ""}
PAGE CONTENT: ${(record.pageContent || "").slice(0, 2000)}

Return only a JSON array of matching category strings from the list above, nothing else. Example: ["pci", "retail"]. If no categories clearly apply, return an empty array: []`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: categoryPrompt }] }],
      generationConfig: { maxOutputTokens: 128 },
    }),
  });

  if (!res.ok) throw new Error(`Gemini error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "[]";
  const cleaned = raw.replace(/```json|```/g, "").trim();
  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(c => VALID_CATEGORIES.includes(c));
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user || user.role !== "admin") {
      return Response.json({ error: "Forbidden: Admin access required" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const batchSize = body.batchSize ?? 20;
    const offset = body.offset ?? 0;

    // Fetch all records with internal pagination to avoid hardcoded cap
    let allActive = [];
    let skip = 0;
    const PAGE_SIZE = 200;
    while (true) {
      const page = await base44.asServiceRole.entities.WebsiteContent.list("created_date", PAGE_SIZE, skip);
      if (!page || page.length === 0) break;
      allActive = allActive.concat(page);
      if (page.length < PAGE_SIZE) break;
      skip += PAGE_SIZE;
    }

    // Only process records with no categories yet
    const uncategorized = allActive.filter(r =>
      r.isActive !== false &&
      (!r.categories || r.categories.length === 0) &&
      !HUB_PAGES.includes(r.pageUrl.replace(/\/$/, "") + "/")
    );

    const total = uncategorized.length;
    const batch = uncategorized.slice(offset, offset + batchSize);
    const hasMore = offset + batchSize < total;
    const nextOffset = hasMore ? offset + batchSize : null;

    if (batch.length === 0) {
      return Response.json({ message: "No uncategorized records to process.", total, offset, processed: 0, succeeded: 0, failed: 0, nextOffset: null });
    }

    const token = await getAccessToken();

    let succeeded = 0;
    let failed = 0;
    const errors = [];

    for (const record of batch) {
      try {
        const categories = await classifyWithGemini(record, token);
        await base44.asServiceRole.entities.WebsiteContent.update(record.id, { categories });
        console.log(`[OK] ${record.pageUrl} → [${categories.join(", ")}]`);
        succeeded++;
      } catch (err) {
        console.error(`[FAIL] ${record.pageUrl}: ${err.message}`);
        errors.push({ url: record.pageUrl, error: err.message });
        failed++;
      }
    }

    return Response.json({
      total_uncategorized: total,
      offset,
      batch_size: batchSize,
      processed: batch.length,
      succeeded,
      failed,
      errors,
      hasMore,
      nextOffset,
      message: hasMore ? `Call again with offset=${nextOffset} to continue.` : "All uncategorized records processed.",
    });

  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
});