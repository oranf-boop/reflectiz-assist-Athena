import { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { subDays, parseISO } from "date-fns";
import KPICards from "@/components/dashboard/KPICards";
import TrendCharts from "@/components/dashboard/TrendCharts";
import SegmentTables from "@/components/dashboard/SegmentTables";
import RecentConversations from "@/components/dashboard/RecentConversations";

const DATE_RANGES = [
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "All time", days: null },
];

const NAVY = "#103a77";

export default function AgentDashboard() {
  const [conversations, setConversations] = useState([]);
  const [linkClickCount, setLinkClickCount] = useState(0);
  const [agentVersion, setAgentVersion] = useState("—");
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState(30);

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      const [convs, clicks, configs] = await Promise.all([
        base44.entities.Conversations.list("-timestamp", 2000),
        base44.entities.LinkClicks.list("-clickedAt", 1),
        base44.entities.AgentConfig.list("-version", 50),
      ]);
      setConversations(convs || []);

      // Get total link clicks count via a separate full list
      const allClicks = await base44.entities.LinkClicks.list("-clickedAt", 5000);
      setLinkClickCount(allClicks.length);

      const maxVersion = configs && configs.length > 0
        ? Math.max(...configs.map(c => c.version || 0))
        : "—";
      setAgentVersion(maxVersion);
      setLoading(false);
    }
    loadData();
  }, []);

  const filteredConversations = useMemo(() => {
    if (!range) return conversations;
    const cutoff = subDays(new Date(), range);
    return conversations.filter(c => {
      if (!c.timestamp) return false;
      return parseISO(c.timestamp) >= cutoff;
    });
  }, [conversations, range]);

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-100 px-8 py-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold" style={{ color: NAVY }}>Reflectiz Agent Dashboard</h1>
          <p className="text-xs text-slate-400 mt-0.5">Live performance data — updates in real time</p>
        </div>
        <div className="flex gap-2">
          {DATE_RANGES.map(({ label, days }) => (
            <button
              key={label}
              onClick={() => setRange(days)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                range === days
                  ? "text-white shadow-sm"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
              style={range === days ? { backgroundColor: NAVY } : {}}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="px-8 py-6">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="w-8 h-8 border-4 border-slate-200 rounded-full animate-spin" style={{ borderTopColor: NAVY }} />
          </div>
        ) : (
          <>
            <KPICards
              conversations={filteredConversations}
              linkClicks={linkClickCount}
              agentVersion={agentVersion}
            />
            <TrendCharts conversations={filteredConversations} />
            <SegmentTables conversations={filteredConversations} />
            <RecentConversations conversations={filteredConversations} />
          </>
        )}
      </div>
    </div>
  );
}