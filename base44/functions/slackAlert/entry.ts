import { JWT } from "npm:google-auth-library@9.15.1";
import { createClientFromRequest } from "npm:@base44/sdk@0.8.25";

const SLACK_WEBHOOK_URL = Deno.env.get("SLACK_WEBHOOK_URL");
if (!SLACK_WEBHOOK_URL) {
  console.error("SLACK_WEBHOOK_URL env var is not set");
}

const PROJECT_ID = "dashboarderv0";
const REGION = "us-central1";
const GEMINI_MODEL = "gemini-2.5-flash";
const DASHBOARD_URL = "https://reflect-web-wise.base44.app/AgentDashboard";
const HIGH_INTENT_PATHS = ["/registration", "/free-trial", "/plans", "/pricing", "/contact"];

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

function normalizeUrl(url) {
  if (!url) return "";
  return String(url)
    .toLowerCase()
    .replace(/^https?:\/\/(www\.)?/, "")
    .replace(/\/$/, "")
    .trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" } });
  }

  const body = await req.json();
  const {
    sessionId,
    eventType,
    clickedUrl,
    triggerUrl,
    isConversion,
    isHighIntentClick,
    isWidgetOpen,
  } = body;

  // Session-aware enrichment: query entities when a sessionId is provided.
  // Body fields below act as fallbacks so legacy callers keep working.
  let conv = null;
  let impressions = [];
  let clicks = [];
  if (sessionId) {
    try {
      const base44 = createClientFromRequest(req);
      const [convRows, impRows, clickRows] = await Promise.all([
        base44.asServiceRole.entities.Conversations.filter({ sessionId }).catch(() => []),
        base44.asServiceRole.entities.OpenerImpressions.filter({ sessionId }).catch(() => []),
        base44.asServiceRole.entities.LinkClicks.filter({ sessionId }).catch(() => []),
      ]);
      conv = (convRows && convRows[0]) || null;
      impressions = (impRows || []).slice().sort((a, b) => String(a.shownAt || "").localeCompare(String(b.shownAt || "")));
      clicks = (clickRows || []).slice().sort((a, b) => String(a.clickedAt || "").localeCompare(String(b.clickedAt || "")));
    } catch (e) {
      console.error("Session enrichment failed:", e.message);
    }
  }

  const geo = (conv && conv.geo) || body.geo || "";
  const intentClassification = (conv && conv.intentClassification) || body.intentClassification || "";
  const conversationTurns = (conv && typeof conv.conversationTurns === "number") ? conv.conversationTurns : (body.conversationTurns ?? 0);
  const conversationOutcome = (conv && conv.conversationOutcome) || body.conversationOutcome || "";
  const referralSource = (conv && conv.referralSource) || body.referralSource || "";
  const conversationTranscript = (conv && conv.conversationTranscript) || body.conversationTranscript || "";
  const pagesJoined = (conv && conv.pagesViewed) || (Array.isArray(body.pagesViewed) ? body.pagesViewed.join(",") : (body.pagesViewed || ""));
  const linksClicked = clicks.length > 0 ? clicks.length : ((conv && conv.linksClicked) ?? body.linksClicked ?? 0);
  const ctaReached = (conv && conv.ctaReached) || body.ctaReached || false;
  const language = (conv && conv.language) || body.language || "en";

  const intentLabel = INTENT_LABELS[intentClassification] || intentClassification || "Unknown";
  const geoLabel = geo || "Unknown";
  const preview = cleanTranscriptPreview(conversationTranscript);
  const domainLabel = cleanDomain(referralSource);

  const isHotClick = isHighIntentClick || (clickedUrl && HIGH_INTENT_PATHS.some(p => String(clickedUrl).toLowerCase().includes(p)));
  const isConv = isConversion || eventType === "conversion" || conversationOutcome === "CONVERTED";

  let header;
  if (eventType === "widget_opened") {
    header = ":eyes: *Widget Opened*";
  } else if (eventType === "link_click") {
    header = isHotClick ? ":fire: *High-Intent Click*" : ":link: *Link Click*";
  } else if (eventType === "engaged") {
    header = ":handshake: *Engaged Conversation*";
  } else if (eventType === "conversion") {
    header = ":trophy: *Conversion: CTA Reached*";
  } else if (eventType === "new_conversation") {
    header = ":speech_balloon: *New Conversation*";
  } else if (isHotClick) {
    header = ":fire: *High-Intent Click*";
  } else if (isConv) {
    header = ":trophy: *Conversion: CTA Reached*";
  } else if (isWidgetOpen) {
    header = ":eyes: *Widget Opened*";
  } else {
    header = ":speech_balloon: *New Conversation*";
  }

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

  // Page list and Athena attribution.
  // page[i] is Athena-driven when an unconsumed click made on page[i-1] targets page[i].
  // Clicks are sorted by clickedAt and each click is consumed once, so a later organic
  // visit to the same URL does not inherit the marker.
  const pages = pagesJoined.split(",").map(s => s.trim()).filter(Boolean);
  const clickConsumed = clicks.map(() => false);
  const athenaDriven = pages.map(() => false);
  for (let i = 1; i < pages.length; i++) {
    const idx = clicks.findIndex((c, ci) => !clickConsumed[ci] &&
      normalizeUrl(c.clickedUrl) === normalizeUrl(pages[i]) &&
      normalizeUrl(c.pageUrl) === normalizeUrl(pages[i - 1]));
    if (idx >= 0) {
      clickConsumed[idx] = true;
      athenaDriven[i] = true;
    }
  }

  // Engagement trail: walk the journey in order and attach events to each page.
  const impressionUsed = impressions.map(() => false);
  const trailClickUsed = clicks.map(() => false);
  const chatPage = normalizeUrl(triggerUrl || (conv && conv.lastPage) || "");
  const chatHappened = !!((conv && conv.widgetOpened) || conversationTurns > 0);
  let chatLineAdded = false;
  const trail = [];
  pages.forEach((p, i) => {
    const np = normalizeUrl(p);
    if (athenaDriven[i]) {
      trail.push(`:arrow_right: Navigated to ${cleanPagePath(p)} via Athena recommendation`);
    }
    impressions.forEach((im, ii) => {
      if (!impressionUsed[ii] && normalizeUrl(im.pageUrl) === np) {
        impressionUsed[ii] = true;
        trail.push(`:eye: Saw bubble on ${cleanPagePath(p)}${im.bubbleText ? `: "${im.bubbleText}"` : ""}`);
      }
    });
    clicks.forEach((c, ci) => {
      if (!trailClickUsed[ci] && (c.turnNumber ?? 0) <= 1 && normalizeUrl(c.pageUrl) === np) {
        trailClickUsed[ci] = true;
        trail.push(`:link: Clicked opener link on ${cleanPagePath(p)} to ${cleanPagePath(c.clickedUrl)}`);
      }
    });
    if (chatHappened && !chatLineAdded && np && np === chatPage) {
      chatLineAdded = true;
      trail.push(`:speech_balloon: Opened chat on ${cleanPagePath(p)} (page ${i + 1} of journey)`);
    }
    clicks.forEach((c, ci) => {
      if (!trailClickUsed[ci] && (c.turnNumber ?? 0) > 1 && normalizeUrl(c.pageUrl) === np) {
        trailClickUsed[ci] = true;
        trail.push(`:dart: Clicked ${cleanPagePath(c.clickedUrl)} from chat on ${cleanPagePath(p)} (turn ${c.turnNumber})`);
      }
    });
  });
  // Chat page not present in the journey list: still show the line so the event is not lost.
  if (chatHappened && !chatLineAdded && chatPage) {
    trail.push(`:speech_balloon: Opened chat on /${chatPage.split("/").slice(1).join("/")}`);
  }

  const pageJourney = pages.length > 0
    ? pages.map((p, i) => cleanPagePath(p) + (athenaDriven[i] ? " ←Athena" : "")).join(" → ")
    : "(none)";

  let summary = "";
  if (conversationTranscript) {
    const summaryPrompt = `Write one complete sentence summarizing this sales conversation for a sales team. Be specific, mention the exact topic or question the visitor asked about, not just general categories. Minimum 15 words. Example: 'A visitor from Israel asked about protecting e-commerce checkout pages from Magecart attacks and clicked the industries page link.'

Conversation:
${cleanTranscriptPreview(conversationTranscript)}

Page journey: ${pagesJoined}
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
  if (clickedUrl) {
    clickedUrlLine = `\n*Clicked:* ${clickedUrl}`;
  }

  const trailSection = trail.length > 0 ? `\n*Engagement Trail:*\n${trail.join("\n")}` : "";

  const transcriptSection = preview ? `\n*Conversation:*\n${preview}` : "";

  const footer = sessionId
    ? `<${DASHBOARD_URL}?sessionId=${encodeURIComponent(sessionId)}|View Session>  ·  <${DASHBOARD_URL}|View Dashboard>`
    : `<${DASHBOARD_URL}|View Dashboard>`;

  const text = [
    header,
    "",
    metaLine,
    referralLine,
    clickedUrlLine,
    trailSection,
    "",
    `*Page Journey:*\n${pageJourney}`,
    summary ? `\n*Summary:* ${summary}` : "",
    transcriptSection,
    "",
    footer,
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