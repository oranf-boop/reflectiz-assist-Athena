import { JWT } from "npm:google-auth-library@9.15.1";

const SLACK_WEBHOOK_URL = Deno.env.get("SLACK_WEBHOOK_URL");
if (!SLACK_WEBHOOK_URL) {
  console.error("SLACK_WEBHOOK_URL env var is not set");
}

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
  const normalized = Array.isArray(pagesViewed) ? pagesViewed.join(",") : pagesViewed;
  const pages = normalized.split(",").map(p => cleanPagePath(p.trim())).filter(Boolean);
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
    linksClicked,
    ctaReached,
    language,
    clickedUrl,
    isConversion,
    isHighIntentClick,
    isWidgetOpen,
  } = body;

  const intentLabel = INTENT_LABELS[intentClassification] || intentClassification || "Unknown";
  const geoLabel = geo || "Unknown";
  const preview = cleanTranscriptPreview(conversationTranscript);
  const domainLabel = cleanDomain(referralSource);
  const pageJourney = formatPageJourney(pagesViewed);

  const OUTCOME_EMOJI = {
    CONVERTED: ":trophy:",
    ENGAGED: ":handshake:",
    DROPPED: ":arrow_right:",
    BOUNCED: ":no_entry_sign:",
    New: ":new:",
  };
  const outcomeRaw = (conversationOutcome === "BOUNCED" && conversationTurns <= 1) ? "New" : (conversationOutcome || "Unknown");
  const outcomeLabel = outcomeRaw.charAt(0) + outcomeRaw.slice(1).toLowerCase();
  const outcomeEmoji = OUTCOME_EMOJI[outcomeRaw] || ":speech_balloon:";

  const langLabel = (language && language !== "en") ? ` · :globe_with_meridians: ${language.toUpperCase()}` : "";
  const clicksLabel = (linksClicked > 0) ? ` · :link: ${linksClicked} link${linksClicked > 1 ? "s" : ""} clicked` : "";
  const ctaLabel = ctaReached ? " · :dart: CTA reached" : "";

  // Determine notification type
  const HIGH_INTENT_PATHS = ["/registration", "/free-trial", "/plans", "/pricing", "/contact"];
  const isHotClick = isHighIntentClick || (clickedUrl && HIGH_INTENT_PATHS.some(p => (clickedUrl || "").toLowerCase().includes(p)));
  const isConv = isConversion || conversationOutcome === "CONVERTED";

  let header, summary = "";

  if (isHotClick) {
    header = `:fire: *High-Intent Click*`;
  } else if (isConv) {
    header = `:trophy: *Conversion — CTA Reached*`;
  } else if (isWidgetOpen) {
    header = `:eyes: *Widget Opened*`;
  } else {
    header = `:speech_balloon: *New Conversation*`;
  }

  if (conversationTranscript && !isHotClick) {
    const summaryPrompt = `Write one complete sentence summarizing this sales conversation for a sales team. Be specific — mention the exact topic or question the visitor asked about, not just general categories. Minimum 15 words. Example: 'A visitor from Israel asked about protecting e-commerce checkout pages from Magecart attacks and clicked the industries page link.'

Conversation:
${cleanTranscriptPreview(conversationTranscript)}

Page journey: ${pagesViewed}
Intent: ${intentClassification}
Outcome: ${conversationOutcome}
Links clicked: ${linksClicked ?? 0}
CTA reached: ${ctaReached ? "yes" : "no"}

Return only the one sentence summary.`;
    summary = await callGemini({ messages: [{ role: "user", content: summaryPrompt }], max_tokens: 300 }).catch(() => "");
  }

  const metaLine = `${outcomeEmoji} *${outcomeLabel}*  ·  :round_pushpin: ${geoLabel}  ·  :mag: ${intentLabel}  ·  :arrows_counterclockwise: ${conversationTurns ?? 0} turn${(conversationTurns ?? 0) !== 1 ? "s" : ""}${clicksLabel}${ctaLabel}${langLabel}`;
  const referralLine = domainLabel !== "direct" ? `*Referral:* ${domainLabel}` : "";

  let clickedUrlLine = "";
  if (isHotClick && clickedUrl) {
    clickedUrlLine = `\n*Clicked:* ${clickedUrl}`;
  }

  const transcriptSection = (preview && !isHotClick)
    ? `\n*Conversation:*\n${preview}`
    : "";

  const text = [
    header,
    "",
    metaLine,
    referralLine,
    clickedUrlLine,
    "",
    `*Page Journey:*\n${pageJourney}`,
    summary ? `\n*Summary:* ${summary}` : "",
    transcriptSection,
    "",
    "<https://reflect-web-wise.base44.app/AgentDashboard|View Dashboard>",
  ].filter(s => s !== undefined && s !== null).join("\n");

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