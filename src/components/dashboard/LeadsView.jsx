import { useState } from "react";
import { format, parseISO } from "date-fns";
import { ChevronDown, ChevronUp } from "lucide-react";

const NAVY = "#103a77";
const ACCENT = "#4568ff";

const INTENT_SHORT = {
  PCI_COMPLIANCE: "PCI",
  MAGECART_PREVENTION: "Magecart",
  PRIVACY_GDPR: "Privacy",
  SUPPLY_CHAIN: "Supply Chain",
  TOOL_EVALUATION: "Tool Eval",
  GENERAL_AWARENESS: "General",
};

const GEO_FLAGS = {
  "United States": "🇺🇸", "US": "🇺🇸",
  "United Kingdom": "🇬🇧", "UK": "🇬🇧", "GB": "🇬🇧",
  "Germany": "🇩🇪", "DE": "🇩🇪",
  "France": "🇫🇷", "FR": "🇫🇷",
  "Israel": "🇮🇱", "IL": "🇮🇱",
  "Netherlands": "🇳🇱", "NL": "🇳🇱",
  "Canada": "🇨🇦", "CA": "🇨🇦",
  "Australia": "🇦🇺", "AU": "🇦🇺",
  "Singapore": "🇸🇬", "SG": "🇸🇬",
  "India": "🇮🇳", "IN": "🇮🇳",
  "Japan": "🇯🇵", "JP": "🇯🇵",
  "Brazil": "🇧🇷", "BR": "🇧🇷",
  "Spain": "🇪🇸", "ES": "🇪🇸",
  "Italy": "🇮🇹", "IT": "🇮🇹",
  "Sweden": "🇸🇪", "SE": "🇸🇪",
  "Switzerland": "🇨🇭", "CH": "🇨🇭",
  "Poland": "🇵🇱", "PL": "🇵🇱",
  "Belgium": "🇧🇪", "BE": "🇧🇪",
  "Denmark": "🇩🇰", "DK": "🇩🇰",
  "Norway": "🇳🇴", "NO": "🇳🇴",
};

function getFlag(geo) {
  if (!geo) return "🌍";
  return GEO_FLAGS[geo] || "🌍";
}

function cleanDomain(src) {
  if (!src) return "direct";
  try {
    const url = src.startsWith("http") ? new URL(src) : null;
    if (!url) return src;
    return url.hostname.replace(/^www\./, "");
  } catch {
    return src;
  }
}

function LeadCard({ conv }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="bg-white border rounded-lg p-4 transition-shadow hover:shadow-md"
      style={{ borderColor: "#edf0f2", borderRadius: 8 }}
    >
      <div className="flex gap-4">
        {/* Left column */}
        <div className="flex flex-col gap-1.5" style={{ width: "25%" }}>
          <div className="text-sm font-medium text-slate-700">
            {getFlag(conv.geo)} {conv.geo || "Unknown"}
          </div>
          <span
            className="self-start text-white px-2 py-0.5 rounded-full font-medium"
            style={{ backgroundColor: ACCENT, fontSize: 11 }}
          >
            {INTENT_SHORT[conv.intentClassification] || conv.intentClassification || "General"}
          </span>
          <div className="text-slate-400" style={{ fontSize: 12 }}>
            {cleanDomain(conv.referralSource)}
          </div>
          <div className="text-slate-400" style={{ fontSize: 12 }}>
            {conv.timestamp ? format(parseISO(conv.timestamp), "MMM d, HH:mm") : "—"}
          </div>
        </div>

        {/* Middle column */}
        <div className="flex flex-col gap-1.5" style={{ width: "50%" }}>
          <div className="text-xs font-semibold text-slate-500">
            {conv.conversationTurns ?? 0} turns
          </div>
          <p className="text-slate-500 italic leading-relaxed" style={{ fontSize: 12 }}>
            {(() => {
              function decodeHtml(str) {
                return str
                  .replace(/&#8211;/g, "–")
                  .replace(/&#8217;/g, "\u2019")
                  .replace(/&#8216;/g, "\u2018")
                  .replace(/&#8220;/g, "\u201c")
                  .replace(/&#8221;/g, "\u201d")
                  .replace(/&amp;/g, "&")
                  .replace(/&quot;/g, '"')
                  .replace(/&lt;/g, "<")
                  .replace(/&gt;/g, ">")
                  .replace(/&#\d+;/g, "");
              }
              const lines = (conv.conversationTranscript || "").split("\n");
              const clean = lines.find(l => {
                const t = l.trim();
                if (t.length < 20) return false;
                if (t.includes("&#")) return false;
                if (/^(Page:|URL:|Type:|Content:)/.test(t)) return false;
                if ((t.startsWith("Agent:") || t.startsWith("Visitor:")) && t.includes("[RELEVANT")) return false;
                return t.startsWith("Agent:") || t.startsWith("Visitor:");
              });
              if (!clean) return "No conversation preview available";
              const text = decodeHtml(clean.replace(/^(Agent:|Visitor:)\s*/, "").trim());
              return text.length > 150 ? text.slice(0, 150) + "…" : text;
            })()}
          </p>
        </div>

        {/* Right column */}
        <div className="flex flex-col gap-2 items-end" style={{ width: "25%" }}>
          <span
            className="px-2 py-0.5 rounded-full text-white font-medium"
            style={{
              fontSize: 11,
              backgroundColor: conv.ctaReached ? "#16a34a" : "#94a3b8",
            }}
          >
            {conv.ctaReached ? "CTA Offered ✓" : "No CTA"}
          </span>
          <span
            className="px-2 py-0.5 rounded-full text-white font-medium"
            style={{
              fontSize: 11,
              backgroundColor: (conv.linksClicked > 0) ? "#16a34a" : "#94a3b8",
            }}
          >
            {conv.linksClicked > 0 ? `Link Clicked ✓` : "No Click"}
          </span>
          <button
            onClick={() => setExpanded(v => !v)}
            className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 mt-auto"
          >
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {expanded ? "Hide transcript" : "View full transcript"}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-4 pt-4 border-t border-slate-100">
          <pre className="text-xs text-slate-600 whitespace-pre-wrap font-mono leading-relaxed max-h-72 overflow-y-auto">
            {conv.conversationTranscript || "(no transcript)"}
          </pre>
        </div>
      )}
    </div>
  );
}

export default function LeadsView({ conversations }) {
  const leads = conversations
    .filter(c =>
      !c.isTrainingData &&
      !(c.referralSource || "").includes("wp-admin") &&
      (c.conversationTurns >= 1) &&
      ((c.conversationTurns >= 3) || c.ctaReached)
    )
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, 30);

  return (
    <div className="mb-8">
      <div className="mb-4">
        <h2 className="text-xl font-bold" style={{ color: NAVY }}>Active Leads</h2>
        <p className="text-sm text-slate-400 mt-0.5">
          High-intent visitor conversations — updated in real time
        </p>
      </div>
      <div className="flex flex-col" style={{ gap: 8 }}>
        {leads.length === 0 && (
          <div className="text-slate-400 text-sm py-8 text-center">No leads found for the selected period.</div>
        )}
        {leads.map(conv => (
          <LeadCard key={conv.id} conv={conv} />
        ))}
      </div>
    </div>
  );
}