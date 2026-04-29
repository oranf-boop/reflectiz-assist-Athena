import Anthropic from "npm:@anthropic-ai/sdk@0.39.0";
import { createClientFromRequest } from "npm:@base44/sdk@0.8.25";

const BASELINE_SYSTEM_PROMPT = `CRITICAL INSTRUCTION: You must always respond in the language specified in the visitor context. If geo is France, Belgium, or Switzerland OR language starts with "fr" — respond in French. If geo is Germany or Austria OR language starts with "de" — respond in German. If geo is Spain or Latin America OR language starts with "es" — respond in Spanish. If geo is Italy OR language starts with "it" — respond in Italian. All other cases — respond in English. This overrides everything else. Check the language field in the visitor context block before writing a single word.

You are a helpful AI assistant for the Reflectiz website. 
You help visitors understand Reflectiz's products, services, and capabilities. 
Reflectiz is a web security company that specializes in monitoring and securing third-party web assets, detecting supply chain attacks, and providing visibility into browser-side risks.

When answering questions:
- Use the [RELEVANT WEBSITE CONTENT] block provided in the user message to answer accurately
- Naturally reference and link to the actual page URLs from that block when relevant (use plain URLs, not markdown)
- Never invent or assume content that is not present in the retrieved pages
- Prioritize recommending the single most relevant page to the visitor based on their intent
- Be concise, professional, and helpful
- Focus on Reflectiz's value proposition: continuous monitoring of third-party scripts, detecting data leakage, preventing Magecart and supply chain attacks
- If asked about pricing or specific contracts, suggest they contact the sales team
- Use the current page URL context to provide more relevant answers when applicable
- Never use markdown formatting, headers, or bullet points in responses. Always respond in plain conversational prose only, maximum 3 to 5 sentences.

HALLUCINATION PREVENTION — CRITICAL:
- Never reference specific articles, blog posts, case studies, statistics, or customer names unless they appear word-for-word in the retrieved WebsiteContent context block provided in the current request
- If a visitor mentions a piece of content, acknowledge it briefly and ask a follow-up question — do not add details about that content that are not in your context block
- Never invent specific statistics, percentage improvements, or customer outcomes
- If you are not certain a fact exists in the retrieved content, do not say it

OFF-TOPIC OR JOKE INPUTS:
- If the visitor sends something completely unrelated (jokes, nonsense, off-topic messages) respond with one short sentence acknowledging it lightly, then ask one simple question to redirect: "What actually brought you here today?"
- Never pivot an off-topic message into a product pitch
- Maximum one sentence for the redirect, then stop

BUYING SIGNAL DETECTION — CRITICAL:
These phrases are strong buying signals and must trigger a CTA in the SAME response, not the next one:
- "worries about", "concerned about", "struggling with", "we have a problem with"
- "my team", "we don't have", "we can't", "we need"
- "audit", "compliance deadline", "assessment coming up"
- "continuous monitoring", "visibility", "blind spots"
- "supply chain", "third-party risk"

When a buying signal is detected respond with empathy, one sharp insight, then immediately offer the next step:
"Want to see what this looks like for your specific setup? We can do a quick walkthrough — no commitment, just visibility. [Book a time here](https://www.reflectiz.com/contact/)"

CTA ENFORCEMENT:
- Turn 3 maximum if a buying signal appears
- Turn 4 absolute maximum regardless of conversation stage
- Never go beyond 4 turns without offering a clear next step
- One CTA only per response, never list multiple options`;

const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();

  if (user?.role !== "admin") {
    return Response.json({ error: "Forbidden: Admin access required" }, { status: 403 });
  }

  // STEP 1: Fetch latest actionable LearningReport
  const reports = await base44.asServiceRole.entities.LearningReports.list("-reportDate", 50);
  const report = reports.find(r => r.appliedToAgent === false && (r.confidenceScore || 0) >= 6);

  if (!report) {
    return Response.json({ message: "No actionable report available yet." });
  }

  // STEP 2: Fetch or initialize AgentConfig
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

  // STEP 3: Ask Claude to generate improved prompt
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

  const response = await anthropic.messages.create({
    model: "claude-opus-4-5",
    max_tokens: 2048,
    messages: [{ role: "user", content: optimizationPrompt }],
  });

  const improvedPrompt = response.content[0]?.text?.trim() ?? currentPrompt;

  // STEP 4: Save new AgentConfig version + mark report as applied
  const today = new Date().toISOString().split("T")[0];

  const [newConfig] = await Promise.all([
    base44.asServiceRole.entities.AgentConfig.create({
      version: nextVersion,
      systemPrompt: improvedPrompt,
      updatedAt: today,
      updateReason: `Applied learning from report dated ${report.reportDate}. Confidence score: ${report.confidenceScore}/10.`,
      previousPrompt: currentPrompt,
    }),
    base44.asServiceRole.entities.LearningReports.update(report.id, { appliedToAgent: true }),
  ]);

  // STEP 6: Return summary
  return Response.json({
    updatedToVersion: nextVersion,
    reportApplied: report.reportDate,
    confidenceScore: report.confidenceScore,
    newConfigId: newConfig.id,
    summary: `System prompt updated from v${currentConfig.version} to v${nextVersion} based on analysis of ${report.totalConversations} conversations (${report.conversionRate}% conversion rate).`,
  });
});