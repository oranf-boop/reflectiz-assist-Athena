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

function extractOpener(transcript) {
  if (!transcript) return "—";
  // First "Agent:" line in the transcript
  const match = transcript.match(/Agent:\s*(.+)/);
  return match ? match[1].trim() : "—";
}

function formatPages(pagesViewed) {
  if (!pagesViewed) return ["—"];
  const pages = typeof pagesViewed === "string"
    ? pagesViewed.split(",").map(p => p.trim()).filter(Boolean)
    : pagesViewed;
  return pages.length > 0 ? pages : ["—"];
}

export default function VisitsTable({ conversations }) {
  const [expanded, setExpanded] = useState(null);
  const [search, setSearch] = useState("");

  const sorted = [...conversations]
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  const filtered = sorted.filter(c => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (c.geo || "").toLowerCase().includes(q) ||
      (c.pagesViewed || "").toLowerCase().includes(q) ||
      (c.conversationTranscript || "").toLowerCase().includes(q) ||
      (c.referralSource || "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold" style={{ color: NAVY }}>All Visits</h3>
          <p className="text-xs text-slate-400 mt-0.5">{filtered.length} visits — pages viewed & opener message shown</p>
        </div>
        <input
          type="text"
          placeholder="Search by geo, URL, referral…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="text-xs border border-slate-200 rounded-lg px-3 py-1.5 w-56 focus:outline-none focus:ring-1 focus:ring-blue-300"
        />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="text-left py-2 pr-3 font-semibold text-slate-500 w-4"></th>
              <th className="text-left py-2 pr-3 font-semibold text-slate-500 whitespace-nowrap">Date & Time</th>
              <th className="text-left py-2 pr-3 font-semibold text-slate-500">Geo</th>
              <th className="text-left py-2 pr-3 font-semibold text-slate-500">Outcome</th>
              <th className="text-left py-2 pr-3 font-semibold text-slate-500">Pages Viewed</th>
              <th className="text-left py-2 pr-3 font-semibold text-slate-500">Opener Shown</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => {
              const pages = formatPages(c.pagesViewed);
              const opener = extractOpener(c.conversationTranscript);
              const isExpanded = expanded === c.id;

              return (
                <>
                  <tr
                    key={c.id}
                    className="border-b border-slate-50 hover:bg-slate-50 cursor-pointer align-top"
                    onClick={() => setExpanded(isExpanded ? null : c.id)}
                  >
                    <td className="py-2 pr-2 text-slate-400 pt-3">
                      {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    </td>
                    <td className="py-2 pr-3 text-slate-500 whitespace-nowrap">
                      {c.timestamp ? format(parseISO(c.timestamp), "MMM d, HH:mm") : "—"}
                    </td>
                    <td className="py-2 pr-3 text-slate-700 whitespace-nowrap">{c.geo || "—"}</td>
                    <td className="py-2 pr-3">
                      <span className={`px-2 py-0.5 rounded-full font-medium ${OUTCOME_COLORS[c.conversationOutcome] || "bg-slate-100 text-slate-500"}`}>
                        {c.conversationOutcome || "—"}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-slate-600 max-w-xs">
                      <div className="flex flex-col gap-0.5">
                        {pages.slice(0, 3).map((p, i) => (
                          <span key={i} className="truncate block max-w-[200px] text-blue-600" title={p}>{p}</span>
                        ))}
                        {pages.length > 3 && (
                          <span className="text-slate-400">+{pages.length - 3} more</span>
                        )}
                      </div>
                    </td>
                    <td className="py-2 pr-3 text-slate-500 max-w-sm">
                      <span className="line-clamp-2">{opener}</span>
                    </td>
                  </tr>

                  {isExpanded && (
                    <tr key={`${c.id}-exp`} className="bg-slate-50">
                      <td colSpan={6} className="px-4 py-4">
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <p className="text-xs font-semibold text-slate-500 mb-1">All Pages Visited</p>
                            <ul className="space-y-0.5">
                              {pages.map((p, i) => (
                                <li key={i} className="text-xs text-blue-600 break-all">{p}</li>
                              ))}
                            </ul>
                          </div>
                          <div>
                            <p className="text-xs font-semibold text-slate-500 mb-1">Full Transcript</p>
                            <pre className="text-xs text-slate-600 whitespace-pre-wrap font-mono leading-relaxed max-h-48 overflow-y-auto">
                              {c.conversationTranscript || "(no transcript)"}
                            </pre>
                          </div>
                        </div>
                        {c.referralSource && (
                          <p className="text-xs text-slate-400 mt-2">Referral: {c.referralSource}</p>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="py-8 text-center text-slate-400">No visits found</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}