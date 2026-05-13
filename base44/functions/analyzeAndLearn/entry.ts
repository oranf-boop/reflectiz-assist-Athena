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

  const recent = allConversations.filter(c => c.timestamp && c.timestamp >= sevenDaysAgo);
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

  const [conversationResponse, contentResponse] = await Promise.all([
    callGemini({
      max_tokens: 2048,
      messages: [{
        role: "user",
        content: `You are analyzing website chat conversations for Reflectiz, a B2B cybersecurity company. Your job is to identify what made successful conversations work and what caused failures, then suggest specific improvements to the agent's opening messages, tone, and conversation flow.

Here are the winning conversation patterns:
${JSON.stringify(winnerPatterns, null, 2)}

Here are the losing conversation patterns:
${JSON.stringify(loserPatterns, null, 2)}

Total sample: ${recent.length} conversations (${winners.length} winners, ${losers.length} losers) from the last 7 days.

Based on this data provide:
1. Top 3 reasons conversations succeeded
2. Top 3 reasons conversations failed
3. Specific suggested changes to the agent's opening message
4. Specific suggested changes to conversation flow
5. Any patterns by geo, referral source, or page type worth acting on
6. A confidence score from 1-10 on how actionable these insights are based on sample size

Format your response in clear numbered sections.`
      }],
    }),
    callGemini({
      max_tokens: 1024,
      messages: [{
        role: "user",
        content: `You are analyzing link click data from a B2B website chat agent for Reflectiz, a cybersecurity company. Summarize what the data tells us about content performance.

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

Provide a concise summary covering:
1. Which content is driving the most engagement and from which visitor segments
2. Which content is being clicked by converters vs drop-offs (what's working vs not)
3. At what point in the conversation are visitors clicking links (early curiosity vs late validation)
4. Specific recommendations for which content the agent should prioritize recommending`
      }],
    }),
  ]);

  const analysisText = conversationResponse.content[0]?.text ?? "";
  const contentPerformance = contentResponse.content[0]?.text ?? "";

  const scoreMatch = analysisText.match(/confidence[^0-9]*([0-9]+)\s*(?:\/\s*10)?/i) ||
                     analysisText.match(/([0-9]+)\s*\/\s*10/);
  const confidenceScore = scoreMatch ? Math.min(10, Math.max(1, parseInt(scoreMatch[1]))) : 5;

  const successMatch = analysisText.match(/(?:1\.|reasons.*succeeded)([\s\S]*?)(?:2\.|reasons.*fail)/i);
  const failureMatch = analysisText.match(/(?:2\.|reasons.*fail)([\s\S]*?)(?:3\.|suggested.*opening)/i);
  const suggestedMatch = analysisText.match(/(?:3\.|suggested.*opening)([\s\S]*?)(?:6\.|confidence)/i);

  const topSuccessPatterns = successMatch?.[1]?.trim() ?? analysisText;
  const topFailurePatterns = failureMatch?.[1]?.trim() ?? "";
  const suggestedChanges = suggestedMatch?.[1]?.trim() ?? "";

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
    fullAnalysis: analysisText,
    contentPerformance,
    patterns: { winners: winnerPatterns, losers: loserPatterns },
    clickData,
  });
});