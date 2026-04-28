import Anthropic from "npm:@anthropic-ai/sdk@0.39.0";
import { createClientFromRequest } from "npm:@base44/sdk@0.8.25";

const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });

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

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();

  if (user?.role !== "admin") {
    return Response.json({ error: "Forbidden: Admin access required" }, { status: 403 });
  }

  // STEP 1: Fetch conversations from last 7 days
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const allConversations = await base44.asServiceRole.entities.Conversations.list("-timestamp", 500);
  const recent = allConversations.filter(c => c.timestamp && c.timestamp >= sevenDaysAgo);

  const winners = recent.filter(c =>
    c.conversationOutcome === "CONVERTED" ||
    (c.conversationOutcome === "ENGAGED" && (c.conversationTurns || 0) >= 3)
  );
  const losers = recent.filter(c =>
    c.conversationOutcome === "DROPPED" || c.conversationOutcome === "BOUNCED"
  );

  // STEP 2: Extract patterns
  const winnerPatterns = extractPatterns(winners);
  const loserPatterns = extractPatterns(losers);

  // STEP 3: Claude analysis
  const prompt = `You are analyzing website chat conversations for Reflectiz, a B2B cybersecurity company. Your job is to identify what made successful conversations work and what caused failures, then suggest specific improvements to the agent's opening messages, tone, and conversation flow.

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

Format your response in clear numbered sections.`;

  const response = await anthropic.messages.create({
    model: "claude-opus-4-5",
    max_tokens: 2048,
    messages: [{ role: "user", content: prompt }],
  });

  const analysisText = response.content[0]?.text ?? "";

  // Extract confidence score from text (look for "X/10" or "score: X")
  const scoreMatch = analysisText.match(/confidence[^0-9]*([0-9]+)\s*(?:\/\s*10)?/i) ||
                     analysisText.match(/([0-9]+)\s*\/\s*10/);
  const confidenceScore = scoreMatch ? Math.min(10, Math.max(1, parseInt(scoreMatch[1]))) : 5;

  // Split analysis into sections (success / failure / suggested changes)
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

  // STEP 4: Save report
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
  });

  // STEP 5: Return full report
  return Response.json({
    report,
    fullAnalysis: analysisText,
    patterns: { winners: winnerPatterns, losers: loserPatterns },
  });
});