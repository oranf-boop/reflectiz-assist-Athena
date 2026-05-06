export default function KPICards({ conversations, linkClicks, agentVersion }) {
  const total = conversations.length;
  const converted = conversations.filter(c => c.conversationOutcome === "CONVERTED").length;
  const conversionRate = total > 0 ? ((converted / total) * 100).toFixed(1) : "0.0";

  const ctaReached = conversations.filter(c => c.ctaReached).length;
  const ctaRate = total > 0 ? ((ctaReached / total) * 100).toFixed(1) : "0.0";

  const ctaConvs = conversations.filter(c => c.ctaReached && c.conversationTurns);
  const avgTurns = ctaConvs.length > 0
    ? (ctaConvs.reduce((a, c) => a + (c.conversationTurns || 0), 0) / ctaConvs.length).toFixed(1)
    : "0.0";

  const cards = [
    { label: "Total Conversations", value: total.toLocaleString() },
    { label: "Conversion Rate", value: `${conversionRate}%` },
    { label: "CTA Reached Rate", value: `${ctaRate}%` },
    { label: "Avg Turns to CTA", value: avgTurns },
    { label: "Total Link Clicks", value: linkClicks.toLocaleString() },
    { label: "Active Agent Version", value: `v${agentVersion}` },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
      {cards.map((card) => (
        <div key={card.label} className="bg-white rounded-xl border border-slate-100 shadow-sm p-5 flex flex-col items-center text-center">
          <span className="text-3xl font-bold" style={{ color: "#103a77" }}>{card.value}</span>
          <span className="text-xs text-slate-500 mt-2 leading-tight">{card.label}</span>
        </div>
      ))}
    </div>
  );
}