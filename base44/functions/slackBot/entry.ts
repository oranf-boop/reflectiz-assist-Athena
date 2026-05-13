import Anthropic from "npm:@anthropic-ai/sdk@0.39.0";
import { createClientFromRequest } from "npm:@base44/sdk@0.8.25";

const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });
const SLACK_BOT_TOKEN = Deno.env.get("SLACK_BOT_TOKEN");

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

  // STEP 3: Ask Claude to generate a query plan
  let queryPlan;
  try {
    const planResponse = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
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

  // STEP 4: Fetch records from Base44
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

  // STEP 5: Ask Claude to generate the answer
  const answerPrompt = `You are a helpful data analyst for Reflectiz. Here is the data that was retrieved to answer this question: ${question}

Data: ${JSON.stringify(records).slice(0, 8000)}

Provide a clear, concise answer in Slack-friendly formatting. Use bullet points for lists. Keep it under 300 words. Include specific numbers. End with one actionable insight if relevant.`;

  let answer;
  try {
    const answerResponse = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 600,
      messages: [{ role: "user", content: answerPrompt }],
    });
    answer = answerResponse.content[0]?.text?.trim() ?? "No answer generated.";
  } catch (err) {
    await postToSlack(channel, `Analysis error: ${err.message}`);
    return;
  }

  // STEP 6: Post answer back to Slack
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

  // STEP 1: Handle Slack URL verification challenge — must be first
  if (body.type === "url_verification") {
    return new Response(body.challenge, {
      status: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "text/plain" },
    });
  }

  // STEP 7: Return 200 immediately, process asynchronously
  const event = body.event;
  if (event?.type === "app_mention") {
    const base44 = createClientFromRequest(req);
    // Fire and forget
    processEvent(base44, event).catch(console.error);
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
});