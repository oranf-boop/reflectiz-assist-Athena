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

const QUERY_PLANNER_PROMPT = `You are a data analyst for Reflectiz, a B2B cybersecurity company. You have access to conversation data from the Reflectiz website chat agent. When asked a question, generate a Base44 database query plan to answer it.

The database has these entities:
- Conversations: fields are sessionId, timestamp, geo, referralSource, intentClassification, conversationTurns, ctaReached, linksClicked, conversationOutcome, language, isTrainingData, conversationTranscript
- LinkClicks: fields are sessionId, clickedUrl, turnNumber, clickedAt, pageUrl
- LearningReports: fields are reportDate, totalConversations, winnerCount, loserCount, conversionRate, confidenceScore, topSuccessPatterns, topFailurePatterns, suggestedChanges

Respond with a JSON object containing:
{
  "entity": "Conversations" or "LinkClicks" or "LearningReports",
  "filters": { "field": "value" },
  "analysis": "what calculation or summary to perform on the results",
  "responseFormat": "how to format the answer for Slack"
}

Only respond with the JSON, nothing else.`;

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
    const raw = planResponse.content[0]?.text?.trim() ?? "{}";
    queryPlan = JSON.parse(raw);
  } catch {
    await postToSlack(channel, "Sorry, I couldn't parse your question into a query. Try rephrasing.");
    return;
  }

  let records = [];
  try {
    const entity = base44.asServiceRole.entities[queryPlan.entity];
    if (!entity) throw new Error("Unknown entity: " + queryPlan.entity);

    const filters = queryPlan.filters && Object.keys(queryPlan.filters).length > 0
      ? queryPlan.filters
      : null;

    records = filters
      ? await entity.filter(filters, "-created_date", 200)
      : await entity.list("-created_date", 200);
  } catch (err) {
    await postToSlack(channel, `Database error: ${err.message}`);
    return;
  }

  const answerPrompt = `You are a helpful data analyst for Reflectiz. Here is the data that was retrieved to answer this question: ${question}

Data: ${JSON.stringify(records).slice(0, 8000)}

Provide a clear, concise answer in Slack-friendly formatting. Use bullet points for lists. Keep it under 300 words. Include specific numbers. End with one actionable insight if relevant.`;

  let answer;
  try {
    const answerResponse = await callGemini({
      max_tokens: 600,
      messages: [{ role: "user", content: answerPrompt }],
    });
    answer = answerResponse.content[0]?.text?.trim() ?? "No answer generated.";
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