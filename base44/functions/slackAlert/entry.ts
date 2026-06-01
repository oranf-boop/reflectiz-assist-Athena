import { createClientFromRequest } from "npm:@base44/sdk@0.8.25";

const SLACK_WEBHOOK_URL = Deno.env.get("SLACK_WEBHOOK_URL");

const INTENT_LABELS = {
  PCI_COMPLIANCE: "PCI Compliance",
  MAGECART_PREVENTION: "Magecart Prevention",
  PRIVACY_GDPR: "Privacy / GDPR",
  SUPPLY_CHAIN: "Supply Chain",
  TOOL_EVALUATION: "Tool Evaluation",
  GENERAL_AWARENESS: "General Awareness",
};

function cleanTranscriptPreview(transcript) {
  if (!transcript) return "";
  const SKIP = ["RELEVANT WEBSITE CONTENT", "Visitor geo", "Current page", "Visitor language", "Page:", "URL:", "Type:", "Content:"];
  const lines = transcript.split("\n").filter(l => {
    const t = l.trim();
    if (t.length === 0) return false;
    if (SKIP.some(s => t.includes(s))) return false;
    return t.startsWith("Agent:") || t.startsWith("Visitor:");
  });
  const joined = lines.join("\n");
  if (joined.length <= 800) return joined;
  return joined.slice(0, 800) + "... [read full in dashboard]";
}

function cleanDomain(src) {
  if (!src) return "direct";
  try {
    const url = src.startsWith("http") ? new URL(src) : null;
    if (!url) return src;
    return url.hostname.replace(/^www\./, "");
  } catch {
    return src;
  }
}

function cleanPagePath(url) {
  if (!url) return "";
  try {
    const path = new URL(url).pathname;
    return (path === "/" || path === "") ? "Home" : path;
  } catch {
    return url;
  }
}

function formatPageJourney(pagesViewed) {
  if (!pagesViewed) return "—";
  const pages = pagesViewed.split(",").map(p => cleanPagePath(p.trim())).filter(Boolean);
  if (pages.length === 0) return "—";
  return pages.join(" → ");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" } });
  }

  const body = await req.json();
  const {
    geo,
    intentClassification,
    conversationTurns,
    conversationOutcome,
    referralSource,
    conversationTranscript,
    pagesViewed,
  } = body;

  const intentLabel = INTENT_LABELS[intentClassification] || intentClassification || "Unknown";
  const geoLabel = geo || "Unknown";
  const preview = cleanTranscriptPreview(conversationTranscript);
  const domainLabel = cleanDomain(referralSource);
  const pageJourney = formatPageJourney(pagesViewed);
  const outcomeLabel = conversationOutcome
    ? conversationOutcome.charAt(0) + conversationOutcome.slice(1).toLowerCase()
    : "Unknown";

  const text = `:speech_balloon: *New Conversation*

*Geo:* ${geoLabel}
*Intent:* ${intentLabel}
*Turns:* ${conversationTurns ?? 0}
*Outcome:* ${outcomeLabel}
*Referral:* ${domainLabel}

*Page Journey:*
${pageJourney}

*Conversation:*
${preview}

<https://reflect-web-wise.base44.app/AgentDashboard|View Dashboard>`;

  const slackRes = await fetch(SLACK_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });

  if (!slackRes.ok) {
    const err = await slackRes.text();
    return Response.json({ error: `Slack returned ${slackRes.status}: ${err}` }, { status: 500 });
  }

  return Response.json({ success: true });
});