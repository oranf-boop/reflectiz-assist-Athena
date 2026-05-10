import { useState, useEffect } from "react";
import { format, subDays, parseISO } from "date-fns";
import { Bookmark } from "lucide-react";

const NAVY = "#103a77";
const GO_LIVE_KEY = "reflectiz_go_live_date";

const PILLS = [
  { label: "7D", days: 7 },
  { label: "30D", days: 30 },
  { label: "All", days: null },
];

export default function DateFilter({ onChange }) {
  const [activePill, setActivePill] = useState("30D");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [goLiveDate, setGoLiveDate] = useState(() => localStorage.getItem(GO_LIVE_KEY) || "");

  // Emit filter on mount with default (30D)
  useEffect(() => {
    emitPill("30D");
  }, []);

  function emitPill(label) {
    const pill = [...PILLS, ...(goLiveDate ? [{ label: "Since Launch", days: null, from: goLiveDate }] : [])].find(p => p.label === label);
    if (!pill) return;

    if (pill.from) {
      // Since Launch
      onChange({ from: parseISO(pill.from), to: new Date() });
    } else if (pill.days === null) {
      onChange({ from: null, to: null });
    } else {
      onChange({ from: subDays(new Date(), pill.days), to: new Date() });
    }
  }

  function handlePillClick(label) {
    setActivePill(label);
    setFromDate("");
    setToDate("");
    emitPill(label);
  }

  function handleCustomDate(newFrom, newTo) {
    setActivePill(null);
    const from = newFrom ? parseISO(newFrom) : null;
    const to = newTo ? parseISO(newTo) : null;
    onChange({ from, to });
  }

  function handleBookmarkClick() {
    const newGoLive = fromDate || format(new Date(), "yyyy-MM-dd");
    const label = window.prompt("Set go-live date:", newGoLive);
    if (!label) return;
    localStorage.setItem(GO_LIVE_KEY, label);
    setGoLiveDate(label);
    // If "Since Launch" is now active, re-emit
    if (activePill === "Since Launch") {
      onChange({ from: parseISO(label), to: new Date() });
    }
  }

  const allPills = [
    ...PILLS,
    ...(goLiveDate ? [{ label: "Since Launch", days: null, from: goLiveDate }] : []),
  ];

  return (
    <div className="flex items-center gap-3 flex-wrap justify-end">
      {/* Go-live bookmark */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={handleBookmarkClick}
          title={goLiveDate ? `Go-live: ${goLiveDate}. Click to update.` : "Set go-live date"}
          className="flex items-center gap-1 text-slate-400 hover:text-slate-600 transition-colors"
          style={{ fontSize: 12 }}
        >
          <Bookmark
            className="w-3.5 h-3.5"
            fill={goLiveDate ? NAVY : "none"}
            style={{ color: goLiveDate ? NAVY : undefined }}
          />
        </button>
        {goLiveDate && (
          <span className="text-slate-400" style={{ fontSize: 11 }}>
            Launch: {goLiveDate}
          </span>
        )}
      </div>

      {/* Quick pills */}
      <div className="flex items-center gap-1">
        {allPills.map(({ label }) => {
          const isActive = activePill === label;
          return (
            <button
              key={label}
              onClick={() => handlePillClick(label)}
              className="px-2.5 py-1 rounded-full text-xs font-medium transition-all border"
              style={{
                borderColor: isActive ? NAVY : "#e2e8f0",
                backgroundColor: isActive ? NAVY : "transparent",
                color: isActive ? "#fff" : "#64748b",
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Custom date range */}
      <div className="flex items-center gap-1.5">
        <input
          type="date"
          value={fromDate}
          onChange={e => {
            setFromDate(e.target.value);
            handleCustomDate(e.target.value, toDate);
          }}
          className="border border-slate-200 rounded px-2 py-1 text-slate-600 focus:outline-none focus:border-slate-400"
          style={{ fontSize: 11, height: 28 }}
          placeholder="From"
        />
        <span className="text-slate-300 text-xs">→</span>
        <input
          type="date"
          value={toDate}
          onChange={e => {
            setToDate(e.target.value);
            handleCustomDate(fromDate, e.target.value);
          }}
          className="border border-slate-200 rounded px-2 py-1 text-slate-600 focus:outline-none focus:border-slate-400"
          style={{ fontSize: 11, height: 28 }}
          placeholder="To"
        />
      </div>
    </div>
  );
}