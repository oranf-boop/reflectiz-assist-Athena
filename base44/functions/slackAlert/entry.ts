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
  const SKIP = ["RELEVANT WEBSITE CONTENT", "Visitor geo", "Current page", "Visitor language"];
  const lines = transcript.split("\n").filter(l => {
    const t = l.trim();
    return t.length > 0 && !SKIP.some(s => t.includes(s));
  });
  return lines.join("\n").slice(0, 400);
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

function cleanPath(url) {
  if (!url) return "";
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" } });
  }

  const body = await req.json();
  const {
    sessionId,
    geo,
    intentClassification,
    conversationTurns,
    ctaReached,
    linksClicked,
    referralSource,
    conversationTranscript,
    clickedUrl,
  } = body;

  const intentLabel = INTENT_LABELS[intentClassification] || intentClassification || "Unknown";
  const geoLabel = geo || "Unknown";
  const preview = cleanTranscriptPreview(conversationTranscript);
  const pathLabel = cleanPath(clickedUrl) || "—";
  const domainLabel = cleanDomain(referralSource);

  const text = `:rotating_light: *High-Intent Lead Alert*

*Intent:* ${intentLabel}
*Geo:* ${geoLabel}
*Turns:* ${conversationTurns ?? 0}
*Clicked:* ${pathLabel}
*Referral:* ${domainLabel}

*Conversation Preview:*
${preview}

<https://reflect-web-wise.base44.app/agent-dashboard|View Dashboard>`;

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