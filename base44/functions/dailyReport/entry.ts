import { createClientFromRequest } from "npm:@base44/sdk@0.8.25";

const SLACK_WEBHOOK_URL = Deno.env.get("SLACK_WEBHOOK_URL");
const DASHBOARD_URL = "https://reflect-web-wise.base44.app/AgentDashboard";

const INTENT_LABELS = {
  PCI_COMPLIANCE: "PCI Compliance",
  MAGECART_PREVENTION: "Magecart Prevention",
  PRIVACY_GDPR: "Privacy / GDPR",
  SUPPLY_CHAIN: "Supply Chain",
  TOOL_EVALUATION: "Tool Evaluation",
  GENERAL_AWARENESS: "General Awareness",
};

function safeNum(n) {
  return (typeof n === "number" && Number.isFinite(n)) ? n : 0;
}

function pct(part, whole) {
  if (!whole) return 0;
  return Math.round((safeNum(part) / whole) * 100);
}

// Strip query string and fragment, then return the path only, no domain, e.g.
// "https://www.reflectiz.com/blog/foo/?utm_source=x" -> "/blog/foo/"
function pagePath(url) {
  if (!url) return "/";
  const stripped = String(url).split("?")[0].split("#")[0];
  try {
    const u = new URL(stripped);
    return u.pathname || "/";
  } catch (_e) {
    // Not a full URL (already a bare path, or malformed). Strip a leading
    // protocol/domain heuristically, otherwise return as-is.
    return stripped.replace(/^https?:\/\/[^/]+/, "") || "/";
  }
}

