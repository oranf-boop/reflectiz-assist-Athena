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
- Never use markdown formatting, headers, or bullet points in responses. Always respond in plain conversational prose only, maximum 3 to 5 sentences.`;

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