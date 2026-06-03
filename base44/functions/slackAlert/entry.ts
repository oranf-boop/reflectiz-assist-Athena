import { JWT } from "npm:google-auth-library@9.15.1";

const SLACK_WEBHOOK_URL = Deno.env.get("SLACK_WEBHOOK_URL");

const PROJECT_ID = "dashboarderv0";
const REGION = "us-central1";
const GEMINI_MODEL = "gemini-2.5-flash";

async function callGemini({ messages, max_tokens }) {
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

  const res = await fetch(url, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ contents, generationConfig: { maxOutputTokens: max_tokens || 150 } }),
  });
  if (!res.ok) throw new Error(`Gemini error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.map(p => p.text ?? "").join("") || "";
  return text.trim();
}

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

  let summary = "";
  if (conversationTranscript) {
    const summaryPrompt = `Write a complete one sentence summary (minimum 15 words) of this B2B sales conversation for a sales team. The sentence must be complete and not cut off. Focus on: what the visitor was looking for, what was discussed, and whether they showed buying intent.

Conversation:
${cleanTranscriptPreview(conversationTranscript)}

Page journey: ${pagesViewed}
Intent: ${intentClassification}
Outcome: ${conversationOutcome}

Return only the one sentence summary.`;
    summary = await callGemini({ messages: [{ role: "user", content: summaryPrompt }], max_tokens: 300 });
  }

  const text = `:speech_balloon: *New Conversation*

*Geo:* ${geoLabel}
*Intent:* ${intentLabel}
*Turns:* ${conversationTurns ?? 0}
*Outcome:* ${outcomeLabel}
*Referral:* ${domainLabel}

*Page Journey:*
${pageJourney}
${summary ? `\n*Summary:* ${summary}\n` : ""}
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