import Anthropic from "npm:@anthropic-ai/sdk@0.39.0";

const SYSTEM_PROMPT = `You are a helpful AI assistant for the Reflectiz website. 
You help visitors understand Reflectiz's products, services, and capabilities. 
Reflectiz is a web security company that specializes in monitoring and securing third-party web assets, detecting supply chain attacks, and providing visibility into browser-side risks.

When answering questions:
- Be concise, professional, and helpful
- Focus on Reflectiz's value proposition: continuous monitoring of third-party scripts, detecting data leakage, preventing Magecart and supply chain attacks
- If asked about pricing or specific contracts, suggest they contact the sales team
- Use the current page URL context to provide more relevant answers when applicable`;

const client = new Anthropic({
  apiKey: Deno.env.get("ANTHROPIC_API_KEY"),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await req.json();
  const { message, currentPageUrl } = body;

  if (!message) {
    return Response.json({ error: "message is required" }, { status: 400 });
  }

  const userContent = currentPageUrl
    ? `[Current page: ${currentPageUrl}]\n\n${message}`
    : message;

  const response = await client.messages.create({
    model: "claude-opus-4-5",
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: userContent,
      },
    ],
  });

  const reply = response.content[0]?.text ?? "";

  return new Response(JSON.stringify({ reply }), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
});