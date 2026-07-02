import { JWT } from "npm:google-auth-library@9.15.1";
import { createClientFromRequest } from "npm:@base44/sdk@0.8.25";

const PROJECT_ID = "dashboarderv0";
const REGION = "us-central1";
const GEMINI_MODEL = "gemini-2.5-flash";

async function callGemini({ system, messages, max_tokens }) {
  const sa = JSON.parse(Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON"));
  const jwt = new JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  const { token } = await jwt.getAccessToken();
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
  if (!res.ok) throw new Error(`Gemini error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  return { content: [{ text }] };
}

function normalizeUrl(url) {
  if (!url) return "";
  return url.toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "").trim();
}

function mostCommon(arr) {
  if (!arr.length) return null;
  const freq = {};
  for (const v of arr) if (v) freq[v] = (freq[v] || 0) + 1;
  return Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

function average(arr) {
  const nums = arr.filter(n => typeof n === "number");
  if (!nums.length) return 0;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10;
}

function extractPatterns(conversations) {
  return {
    mostCommonIntent: mostCommon(conversations.map(c => c.intentClassification)),
    mostCommonReferral: mostCommon(conversations.map(c => c.referralSource)),
    mostCommonGeo: mostCommon(conversations.map(c => c.geo)),
    avgTurns: average(conversations.map(c => c.conversationTurns)),
    lastMessageRoleBreakdown: {
      user: conversations.filter(c => c.lastMessageRole === "user").length,
      assistant: conversations.filter(c => c.lastMessageRole === "assistant").length,
    },
    count: conversations.length,
  };
}

function analyzeClickData(clicks, conversations) {
  const convMap = {};
  for (const c of conversations) convMap[c.sessionId] = c;

  const urlFreq = {};
  const urlByOutcome = {};
  const turnFreq = {};
  const contentTypeFreq = {};
  const segmentFreq = { geo: {}, referralSource: {}, intentClassification: {} };

  for (const click of clicks) {
    const url = click.clickedUrl || "unknown";
    const conv = convMap[click.sessionId];
    const outcome = conv?.conversationOutcome ?? "unknown";
    const turn = click.turnNumber ?? 0;

    urlFreq[url] = (urlFreq[url] || 0) + 1;

    if (!urlByOutcome[url]) urlByOutcome[url] = { converted: 0, dropped: 0 };
    if (outcome === "CONVERTED" || (outcome === "ENGAGED" && (conv?.conversationTurns || 0) >= 3)) {
      urlByOutcome[url].converted++;
    } else if (outcome === "DROPPED" || outcome === "BOUNCED") {
      urlByOutcome[url].dropped++;
    }

    turnFreq[turn] = (turnFreq[turn] || 0) + 1;

    let contentType = "other";
    if (url.includes("/blog/")) contentType = "blog";
    else if (url.includes("/case-study/") || url.includes("/customers/")) contentType = "case-study";
    else if (url.includes("/product/") || url.includes("/platform/")) contentType = "product";
    else if (url.includes("/use-case/")) contentType = "use-case";
    else if (url.includes("/vs-") || url.includes("/compare")) contentType = "comparison";
    contentTypeFreq[contentType] = (contentTypeFreq[contentType] || 0) + 1;

    if (conv) {
      for (const seg of ["geo", "referralSource", "intentClassification"]) {
        const val = conv[seg] || "unknown";
        if (!segmentFreq[seg][val]) segmentFreq[seg][val] = 0;
        segmentFreq[seg][val]++;
      }
    }
  }

  const topUrls = Object.entries(urlFreq).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const topTurns = Object.entries(turnFreq).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const topContentTypes = Object.entries(contentTypeFreq).sort((a, b) => b[1] - a[1]);
  const topSegments = {};
  for (const seg of ["geo", "referralSource", "intentClassification"]) {
    topSegments[seg] = Object.entries(segmentFreq[seg]).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }

  return { topUrls, urlByOutcome, topTurns, topContentTypes, topSegments, totalClicks: clicks.length };
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me().catch(() => null);
  const isScheduled = !user;
  const isAdmin = user?.role === "admin";
  if (!isScheduled && !isAdmin) {
    return Response.json({ error: "Forbidden: Admin access required" }, { status: 403 });
  }

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [allConversations, allClicks] = await Promise.all([
    base44.asServiceRole.entities.Conversations.list("-timestamp", 500),
    base44.asServiceRole.entities.LinkClicks.list("-clickedAt", 2000),
  ]);

  const recent = allConversations.filter(c => c.timestamp && c.timestamp >= sevenDaysAgo && !c.isTrainingData);
  const recentClicks = allClicks.filter(c => c.clickedAt && c.clickedAt >= sevenDaysAgo);

  const winners = recent.filter(c =>
    c.conversationOutcome === "CONVERTED" ||
    (c.conversationOutcome === "ENGAGED" && (c.conversationTurns || 0) >= 3)
  );
  const losers = recent.filter(c =>
    c.conversationOutcome === "DROPPED" || c.conversationOutcome === "BOUNCED"
  );

  const winnerPatterns = extractPatterns(winners);
  const loserPatterns = extractPatterns(losers);
  const clickData = analyzeClickData(recentClicks, recent);

  // ── OPENER CACHE INVALIDATION ──────────────────────────────────────────────
  // Group real (non-training) conversations by their landing page (first in pagesViewed).
  // Pages where >60% of sessions bounce with zero clicks have a bad cached opener — delete it.
  const pageSessionMap = {};
  for (const conv of recent) {
    const firstPage = (conv.pagesViewed || "").split(",")[0].trim();
    if (!firstPage) continue;
    const key = normalizeUrl(firstPage);
    if (!pageSessionMap[key]) pageSessionMap[key] = { total: 0, pureBouncedNoClick: 0 };
    pageSessionMap[key].total++;
    if (conv.conversationOutcome === "BOUNCED" && !(conv.linksClicked > 0)) {
      pageSessionMap[key].pureBouncedNoClick++;
    }
  }
  const urlsToInvalidate = Object.entries(pageSessionMap)
    .filter(([_, s]) => s.total >= 5 && s.pureBouncedNoClick / s.total > 0.6)
    .map(([url]) => url);

  if (urlsToInvalidate.length > 0) {
    const allOpeners = await base44.asServiceRole.entities.PageOpeners.list("-generatedAt", 500);
    const staleOpeners = allOpeners.filter(o =>
      urlsToInvalidate.includes(normalizeUrl(o.pageUrl))
    );
    await Promise.all(
      staleOpeners.map(o => base44.asServiceRole.entities.PageOpeners.delete(o.id).catch(() => {}))
    );
    console.log(`Invalidated ${staleOpeners.length} stale PageOpeners for pages with >60% pure bounce rate.`);
  }

  // ── CONTENT PERFORMANCE SCORE UPDATE ──────────────────────────────────────
  // Use urlByOutcome from click data to write a 0-30 performance score to WebsiteContent.
  // Score = (converted / total) * 30. Only update pages with at least 3 data points.
  const performanceUpdates = [];
  for (const [url, outcomes] of Object.entries(clickData.urlByOutcome)) {
    const total = (outcomes.converted || 0) + (outcomes.dropped || 0);
    if (total < 3) continue;
    const score = Math.round((outcomes.converted / total) * 30);
    performanceUpdates.push({ url: normalizeUrl(url), score });
  }

  if (performanceUpdates.length > 0) {
    const allContent = await base44.asServiceRole.entities.WebsiteContent.list("-lastScanned", 1000);
    const contentById = {};
    for (const page of allContent) contentById[normalizeUrl(page.pageUrl)] = page;
    await Promise.all(
      performanceUpdates.map(({ url, score }) => {
        const page = contentById[url];
        if (!page) return Promise.resolve();
        return base44.asServiceRole.entities.WebsiteContent.update(page.id, { performanceScore: score }).catch(() => {});
      })
    );
    console.log(`Updated performanceScore for ${performanceUpdates.length} pages from click outcome data.`);
  }

  // Sample up to 8 winning and 8 losing transcripts that have actual text
  const winnerSample = winners
    .filter(c => c.conversationTranscript && c.conversationTranscript.length > 100)
    .slice(0, 8);
  const loserSample = losers
    .filter(c => c.conversationTranscript && c.conversationTranscript.length > 100)
    .slice(0, 8);

  const winnerTranscripts = winnerSample.map((c, i) =>
    `=== WINNER ${i+1} (${c.intentClassification}, ${c.geo}, ${c.conversationTurns} turns, outcome: ${c.conversationOutcome}) ===\n${c.conversationTranscript}`
  ).join('\n\n');

  const loserTranscripts = loserSample.map((c, i) =>
    `=== LOSER ${i+1} (${c.intentClassification}, ${c.geo}, ${c.conversationTurns} turns, outcome: ${c.conversationOutcome}) ===\n${c.conversationTranscript}`
  ).join('\n\n');

  const hasTranscripts = winnerSample.length > 0 || loserSample.length > 0;

  const [conversationResponse, contentResponse] = await Promise.all([
    callGemini({
      max_tokens: 2048,
      messages: [{
        role: "user",
        content: `You are a conversation coach analyzing real B2B chat transcripts for Reflectiz, a web security company. Your job is to find specific, actionable patterns that explain why some conversations converted visitors and others lost them.

WINNING CONVERSATIONS (${winnerSample.length} total — these ended in conversion or deep engagement):
${winnerTranscripts || '(none available this week)'}

LOSING CONVERSATIONS (${loserSample.length} total — these ended in drop or bounce):
${loserTranscripts || '(none available this week)'}

AGGREGATE CONTEXT:
Total conversations this week: ${recent.length}
Winners: ${winners.length} | Losers: ${losers.length}
Most common intent: ${winnerPatterns.mostCommonIntent}
Avg turns (winners): ${winnerPatterns.avgTurns} | Avg turns (losers): ${loserPatterns.avgTurns}

Read the transcripts carefully. Identify SPECIFIC language patterns, question types, pivot moments, and mistakes.

Return ONLY a valid JSON object, no markdown:
{
  "successReasons": "Specific patterns from the winning transcripts: what exact phrases, pivots, or moments kept visitors engaged. Quote examples if possible.",
  "failureReasons": "Specific patterns from the losing transcripts: what exact phrases, question sequences, or moments caused drop-off. Quote examples if possible.",
  "openingMessageChanges": "Specific changes to how the agent should open conversations based on what worked and what did not.",
  "conversationFlowChanges": "Specific changes to turn 2 and turn 3 flow based on the transcript patterns. Be concrete.",
  "geoAndSourceInsights": "Patterns by visitor geo or intent type visible in the transcripts.",
  "confidenceScore": 5,
  "confidenceReason": "One sentence explaining how confident you are based on sample size and pattern clarity."
}`
      }],
    }),
    callGemini({
      max_tokens: 1024,
      messages: [{
        role: "user",
        content: `You are analyzing link click data from a B2B website chat agent for Reflectiz, a cybersecurity company. Return ONLY a valid JSON object with no markdown, no explanation, no code blocks.

Total clicks in the last 7 days: ${clickData.totalClicks}

Top clicked URLs (url, clicks):
${clickData.topUrls.map(([url, count]) => `  ${url}: ${count} clicks`).join("\n")}

Click rates by content type:
${clickData.topContentTypes.map(([type, count]) => `  ${type}: ${count} clicks`).join("\n")}

Most common turn numbers when clicks happened:
${clickData.topTurns.map(([turn, count]) => `  Turn ${turn}: ${count} clicks`).join("\n")}

Top clicking segments:
  By geo: ${clickData.topSegments.geo.map(([v, c]) => `${v} (${c})`).join(", ")}
  By referral: ${clickData.topSegments.referralSource.map(([v, c]) => `${v} (${c})`).join(", ")}
  By intent: ${clickData.topSegments.intentClassification.map(([v, c]) => `${v} (${c})`).join(", ")}

URL performance by outcome (converted vs dropped visitors):
${Object.entries(clickData.urlByOutcome).slice(0, 10).map(([url, o]) => `  ${url}: ${o.converted} converted, ${o.dropped} dropped`).join("\n")}

Return exactly this JSON structure:
{
  "topPerformingContent": "which content drives most engagement and from which visitor segments",
  "converterContent": "what content converted visitors click vs dropoffs",
  "clickTiming": "at what turn visitors click links early curiosity vs late validation",
  "contentRecommendations": "specific content the agent should prioritize recommending"
}`
      }],
    }),
  ]);

  // Parse conversation analysis JSON
  const convRawText = conversationResponse.content[0]?.text ?? "";
  const convJsonMatch = convRawText.match(/\{[\s\S]*\}/);
  const analysis = convJsonMatch ? JSON.parse(convJsonMatch[0]) : null;

  let parsedAnalysis = null;
  if (convJsonMatch) {
    try {
      parsedAnalysis = JSON.parse(convJsonMatch[0]);
    } catch (e) {
      console.error("JSON parse error for analysis:", e.message);
    }
  }

  const topSuccessPatterns = parsedAnalysis?.successReasons ?? convRawText;
  const topFailurePatterns = parsedAnalysis?.failureReasons ?? "";
  const suggestedChanges = [
    parsedAnalysis?.openingMessageChanges,
    parsedAnalysis?.conversationFlowChanges,
    parsedAnalysis?.geoAndSourceInsights,
  ].filter(Boolean).join("\n\n");
  const confidenceScore = typeof parsedAnalysis?.confidenceScore === "number"
    ? Math.min(10, Math.max(1, parsedAnalysis.confidenceScore))
    : 5;

  // Parse content performance JSON
  const contentRawText = contentResponse.content[0]?.text ?? "";
  const contentJsonMatch = contentRawText.match(/\{[\s\S]*\}/);
  let parsedContent = null;
  if (contentJsonMatch) {
    try { parsedContent = JSON.parse(contentJsonMatch[0]); } catch (_) {}
  }

  const contentPerformance = parsedContent
    ? [
        parsedContent.topPerformingContent,
        parsedContent.converterContent,
        parsedContent.clickTiming,
        parsedContent.contentRecommendations,
      ].filter(Boolean).join("\n\n")
    : contentRawText;

  const conversionRate = recent.length > 0
    ? Math.round((winners.length / recent.length) * 1000) / 10
    : 0;

  const today = new Date().toISOString().split("T")[0];
  const weekStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  const report = await base44.asServiceRole.entities.LearningReports.create({
    reportDate: today,
    weekStartDate: weekStart,
    totalConversations: recent.length,
    winnerCount: winners.length,
    loserCount: losers.length,
    conversionRate,
    topSuccessPatterns,
    topFailurePatterns,
    suggestedChanges,
    confidenceScore,
    appliedToAgent: false,
    contentPerformance,
  });

  return Response.json({
    report,
    fullAnalysis: { analysis: parsedAnalysis, contentAnalysis: parsedContent },
    contentPerformance,
    patterns: { winners: winnerPatterns, losers: loserPatterns },
    clickData,
    invalidatedOpeners: urlsToInvalidate.length,
    performanceScoresUpdated: performanceUpdates.length,
  });
});