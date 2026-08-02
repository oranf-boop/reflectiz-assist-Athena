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

// One-decimal-place percentage, used only for openRate. Rounding a genuinely small
// rate (a handful of conversions out of hundreds of impression sessions) to a whole
// number always displays as 0, which reads as a broken calculation even when the
// underlying numbers are correct. One decimal keeps a real nonzero rate visible.
function pctPrecise(part, whole) {
  if (!whole) return 0;
  return Math.round((safeNum(part) / whole) * 1000) / 10;
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

// Recomputes just the fields stored on a DailyReport row (impressions, conversations,
// openRate, ctaRate) for an arbitrary past date, reusing the same broad, already-fetched
// entity lists as the primary report rather than issuing new queries per day. Used only
// by the backfill step, which never builds the full Slack message for these dates.
function computeCoreMetricsForDate(dateStr, allImpressions, allConversations, allClicks) {
  const dayStart = `${dateStr}T00:00:00.000Z`;
  const dayEnd = `${dateStr}T23:59:59.999Z`;
  const inDay = (d) => !!d && d >= dayStart && d <= dayEnd;

  const dayImpressions = (allImpressions || []).filter(i => inDay(i.shownAt));
  const dayConversations = (allConversations || []).filter(c => inDay(c.timestamp));

  const totalImpressions = dayImpressions.length;
  const totalEngagedCount = dayConversations.length;
  const startedCount = dayConversations.filter(c => safeNum(c.conversationTurns) >= 1).length;
  const ctaReachedCount = dayConversations.filter(c => c.ctaReached === true).length;
  const ctaRate = pct(ctaReachedCount, startedCount);

  const allConversationSessionIds = new Set((allConversations || []).map(c => c.sessionId).filter(Boolean));
  const impressionSessionIds = new Set(dayImpressions.map(i => i.sessionId).filter(Boolean));
  const openedCount = [...impressionSessionIds].filter(sid => allConversationSessionIds.has(sid)).length;
  const openRate = pctPrecise(openedCount, impressionSessionIds.size);

  return { totalImpressions, totalEngagedCount, openRate, ctaRate };
}

// Base44's list() endpoint hard-caps at 5000 records per call no matter what limit
// is requested (confirmed empirically: requesting limit 20000 against OpenerImpressions
// still only ever returned 5000). Paginates with the skip parameter until either a page
// comes back short (genuinely no more data) or the oldest record already fetched is
// older than oldestNeededIso, so this adapts automatically as daily volume grows
// instead of silently dropping older dates out of the fetch once volume passes 5000
// records within the lookback window. This is what was cutting July 27 and July 28 out
// of the report: 07-28 through 08-01 alone already totalled more than 5000 impressions.
async function fetchAllSince(entityHandle, sortField, dateField, oldestNeededIso) {
  const PAGE_SIZE = 5000;
  let all = [];
  let skip = 0;
  while (true) {
    const page = await entityHandle.list(sortField, PAGE_SIZE, skip);
    if (!page || page.length === 0) break;
    all = all.concat(page);
    const oldestInPage = page[page.length - 1][dateField];
    if (page.length < PAGE_SIZE) break;
    if (oldestInPage && oldestInPage <= oldestNeededIso) break;
    skip += PAGE_SIZE;
  }
  return all;
}

async function postToSlack(text) {
  if (!SLACK_WEBHOOK_URL) {
    throw new Error("SLACK_WEBHOOK_URL env var is not set");
  }
  const res = await fetch(SLACK_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Slack returned ${res.status}: ${errText}`);
  }
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
    // options.testMode covers today's 08:00 Israel time (05:00 UTC) until now instead,
    // for ad-hoc test runs. Test runs never write a DailyReport row and never trigger
    // the idempotency skip, so they cannot block or be blocked by the real daily run.
    const now = new Date();
    const isTestMode = options.testMode === true;
    let reportDate, windowStart, windowEnd, subtitle;
    if (isTestMode) {
      const todayUTC = now.toISOString().split("T")[0];
      reportDate = todayUTC;
      windowStart = `${todayUTC}T05:00:00.000Z`;
      windowEnd = now.toISOString();
      subtitle = "_Today 08:00 Israel time until now, test run_";
    } else {
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      reportDate = yesterday.toISOString().split("T")[0];
      windowStart = `${reportDate}T00:00:00.000Z`;
      windowEnd = `${reportDate}T23:59:59.999Z`;
      subtitle = "_Last 24 hours_";
    }

    // Idempotency: only one report per reportDate, even if the caller (scheduledCrawl)
    // fires its 05:00 UTC check more than once inside the same run window.
    // options.force bypasses this for manual reruns/testing. Test-mode runs skip it
    // entirely since they never write a DailyReport row.
    if (!options.force && !isTestMode) {
      const existingReports = await base44.asServiceRole.entities.DailyReport.filter({ reportDate });
      if (existingReports && existingReports.length > 0) {
        return Response.json({ success: true, skipped: true, reason: `already generated for ${reportDate}` });
      }
    }

    // Fetch a generous window of recent records and filter in-memory to the exact
    // 24h window. Mirrors this codebase's established pattern elsewhere (list broadly,
    // filter in JS) rather than relying on server-side date-range queries.
    //
    // OpenerImpressions is paginated via fetchAllSince rather than a single list() call:
    // its volume (950 to 1500+ rows per day) already exceeds the platform's hard 5000
    // per-call cap within the 8-day window the backfill loop below needs (reportDate
    // plus 7 more days), which is exactly why July 27 and July 28 were reporting
    // impressions: 0 once later days pushed them past a single page. Conversations and
    // LinkClicks stay on a single list() call: neither has shown this problem, their
    // volume is far below 5000 within the same lookback window.
    const oldestNeededIso = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const [allImpressions, allConversations, allClicks] = await Promise.all([
      fetchAllSince(base44.asServiceRole.entities.OpenerImpressions, "-shownAt", "shownAt", oldestNeededIso),
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
    // openRate join: deliberately not date-filtered and not conversationTurns-filtered.
    // A visitor can see the bubble on one page and open the chat a few minutes later,
    // so the resulting Conversations row can land just outside this day's impression
    // window, and opening the widget alone already creates a Conversations row before
    // any typing happens. Membership is checked against ALL Conversations sessionIds
    // regardless of date or turns, separate from sessionsWithConvo above (which stays
    // day-scoped and turns>=1 for the per-page opened breakdown further down).
    const allConversationSessionIds = new Set((allConversations || []).map(c => c.sessionId).filter(Boolean));
    const impressionSessionIds = new Set(impressions.map(i => i.sessionId).filter(Boolean));
    const openedCount = [...impressionSessionIds].filter(sid => allConversationSessionIds.has(sid)).length;
    const openRate = pctPrecise(openedCount, impressionSessionIds.size);

    // --- Metric 3: Opener clicks ---
    const openerClicks = clicks.filter(c => safeNum(c.turnNumber) === 1);
    const openerClickCount = openerClicks.length;
    const uniqueOpenerClickSessions = new Set(openerClicks.map(c => c.sessionId).filter(Boolean)).size;

    // --- Metric 4: Conversations ---
    // totalEngagedCount is every Conversations record in the report window, regardless
    // of conversationTurns -- this counts anyone who engaged with Athena at all, including
    // sessions where the widget was opened but nothing was typed. startedCount is the
    // narrower, separately reported "typed something" count (conversationTurns >= 1).
    const totalEngagedCount = conversations.length;
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
    lines.push(`:bar_chart: *Athena Daily Report -- ${reportDate}${isTestMode ? " (TEST)" : ""}*`);
    lines.push(subtitle);
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
    lines.push(`${totalEngagedCount} total · ${startedCount} typed something · ${ctaReachedCount} CTA reached (${ctaRate}%) · ${convertedCount} converted`);
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

    let backfilledDates = [];
    if (!isTestMode) {
      // Always query before writing, in both this main path and the backfill loop
      // below. Update the existing row if reportDate already has one, otherwise
      // create it. This is what actually prevents duplicates: relying on the
      // idempotency skip-check further up is not enough, since options.force
      // deliberately bypasses that check and would otherwise reach an unconditional
      // create() here every time it is used.
      const existingForReportDate = await base44.asServiceRole.entities.DailyReport.filter({ reportDate });
      const reportPayload = {
        reportDate,
        impressions: totalImpressions,
        conversations: totalEngagedCount,
        openRate,
        ctaRate,
        generatedAt: new Date().toISOString(),
      };
      if (existingForReportDate && existingForReportDate.length > 0) {
        await base44.asServiceRole.entities.DailyReport.update(existingForReportDate[0].id, reportPayload);
      } else {
        await base44.asServiceRole.entities.DailyReport.create(reportPayload);
      }

      // Backfill: opportunistically fill any missing DailyReport rows from the last 7
      // days so a gap (for example from the cron trigger not firing on a given day)
      // self-heals on the next real run. Backfilled days are stored but never posted
      // to Slack, only the reportDate above is ever posted. Existing rows for a day
      // are updated in place (same query-then-update-or-create rule as above) rather
      // than skipped, so an older row computed before a metric fix gets corrected too.
      try {
        for (let i = 1; i <= 7; i++) {
          const backfillDate = new Date(now.getTime() - i * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
          if (backfillDate === reportDate) continue;
          const existingForDay = await base44.asServiceRole.entities.DailyReport.filter({ reportDate: backfillDate });
          const metrics = computeCoreMetricsForDate(backfillDate, allImpressions, allConversations, allClicks);
          const backfillPayload = {
            reportDate: backfillDate,
            impressions: metrics.totalImpressions,
            conversations: metrics.totalEngagedCount,
            openRate: metrics.openRate,
            ctaRate: metrics.ctaRate,
            generatedAt: new Date().toISOString(),
          };
          if (existingForDay && existingForDay.length > 0) {
            await base44.asServiceRole.entities.DailyReport.update(existingForDay[0].id, backfillPayload);
          } else {
            await base44.asServiceRole.entities.DailyReport.create(backfillPayload);
            backfilledDates.push(backfillDate);
          }
        }
        if (backfilledDates.length > 0) {
          console.log("Backfilled missing DailyReport rows for:", backfilledDates.join(", "));
        }
      } catch (e) {
        console.error("Backfill failed:", e.message);
      }
    }

    return Response.json({
      success: true,
      testMode: isTestMode,
      windowStart,
      windowEnd,
      reportDate,
      impressions: totalImpressions,
      aiGenerated,
      fallbackCount,
      fallbackRate,
      openedCount,
      openRate,
      uniqueImpressionSessions: impressionSessionIds.size,
      openerClickCount,
      uniqueOpenerClickSessions,
      totalDismissed,
      totalExpired,
      totalAbandoned,
      conversations: totalEngagedCount,
      startedCount,
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
      backfilledDates,
    });
  } catch (e) {
    console.error("dailyReport failed:", e && e.message ? e.message : String(e));
    await postToSlack(":warning: Athena daily report failed to generate. Check logs.").catch((err) => {
      console.error("dailyReport fallback Slack post also failed:", err.message);
    });
    return Response.json({ success: false, error: e && e.message ? e.message : String(e) }, { status: 500 });
  }
});
