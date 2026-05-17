import { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { parseISO } from "date-fns";
import { ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import KPICards from "@/components/dashboard/KPICards";
import TrendCharts from "@/components/dashboard/TrendCharts";
import SegmentTables from "@/components/dashboard/SegmentTables";
import LeadsView from "@/components/dashboard/LeadsView";
import DateFilter from "@/components/dashboard/DateFilter";

const NAVY = "#103a77";

const INTERNAL_SOURCES = ["wp-admin", "lovable.dev", "base44.com", "localhost", "lovableproject.com"];

function isInternalSession(c) {
  const src = c.referralSource || "";
  if (!src) return false; // empty referral = real visitor, keep it
  return INTERNAL_SOURCES.some(s => src.includes(s));
}

export default function AgentDashboard() {
  const { toast } = useToast();
  const [conversations, setConversations] = useState([]);
  const [linkClickCount, setLinkClickCount] = useState(0);
  const [clickedSessionIds, setClickedSessionIds] = useState(new Set());
  const [agentVersion, setAgentVersion] = useState("—");
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState({ from: null, to: null });
  const [includeTraining, setIncludeTraining] = useState(false);
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [learningCycleRunning, setLearningCycleRunning] = useState(false);

  async function loadData() {
    setLoading(true);
    const [convs, allClicks, configs] = await Promise.all([
      base44.entities.Conversations.list("-timestamp", 2000),
      base44.entities.LinkClicks.list("-clickedAt", 5000),
      base44.entities.AgentConfig.list("-version", 50),
    ]);
    setConversations(convs || []);
    setLinkClickCount(allClicks.length);
    setClickedSessionIds(new Set((allClicks || []).map(lc => lc.sessionId).filter(Boolean)));
    const maxVersion = configs && configs.length > 0
      ? Math.max(...configs.map(c => c.version || 0))
      : "—";
    setAgentVersion(maxVersion);
    setLoading(false);
  }

  useEffect(() => { loadData(); }, []);

  async function runLearningCycle() {
    setLearningCycleRunning(true);
    try {
      await base44.functions.invoke("analyzeAndLearn", {});
      await base44.functions.invoke("applyLearning", {});
      toast({ title: "Learning cycle complete. Agent updated." });
      await loadData();
    } catch {
      toast({ title: "Learning cycle failed. Check logs.", variant: "destructive" });
    } finally {
      setLearningCycleRunning(false);
    }
  }

  const filteredConversations = useMemo(() => {
    return conversations.filter(c => {
      if (isInternalSession(c)) return false;
      if (!includeTraining && c.isTrainingData) return false;
      if (dateRange.from && (!c.timestamp || parseISO(c.timestamp) < dateRange.from)) return false;
      if (dateRange.to && (!c.timestamp || parseISO(c.timestamp) > dateRange.to)) return false;
      return true;
    });
  }, [conversations, dateRange, includeTraining]);

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-100 px-8 py-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold" style={{ color: NAVY }}>Reflectiz Agent Dashboard</h1>
          <p className="text-xs text-slate-400 mt-0.5">Live performance data — updates in real time</p>
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-xs text-slate-500 cursor-pointer select-none">
            <div
              onClick={() => setIncludeTraining(v => !v)}
              className={`w-8 h-4 rounded-full relative transition-colors cursor-pointer ${includeTraining ? "bg-blue-500" : "bg-slate-200"}`}
            >
              <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${includeTraining ? "translate-x-4" : "translate-x-0.5"}`} />
            </div>
            Include training data
          </label>
          <DateFilter onChange={setDateRange} />
          <button
            onClick={runLearningCycle}
            disabled={learningCycleRunning}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white transition-opacity disabled:opacity-60"
            style={{ backgroundColor: "#4568ff" }}
          >
            <RefreshCw className={`w-4 h-4 ${learningCycleRunning ? "animate-spin" : ""}`} />
            {learningCycleRunning ? "Running..." : "Run Learning Cycle"}
          </button>
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
              clickedSessionIds={clickedSessionIds}
              agentVersion={agentVersion}
            />
            <TrendCharts conversations={filteredConversations} clickedSessionIds={clickedSessionIds} />
            <LeadsView conversations={filteredConversations} />

            {/* Collapsible Detailed Breakdown */}
            <div className="mb-8">
              <button
                onClick={() => setBreakdownOpen(v => !v)}
                className="flex items-center gap-2 w-full text-left px-4 py-3 bg-white border border-slate-100 rounded-xl shadow-sm hover:bg-slate-50 transition-colors"
              >
                <span className="font-semibold text-sm" style={{ color: NAVY }}>Detailed Breakdown</span>
                {breakdownOpen
                  ? <ChevronUp className="w-4 h-4 text-slate-400 ml-auto" />
                  : <ChevronDown className="w-4 h-4 text-slate-400 ml-auto" />}
              </button>
              {breakdownOpen && (
                <div className="mt-4">
                  <SegmentTables conversations={filteredConversations} clickedSessionIds={clickedSessionIds} />
                </div>
              )}
            </div>


          </>
        )}
      </div>
    </div>
  );
}