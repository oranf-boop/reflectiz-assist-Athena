import { useState, useEffect } from "react";
import { format, parseISO } from "date-fns";
import { ChevronDown, ChevronUp, Check, X } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { base44 } from "@/api/base44Client";

const NAVY = "#103a77";

function DiffView({ previousPrompt, proposedPrompt }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
      <div>
        <p className="text-xs font-semibold text-slate-500 mb-1">Previous Prompt</p>
        <textarea
          readOnly
          value={previousPrompt || ""}
          className="w-full h-64 text-xs font-mono bg-red-50 border border-red-100 rounded-lg p-3 resize-none text-slate-700"
        />
      </div>
      <div>
        <p className="text-xs font-semibold text-slate-500 mb-1">Proposed Prompt</p>
        <textarea
          readOnly
          value={proposedPrompt || ""}
          className="w-full h-64 text-xs font-mono bg-green-50 border border-green-100 rounded-lg p-3 resize-none text-slate-700"
        />
      </div>
    </div>
  );
}

function PendingChangeCard({ change, onApprove, onReject }) {
  const [diffOpen, setDiffOpen] = useState(false);
  const [loading, setLoading] = useState(null); // "approve" | "reject" | null

  async function handleApprove() {
    setLoading("approve");
    await onApprove(change);
    setLoading(null);
  }

  async function handleReject() {
    setLoading("reject");
    await onReject(change);
    setLoading(null);
  }

  return (
    <div className="bg-white border border-slate-100 rounded-xl p-5 shadow-sm">
      {/* Header row */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div className="flex flex-wrap gap-2 items-center">
          <span
            className="text-xs font-semibold px-2.5 py-1 rounded-full text-white"
            style={{ backgroundColor: "#4568ff" }}
          >
            Confidence {change.confidenceScore ?? "—"}/10
          </span>
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-100 text-slate-600">
            {change.sampleSize ?? "—"} conversations
          </span>
          <span className="text-xs text-slate-400">
            {change.createdAt ? format(parseISO(change.createdAt), "MMM d, yyyy") : "—"}
          </span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleApprove}
            disabled={!!loading}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-semibold text-white bg-green-600 hover:bg-green-700 disabled:opacity-50 transition-colors"
          >
            <Check className="w-3.5 h-3.5" />
            {loading === "approve" ? "Applying…" : "Approve and go live"}
          </button>
          <button
            onClick={handleReject}
            disabled={!!loading}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-semibold text-slate-600 border border-red-300 hover:bg-red-50 disabled:opacity-50 transition-colors"
          >
            <X className="w-3.5 h-3.5 text-red-400" />
            {loading === "reject" ? "Rejecting…" : "Reject"}
          </button>
        </div>
      </div>

      {/* Change summary */}
      <p className="text-sm text-slate-700 leading-relaxed mb-3">{change.changeSummary}</p>

      {/* Expandable diff */}
      <button
        onClick={() => setDiffOpen(v => !v)}
        className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 transition-colors"
      >
        {diffOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        {diffOpen ? "Hide full diff" : "View full diff"}
      </button>

      {diffOpen && (
        <DiffView previousPrompt={change.previousPrompt} proposedPrompt={change.proposedPrompt} />
      )}
    </div>
  );
}

export default function PendingAgentUpdates({ onApproved }) {
  const { toast } = useToast();
  const [pendingChanges, setPendingChanges] = useState([]);
  const [historyChanges, setHistoryChanges] = useState([]);
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    base44.entities.PendingConfigChanges.list("-createdAt", 50)
      .then(all => {
        setPendingChanges(all.filter(c => c.status === "pending"));
        setHistoryChanges(all.filter(c => c.status !== "pending"));
      })
      .catch(() => { setPendingChanges([]); setHistoryChanges([]); });
  }, []);

  async function handleApprove(change) {
    const configs = await base44.entities.AgentConfig.list("-version", 1);
    const currentVersion = configs?.[0]?.version ?? 0;
    const nextVersion = currentVersion + 1;
    const today = new Date().toISOString().split("T")[0];

    await base44.entities.AgentConfig.create({
      version: nextVersion,
      systemPrompt: change.proposedPrompt,
      updatedAt: today,
      updateReason: change.changeSummary,
      previousPrompt: change.previousPrompt,
    });

    await base44.entities.PendingConfigChanges.update(change.id, {
      status: "approved",
      reviewedAt: today,
    });

    setPendingChanges(prev => prev.filter(c => c.id !== change.id));
    toast({ title: `Agent prompt updated to v${nextVersion}.` });
    if (onApproved) onApproved();
  }

  async function handleReject(change) {
    const today = new Date().toISOString().split("T")[0];
    await base44.entities.PendingConfigChanges.update(change.id, {
      status: "rejected",
      reviewedAt: today,
    });
    setPendingChanges(prev => prev.filter(c => c.id !== change.id));
    toast({ title: "Change rejected and dismissed." });
  }

  if (pendingChanges.length === 0 && historyChanges.length === 0) return null;

  return (
    <div className="mb-8">
      {pendingChanges.length > 0 && (
        <>
          <div className="mb-4">
            <h2 className="text-xl font-bold" style={{ color: NAVY }}>Pending Agent Updates</h2>
            <p className="text-sm text-slate-400 mt-0.5">Review AI-proposed changes before they go live</p>
          </div>
          <div className="flex flex-col gap-4 mb-6">
            {pendingChanges.map(change => (
              <PendingChangeCard key={change.id} change={change} onApprove={handleApprove} onReject={handleReject} />
            ))}
          </div>
        </>
      )}

      {historyChanges.length > 0 && (
        <div>
          <button
            onClick={() => setHistoryOpen(v => !v)}
            className="flex items-center gap-2 w-full text-left px-4 py-3 bg-white border border-slate-100 rounded-xl shadow-sm hover:bg-slate-50 transition-colors mb-2"
          >
            <span className="font-semibold text-sm" style={{ color: NAVY }}>Changes Log ({historyChanges.length})</span>
            {historyOpen ? <ChevronUp className="w-4 h-4 text-slate-400 ml-auto" /> : <ChevronDown className="w-4 h-4 text-slate-400 ml-auto" />}
          </button>
          {historyOpen && (
            <div className="flex flex-col gap-3">
              {historyChanges.map(change => (
                <div key={change.id} className="bg-white border border-slate-100 rounded-xl p-4 shadow-sm">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${change.status === "approved" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"}`}>
                      {change.status === "approved" ? "Approved" : "Rejected"}
                    </span>
                    <span className="text-xs px-2.5 py-1 rounded-full bg-slate-100 text-slate-600">Confidence {change.confidenceScore ?? "—"}/10</span>
                    <span className="text-xs px-2.5 py-1 rounded-full bg-slate-100 text-slate-600">{change.sampleSize ?? "—"} conversations</span>
                    <span className="text-xs text-slate-400 ml-auto">
                      {change.reviewedAt ? `Reviewed ${change.reviewedAt}` : `Created ${change.createdAt || "—"}`}
                    </span>
                  </div>
                  <p className="text-sm text-slate-600">{change.changeSummary}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}