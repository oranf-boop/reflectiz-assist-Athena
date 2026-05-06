import { useState } from "react";
import { format, parseISO } from "date-fns";
import { ChevronDown, ChevronRight } from "lucide-react";

const NAVY = "#103a77";

const OUTCOME_COLORS = {
  CONVERTED: "bg-green-100 text-green-700",
  ENGAGED: "bg-blue-100 text-blue-700",
  DROPPED: "bg-orange-100 text-orange-700",
  BOUNCED: "bg-slate-100 text-slate-500",
};

const INTENT_SHORT = {
  PCI_COMPLIANCE: "PCI",
  MAGECART_PREVENTION: "Magecart",
  PRIVACY_GDPR: "Privacy",
  SUPPLY_CHAIN: "Supply Chain",
  TOOL_EVALUATION: "Tool Eval",
  GENERAL_AWARENESS: "General",
};

export default function RecentConversations({ conversations }) {
  const [expanded, setExpanded] = useState(null);

  const sorted = [...conversations]
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, 50);

  return (
    <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-6">
      <h3 className="text-sm font-semibold mb-4" style={{ color: NAVY }}>Recent Conversations (last 50)</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-100">
              {["", "Timestamp", "Geo", "Intent", "Outcome", "Turns", "CTA", "Referral", "Transcript Preview"].map(h => (
                <th key={h} className="text-left py-2 pr-3 font-semibold text-slate-500 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((c) => (
              <>
                <tr
                  key={c.id}
                  className="border-b border-slate-50 hover:bg-slate-50 cursor-pointer"
                  onClick={() => setExpanded(expanded === c.id ? null : c.id)}
                >
                  <td className="py-2 pr-2 text-slate-400">
                    {expanded === c.id ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                  </td>
                  <td className="py-2 pr-3 text-slate-500 whitespace-nowrap">
                    {c.timestamp ? format(parseISO(c.timestamp), "MMM d, HH:mm") : "—"}
                  </td>
                  <td className="py-2 pr-3 text-slate-700">{c.geo || "—"}</td>
                  <td className="py-2 pr-3 text-slate-700">{INTENT_SHORT[c.intentClassification] || c.intentClassification || "—"}</td>
                  <td className="py-2 pr-3">
                    <span className={`px-2 py-0.5 rounded-full font-medium ${OUTCOME_COLORS[c.conversationOutcome] || "bg-slate-100 text-slate-500"}`}>
                      {c.conversationOutcome || "—"}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-center text-slate-700">{c.conversationTurns ?? "—"}</td>
                  <td className="py-2 pr-3 text-center">
                    {c.ctaReached ? <span className="text-green-600 font-bold">✓</span> : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="py-2 pr-3 text-slate-500">{c.referralSource || "direct"}</td>
                  <td className="py-2 pr-3 text-slate-400 max-w-xs truncate">
                    {(c.conversationTranscript || "").slice(0, 100)}
                  </td>
                </tr>
                {expanded === c.id && (
                  <tr key={`${c.id}-expanded`} className="bg-slate-50">
                    <td colSpan={9} className="px-4 py-4">
                      <pre className="text-xs text-slate-600 whitespace-pre-wrap font-mono leading-relaxed max-h-64 overflow-y-auto">
                        {c.conversationTranscript || "(no transcript)"}
                      </pre>
                    </td>
                  </tr>
                )}
              </>
            ))}
            {sorted.length === 0 && (
              <tr><td colSpan={9} className="py-8 text-center text-slate-400">No conversations yet</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}