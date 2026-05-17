import { JWT } from "npm:google-auth-library@9.15.1";
import { createClientFromRequest } from "npm:@base44/sdk@0.8.25";

const PROJECT_ID = "dashboarderv0";
const REGION = "us-central1";
const GEMINI_MODEL = "gemini-2.5-flash";
const SLACK_BOT_TOKEN = Deno.env.get("SLACK_BOT_TOKEN");

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
    generationConfig: { maxOutputTokens: 2048 },
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

const QUERY_PLANNER_PROMPT = `You extract database query parameters from natural language questions about chat analytics data. Always respond with only a valid JSON object, no explanation, no markdown formatting, no code blocks.

JSON format:
{
  "days": number (how many days back to look, default 30),
  "intentFilter": string or null (one of: PCI_COMPLIANCE, MAGECART_PREVENTION, PRIVACY_GDPR, SUPPLY_CHAIN, TOOL_EVALUATION, GENERAL_AWARENESS, or null for all),
  "geoFilter": string or null (country name or null for all),
  "outcomeFilter": string or null (CONVERTED, ENGAGED, DROPPED, BOUNCED, or null for all),
  "groupBy": string (one of: intent, geo, outcome, referral, day),
  "question": string (restate the question simply)
}`;

async function postToSlack(channel, text) {
  await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${SLACK_BOT_TOKEN}`,
    },
    body: JSON.stringify({ channel, text, mrkdwn: true }),
  });
}

async function processEvent(base44, event) {
  const question = (event.text || "").replace(/<@[^>]+>/g, "").trim();
  const channel = event.channel;

  if (!question) {
    await postToSlack(channel, "Hey! Ask me anything about your Reflectiz conversation data.");
    return;
  }

  let queryPlan;
  try {
    const planResponse = await callGemini({
      max_tokens: 512,
      system: QUERY_PLANNER_PROMPT,
      messages: [{ role: "user", content: question }],
    });
    const rawText = (planResponse.candidates?.[0]?.content?.parts?.[0]?.text ?? planResponse.content?.[0]?.text ?? "").trim();
    console.log("Raw Gemini response:", rawText);
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.log("No JSON found in response:", rawText);
      queryPlan = { days: 30, intentFilter: null, geoFilter: null, outcomeFilter: null, groupBy: "intent", question: question };
    } else {
      queryPlan = JSON.parse(jsonMatch[0]);
    }
  } catch (err) {
    console.log("Query plan parse error:", err.message);
    await postToSlack(channel, "Sorry, I couldn't parse your question into a query. Try rephrasing.");
    return;
  }

  // Build date filter from queryPlan.days
  const days = Number(queryPlan.days) || 30;
  console.log("queryPlan.days:", queryPlan.days, "-> using days:", days);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  console.log("Filtering conversations since:", since);

  let records = [];
  try {
    const allConvs = await base44.asServiceRole.entities.Conversations.list("-created_date", 500);
    records = allConvs.filter(c => {
      if (c.timestamp && c.timestamp < since) return false;
      if (queryPlan.intentFilter && c.intentClassification !== queryPlan.intentFilter) return false;
      if (queryPlan.geoFilter && !(c.geo || "").toLowerCase().includes(queryPlan.geoFilter.toLowerCase())) return false;
      if (queryPlan.outcomeFilter && c.conversationOutcome !== queryPlan.outcomeFilter) return false;
      return true;
    });
  } catch (err) {
    await postToSlack(channel, `Database error: ${err.message}`);
    return;
  }

  const answerPrompt = `You are a helpful data analyst for Reflectiz. Answer this question: ${question}

Filtered data (${records.length} conversations matched, last ${days} days): ${JSON.stringify(records).slice(0, 8000)}

Format your response for Slack. Use *bold* with single asterisks only. Use the bullet character (•) for all list items, not dashes. Example: • PCI Compliance: 2 conversations. No markdown headers. Keep it under 300 words. Include specific numbers. End with "Insight: [one sentence]"

You must always include all three sections: By Intent, By Outcome, and Notable Conversations. Never cut the response short. If data is limited, show what is available for each section.

Always display intent classifications in human readable format:
PCI_COMPLIANCE = PCI Compliance
MAGECART_PREVENTION = Magecart Prevention
PRIVACY_GDPR = Privacy and GDPR
SUPPLY_CHAIN = Supply Chain Security
TOOL_EVALUATION = Tool Evaluation
GENERAL_AWARENESS = General Awareness
Never show raw database enum values like PCI_COMPLIANCE in responses.

When the question asks for a log or list of conversations, format the response like this:
"Here is a summary of [X] conversations from [time period]:

*By Intent:*
- PCI Compliance: X conversations
- Magecart Prevention: X conversations

*By Outcome:*
- Engaged: X | Dropped: X | Bounced: X

*Notable conversations:*
- [Geo] visitor, [Intent], [turns] turns, [outcome]
- [Geo] visitor, [Intent], [turns] turns, [outcome]

Insight: [one genuinely useful observation]"

Never dump raw transcript text into Slack. Summarize and structure instead.`;

  let answer;
  try {
    const answerResponse = await callGemini({
      max_tokens: 2048,
      messages: [{ role: "user", content: answerPrompt }],
    });
    answer = (answerResponse.candidates?.[0]?.content?.parts?.[0]?.text ?? answerResponse.content?.[0]?.text ?? "No answer generated.").trim();
  } catch (err) {
    await postToSlack(channel, `Analysis error: ${err.message}`);
    return;
  }

  await postToSlack(channel, answer);
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  const body = await req.json();

  // Handle Slack URL verification challenge — must be first
  if (body.type === "url_verification") {
    return new Response(body.challenge, {
      status: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "text/plain" },
    });
  }

  const event = body.event;
  if (event?.type === "app_mention") {
    const base44 = createClientFromRequest(req);
    processEvent(base44, event).catch(console.error);
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
});