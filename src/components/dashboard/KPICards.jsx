import { useState } from "react";

function InfoTooltip({ text }) {
  const [visible, setVisible] = useState(false);
  return (
    <span
      className="relative inline-flex items-center ml-1"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      <span className="text-slate-400 cursor-default text-xs leading-none select-none" style={{ fontSize: 11 }}>ℹ</span>
      {visible && (
        <span
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 px-2 py-1.5 rounded text-white pointer-events-none"
          style={{
            backgroundColor: "#103a77",
            fontSize: 12,
            maxWidth: 220,
            width: "max-content",
            lineHeight: "1.4",
            boxShadow: "0 2px 8px rgba(0,0,0,0.18)",
            opacity: 1,
            transition: "opacity 0.15s",
            whiteSpace: "normal",
          }}
        >
          {text}
        </span>
      )}
    </span>
  );
}

export default function KPICards({ conversations, linkClicks, clickedSessionIds, agentVersion }) {
  const total = conversations.length;

  // Conversion Rate = unique sessions with at least one link click
  const clickedCount = conversations.filter(c => clickedSessionIds.has(c.sessionId)).length;
  const conversionRate = total > 0 ? ((clickedCount / total) * 100).toFixed(1) : "0.0";

  const ctaOffered = conversations.filter(c => c.ctaReached).length;
  const ctaRate = total > 0 ? ((ctaOffered / total) * 100).toFixed(1) : "0.0";

  const ctaConvs = conversations.filter(c => c.ctaReached && c.conversationTurns);
  const avgTurns = ctaConvs.length > 0
    ? (ctaConvs.reduce((a, c) => a + (c.conversationTurns || 0), 0) / ctaConvs.length).toFixed(1)
    : "0.0";

  const cards = [
    { label: "Total Conversations", value: total.toLocaleString(), tooltip: "Total number of unique chat sessions initiated by visitors, excluding test and admin sessions." },
    { label: "Conversion Rate", value: `${conversionRate}%`, tooltip: "Percentage of conversations where the visitor actually clicked a link presented by the agent. This is the true engagement signal." },
    { label: "CTA Offered Rate", value: `${ctaRate}%`, tooltip: "Percentage of conversations where the agent presented a meeting link or trial link to the visitor." },
    { label: "Avg Turns to CTA", value: avgTurns, tooltip: "Average number of back-and-forth exchanges before the agent introduced a CTA. Lower is better — target is 3 or fewer turns." },
    { label: "Total Link Clicks", value: linkClicks.toLocaleString(), tooltip: "Total number of times visitors clicked a link inside the chat window across all conversations." },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-8">
      {cards.map((card) => (
        <div key={card.label} className="bg-white rounded-xl border border-slate-100 shadow-sm p-5 flex flex-col items-center text-center">
          <span className="text-3xl font-bold" style={{ color: "#103a77" }}>{card.value}</span>
          <span className="text-xs text-slate-500 mt-2 leading-tight flex items-center justify-center gap-0.5">
            {card.label}<InfoTooltip text={card.tooltip} />
          </span>
        </div>
      ))}
    </div>
  );
}