async function postToSlack(text) {
  if (!SLACK_WEBHOOK_URL) {
    console.error("SLACK_WEBHOOK_URL env var is not set, cannot post daily report");
    return;
  }
  await fetch(SLACK_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" } });
  }

  let options = {};
  try { options = await req.json(); } catch (_e) { options = {}; }

  const base44 = createClientFromRequest(req);

  try {
    // Report window: the full previous UTC calendar day, midnight to midnight.
    // A run at 05:00 UTC on day D covers day D-1 in full. This is unconditional,
    // so the very first run also covers a complete 24 hours regardless of launch date.
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const reportDate = yesterday.toISOString().split("T")[0];
    const windowStart = `${reportDate}T00:00:00.000Z`;
    const windowEnd = `${reportDate}T23:59:59.999Z`;

    // Idempotency: only one report per reportDate, even if the caller (scheduledCrawl)
    // fires its 05:00 UTC check more than once inside the same run window.
    // options.force bypasses this for manual reruns/testing.
    if (!options.force) {
      const existingReports = await base44.asServiceRole.entities.DailyReport.filter({ reportDate });
      if (existingReports && existingReports.length > 0) {
        return Response.json({ success: true, skipped: true, reason: `already generated for ${reportDate}` });
      }
    }

    // Fetch a generous window of recent records and filter in-memory to the exact
    // 24h window. Mirrors this codebase's established pattern elsewhere (list broadly,
    // filter in JS) rather than relying on server-side date-range queries.
    const [allImpressions, allConversations, allClicks] = await Promise.all([
      base44.asServiceRole.entities.OpenerImpressions.list("-shownAt", 5000),
      base44.asServiceRole.entities.Conversations.list("-timestamp", 3000),
      base44.asServiceRole.entities.LinkClicks.list("-clickedAt", 5000),
    ]);

    const inWindow = (dateStr) => !!dateStr && dateStr >= windowStart && dateStr <= windowEnd;

    const impressions = (allImpressions || []).filter(i => inWindow(i.shownAt));
    const conversations = (allConversations || []).filter(c => inWindow(c.timestamp));
    const clicks = (allClicks || []).filter(c => inWindow(c.clickedAt));

    // --- Metric 1: Bubble impressions ---
    const totalImpressions = impressions.length;
    const aiGenerated = impressions.filter(i => i.wasFallback !== true).length;
    const fallbackCount = impressions.filter(i => i.wasFallback === true).length;
    const fallbackRate = pct(fallbackCount, totalImpressions);

    // --- Metric 2: Bubble engagement ---
    const totalDismissed = impressions.filter(i => i.dismissed === true).length;
    const totalExpired = impressions.filter(i => i.expired === true && i.dismissed !== true).length;
    const totalAbandoned = impressions.filter(i => i.abandoned === true).length;

    const sessionsWithConvo = new Set(
      conversations.filter(c => safeNum(c.conversationTurns) >= 1).map(c => c.sessionId).filter(Boolean)
    );
    const openedCount = impressions.filter(i => i.sessionId && sessionsWithConvo.has(i.sessionId)).length;
    const openRate = pct(openedCount, totalImpressions);

    // --- Metric 3: Opener clicks ---
    const openerClicks = clicks.filter(c => safeNum(c.turnNumber) === 1);
    const openerClickCount = openerClicks.length;
    const uniqueOpenerClickSessions = new Set(openerClicks.map(c => c.sessionId).filter(Boolean)).size;

    // --- Metric 4: Conversations ---
    const startedConversations = conversations.filter(c => safeNum(c.conversationTurns) >= 1);
    const startedCount = startedConversations.length;
    const ctaReachedCount = conversations.filter(c => c.ctaReached === true).length;
    const convertedCount = conversations.filter(c => c.conversationOutcome === "CONVERTED").length;
    const engagedCount = conversations.filter(c => c.conversationOutcome === "ENGAGED").length;
    const droppedCount = conversations.filter(c => c.conversationOutcome === "DROPPED").length;
    const bouncedCount = conversations.filter(c => c.conversationOutcome === "BOUNCED").length;
    const ctaRate = pct(ctaReachedCount, startedCount);

    // --- Metric 5: Top 10 pages by bubble impressions ---
    const pageGroups = {};
    impressions.forEach(i => {
      const path = pagePath(i.pageUrl);
      if (!pageGroups[path]) pageGroups[path] = { impressions: 0, opened: 0 };
      pageGroups[path].impressions += 1;
      if (i.sessionId && sessionsWithConvo.has(i.sessionId)) pageGroups[path].opened += 1;
    });
    const topPagesByImpressions = Object.entries(pageGroups)
      .sort((a, b) => b[1].impressions - a[1].impressions)
      .slice(0, 10)
      .map(([path, g]) => ({ path, impressions: g.impressions, openRate: pct(g.opened, g.impressions) }));

    // --- Metric 6: Top 5 destinations Athena is leading visitors to ---
    // /registration/ and /free-trial/ are excluded here, reported separately as CTA clicks
    // (metric 7) so the same click is never double counted across both sections.
    const destGroups = {};
    clicks.forEach(c => {
      const u = (c.clickedUrl || "").toLowerCase();
      if (u.includes("/registration") || u.includes("/free-trial")) return;
      const path = pagePath(c.clickedUrl);
      destGroups[path] = (destGroups[path] || 0) + 1;
    });
    const topDestinations = Object.entries(destGroups)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([path, count]) => ({ path, count }));

    // --- Metric 7: Registration / CTA clicks ---
    const ctaClickCount = clicks.filter(c => {
      const u = (c.clickedUrl || "").toLowerCase();
      return u.includes("/registration") || u.includes("/free-trial");
    }).length;

    // --- Metric 8: Most interesting conversation ---
    function convScore(c) {
      return (safeNum(c.conversationTurns) * 2) + (c.ctaReached ? 5 : 0) + (safeNum(c.linksClicked) * 1);
    }
    let topConversation = null;
    let topScore = -1;
    conversations.forEach(c => {
      const score = convScore(c);
      if (score > topScore) {
        topScore = score;
        topConversation = c;
      }
    });

    // --- Metric 9: Geo breakdown ---
    const geoGroups = {};
    conversations.forEach(c => {
      const g = c.geo || "Unknown";
      geoGroups[g] = (geoGroups[g] || 0) + 1;
    });
    const topGeo = Object.entries(geoGroups).sort((a, b) => b[1] - a[1]).slice(0, 5);

    // --- Metric 10: Intent breakdown ---
    const KNOWN_INTENTS = ["PCI_COMPLIANCE", "TOOL_EVALUATION", "PRIVACY_GDPR", "GENERAL_AWARENESS"];
    const intentCounts = { PCI_COMPLIANCE: 0, TOOL_EVALUATION: 0, PRIVACY_GDPR: 0, GENERAL_AWARENESS: 0, other: 0 };
    conversations.forEach(c => {
      const intent = c.intentClassification;
      if (KNOWN_INTENTS.includes(intent)) intentCounts[intent] += 1;
      else intentCounts.other += 1;
    });

    // --- Build the Slack message ---
    const lines = [];
    lines.push(`:bar_chart: *Athena Daily Report -- ${reportDate}*`);
    lines.push(`_Last 24 hours_`);
    lines.push(``);
    lines.push(`*:eye: Bubble Impressions*`);
    lines.push(`${totalImpressions} total · ${aiGenerated} AI-generated · ${fallbackCount} fallback (${fallbackRate}%)`);
    lines.push(``);
    lines.push(`*:speech_balloon: Engagement*`);
    lines.push(`${openedCount} chats opened (${openRate}% open rate)`);
    lines.push(`${openerClickCount} opener link clicks`);
    lines.push(`${totalDismissed} dismissed · ${totalExpired} expired · ${totalAbandoned} abandoned`);
    lines.push(``);
    lines.push(`*:dart: Conversations*`);
    lines.push(`${startedCount} started · ${ctaReachedCount} CTA reached (${ctaRate}%) · ${convertedCount} converted`);
    lines.push(`Intent mix: ${intentCounts.PCI_COMPLIANCE} PCI · ${intentCounts.TOOL_EVALUATION} Tool Eval · ${intentCounts.PRIVACY_GDPR} Privacy · ${intentCounts.GENERAL_AWARENESS} General`);
    lines.push(``);
    lines.push(`*:link: Top 5 destinations Athena recommended*`);
    if (topDestinations.length > 0) {
      topDestinations.forEach((d, i) => lines.push(`${i + 1}. ${d.path} -- ${d.count} clicks`));
    } else {
      lines.push(`(none)`);
    }
    lines.push(``);
    lines.push(`*:world_map: Top 5 pages visitors engaged on*`);
    const topFivePages = topPagesByImpressions.slice(0, 5);
    if (topFivePages.length > 0) {
      topFivePages.forEach((p, i) => lines.push(`${i + 1}. ${p.path} -- ${p.impressions} impressions · ${p.openRate}% open rate`));
    } else {
      lines.push(`(none)`);
    }
    lines.push(``);
    lines.push(`*:trophy: Most interesting conversation*`);
    if (topConversation) {
      const intentLabel = INTENT_LABELS[topConversation.intentClassification] || topConversation.intentClassification || "Unknown";
      lines.push(`${safeNum(topConversation.conversationTurns)} turns · ${intentLabel} · ${topConversation.conversationOutcome || "Unknown"}`);
      lines.push(`<${DASHBOARD_URL}?sessionId=${encodeURIComponent(topConversation.sessionId || "")}|View session>`);
    } else {
      lines.push(`(no conversations today)`);
    }
    lines.push(``);
    lines.push(`*:earth_africa: Geo*`);
    lines.push(topGeo.length > 0 ? topGeo.map(([g, c]) => `${g}: ${c}`).join(" · ") : "(none)");
    lines.push(``);
    lines.push(`*:pushpin: Registration clicks*`);
    lines.push(`${ctaClickCount} direct clicks to /registration/ or /free-trial/`);

    if (totalImpressions < 10) {
      lines.push(``);
      lines.push(`_Low traffic day -- data is directional only._`);
    }

    const text = lines.join("\n");
    await postToSlack(text);

    await base44.asServiceRole.entities.DailyReport.create({
      reportDate,
      impressions: totalImpressions,
      conversations: startedCount,
      openRate,
      ctaRate,
      generatedAt: new Date().toISOString(),
    });

    return Response.json({
      success: true,
      reportDate,
      impressions: totalImpressions,
      aiGenerated,
      fallbackCount,
      fallbackRate,
      openedCount,
      openRate,
      openerClickCount,
      uniqueOpenerClickSessions,
      totalDismissed,
      totalExpired,
      totalAbandoned,
      conversations: startedCount,
      ctaReachedCount,
      ctaRate,
      convertedCount,
      engagedCount,
      droppedCount,
      bouncedCount,
      ctaClickCount,
      topDestinations,
      topPagesByImpressions,
      topGeo,
      intentCounts,
    });
  } catch (e) {
    console.error("dailyReport failed:", e && e.message ? e.message : String(e));
    await postToSlack(":warning: Athena daily report failed to generate. Check logs.").catch((err) => {
      console.error("dailyReport fallback Slack post also failed:", err.message);
    });
    return Response.json({ success: false, error: e && e.message ? e.message : String(e) }, { status: 500 });
  }
});
