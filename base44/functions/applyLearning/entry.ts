import { JWT } from "npm:google-auth-library@9.15.1";
import { createClientFromRequest } from "npm:@base44/sdk@0.8.25";

const PROJECT_ID = "dashboarderv0";
const REGION = "us-central1";
const GEMINI_MODEL = "gemini-2.5-flash";

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

const BASELINE_SYSTEM_PROMPT = `LANGUAGE — OVERRIDES EVERYTHING:
Always respond in the language specified in the visitor context. fr → French. de → German. es → Spanish. it → Italian. All others → English. Check this before writing a single word.

---

ROLE:
You are an AI assistant for the Reflectiz website. Reflectiz is a web security company specializing in monitoring third-party scripts, detecting supply chain attacks, and providing browser-side risk visibility.
- Use only the [RELEVANT WEBSITE CONTENT] block to answer accurately. Never invent content.
- Reference and link actual page URLs from the retrieved content when relevant (plain URLs, not markdown).
- Never invent statistics, customer names, or outcomes.
- For pricing or contracts, direct them to the sales team.

---

OPENING MESSAGE (Turn 1):
Max 2 sentences. Lead with an insight relevant to their page — never a greeting. Ask exactly one specific question.

Use these exact openers based on the current page URL:
- Homepage: "Most teams who land here are dealing with compliance, a recent scare, or too many blind spots. Which one fits?"
- URL contains pci / compliance / dss: "Requirements 6.4.3 and 11.6.1 are catching a lot of teams off guard right now. Is that on your radar?"
- URL contains magecart / skimming / supply-chain: "The attack most teams miss isn't in their own code — it's in their vendors' code. Worth a look at yours?"
- URL contains /product/ or /platform/: "Evaluating something specific, or still mapping out what you actually need?"
- URL contains /vs- or /compare or reflectiz-vs: "Already know what you're comparing against, or still figuring out the shortlist?"
- URL contains /use-case/ or /use-cases/: "This use case tends to come up after something specific happens internally. What triggered the search?"
- URL contains /webinar/ or /event/: "Registered already, or still deciding if it's worth your hour?"
- URL contains /customers/ or /case-study/: "Looking for proof it works in your industry specifically, or just getting a feel for the customer base?"
- URL contains /blog/: "Something on this page caught your attention. What was it?"
- Default: "You're not here by accident. What are you trying to solve?"

---

COMPETITOR DIFFERENTIATION:
When a visitor names a competitor, skip all questions and give one differentiator + one proof point immediately.
- c/side: Reflectiz monitors every third-party script behaviorally in real time; c/side blocks scripts statically. Visibility vs. restriction.
- Source Defense: Source Defense enforces perimeter policies. Reflectiz shows what scripts actually do inside the browser session — where attacks execute.

---

CONVERSATION RULES — FOLLOW EXACTLY:

1. NEVER repeat the same fact, statistic, or requirement name in the same conversation. Say it once, move on.

2. COUNT your clarifying questions. After 2 clarifying questions maximum, stop asking and move to the CTA. No exceptions.

3. When the visitor confirms anything with a short reply (PCI, yes, assessment, compliance, exactly, correct), do not re-explain. Do not ask the same question differently. Move forward immediately.

4. The CTA is always: "Want to see what this looks like for your specific setup? [Book a quick call](https://www.reflectiz.com/contact/)"

5. Maximum 3 sentences per response. No exceptions.

CONVERSATION STRUCTURE — 3 steps only:
Step 1 (turn 1): One observation based on their page. One question.
Step 2 (turns 2–3): One new insight they did not know. Maximum 2 clarifying questions total across the whole conversation.
Step 3 (turn 4 at the latest): CTA. Always. No more questions.

---

TONE RULES:
- No filler: "Great question", "Absolutely", "Certainly", "Of course", "Happy to help"
- Never recap what the visitor just said
- Never start a sentence with "I"
- Contractions encouraged — "you're", "it's", "that's"
- Plain prose only — no markdown, bullets, or headers in responses
- Off-topic inputs: one sentence redirect — "What actually brought you here today?"`;

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me().catch(() => null);
  const isScheduled = !user;
  const isAdmin = user?.role === "admin";
  if (!isScheduled && !isAdmin) {
    return Response.json({ error: "Forbidden: Admin access required" }, { status: 403 });
  }

  const reports = await base44.asServiceRole.entities.LearningReports.list("-reportDate", 50);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  const report = reports.find(r =>
    r.appliedToAgent === false &&
    (r.confidenceScore || 0) >= 3 &&
    (r.totalConversations || 0) >= 30 &&
    r.reportDate >= sevenDaysAgo
  );

  if (!report) {
    const anyPending = reports.find(r => r.appliedToAgent === false && (r.confidenceScore || 0) >= 3);
    if (anyPending) {
      const tooOld = (anyPending.reportDate || "") < sevenDaysAgo;
      const tooSmall = (anyPending.totalConversations || 0) < 30;
      if (tooOld) return Response.json({ message: "Report too old to apply safely. Waiting for a more recent report.", reportDate: anyPending.reportDate });
      if (tooSmall) return Response.json({ message: `Sample size too small to trust (${anyPending.totalConversations} conversations). Minimum required: 30.`, reportDate: anyPending.reportDate });
    }
    return Response.json({ message: "No actionable report available yet." });
  }

  const configs = await base44.asServiceRole.entities.AgentConfig.list("-version", 1);
  let currentConfig = configs[0] || null;

  if (!currentConfig) {
    currentConfig = await base44.asServiceRole.entities.AgentConfig.create({
      version: 1,
      systemPrompt: BASELINE_SYSTEM_PROMPT,
      updatedAt: new Date().toISOString().split("T")[0],
      updateReason: "Initial version — baseline system prompt",
      previousPrompt: "",
    });
  }

  const currentPrompt = currentConfig.systemPrompt;
  const nextVersion = (currentConfig.version || 1) + 1;

  const optimizationPrompt = `You are optimizing a B2B website chat agent system prompt for Reflectiz, a cybersecurity company. Your goal is to improve conversion rates by applying learnings from real conversation data.

Here is the current system prompt:
${currentPrompt}

Here are the suggested improvements from this week's analysis:
${report.suggestedChanges || "(none provided)"}

Here are the success patterns:
${report.topSuccessPatterns || "(none provided)"}

Here are the failure patterns:
${report.topFailurePatterns || "(none provided)"}

Generate an improved system prompt that:
1. Incorporates the suggested changes
2. Keeps all existing Reflectiz product knowledge intact
3. Keeps the core brand voice and tone rules
4. Makes specific tactical improvements to opening messages and conversation flow based on the data
5. Does not remove any existing rules unless the data specifically shows they are causing failures

Return only the full improved system prompt text, nothing else.`;

  const response = await callGemini({
    max_tokens: 8192,
    messages: [{ role: "user", content: optimizationPrompt }],
  });

  const improvedPrompt = response.content[0]?.text?.trim() ?? currentPrompt;

  const MIN_PROMPT_LENGTH = 500;
  const hasRequiredSections = improvedPrompt.includes("LANGUAGE") && improvedPrompt.includes("ROLE");

  if (improvedPrompt.length < MIN_PROMPT_LENGTH || !hasRequiredSections) {
    return Response.json({
      error: "Generated prompt failed validation — too short or missing required sections. Not applied.",
      promptLength: improvedPrompt.length
    });
  }

  const today = new Date().toISOString().split("T")[0];

  // Generate plain English change summary for human review
  const summaryPrompt = `Compare these two AI agent system prompts and write a 2-3 sentence plain English summary of what changed and why, for a non-technical marketing manager to review.

LEARNING REPORT CONTEXT:
Confidence: ${report.confidenceScore}/10
Sample size: ${report.totalConversations} conversations
Conversion rate: ${report.conversionRate || "unknown"}

OLD PROMPT (first 1500 chars):
${currentPrompt.slice(0, 1500)}

NEW PROMPT (first 1500 chars):
${improvedPrompt.slice(0, 1500)}

Write only the summary, 2-3 sentences, focused on WHAT changed and WHY based on the data. No preamble.`;

  const summaryResult = await callGemini({ messages: [{ role: "user", content: summaryPrompt }], max_tokens: 300 });
  const changeSummary = (summaryResult?.content?.[0]?.text ?? "").trim() || "Gemini updated the system prompt based on recent conversation data. Review the full diff before approving.";

  // Create a pending change record instead of applying directly
  const pendingChange = await base44.asServiceRole.entities.PendingConfigChanges.create({
    proposedPrompt: improvedPrompt,
    previousPrompt: currentPrompt,
    changeSummary,
    reportId: report.id,
    confidenceScore: report.confidenceScore,
    sampleSize: report.totalConversations,
    status: "pending",
    createdAt: today,
  });

  // Mark the report as applied so it doesn't get reprocessed
  await base44.asServiceRole.entities.LearningReports.update(report.id, { appliedToAgent: true });

  // Notify Slack
  const slackText = `:robot_face: *Agent Prompt Update Proposed*

*What changed:*
${changeSummary}

*Based on:* ${report.totalConversations} conversations, confidence ${report.confidenceScore}/10

<https://reflect-web-wise.base44.app/AgentDashboard|Review and approve in Dashboard>`;

  await fetch(Deno.env.get("SLACK_WEBHOOK_URL"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: slackText }),
  }).catch(err => console.error("Slack notification failed:", err.message));

  return Response.json({ status: "pending_review", pendingChangeId: pendingChange.id, changeSummary });
});