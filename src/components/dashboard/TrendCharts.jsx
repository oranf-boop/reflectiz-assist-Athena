import { useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  BarChart, Bar, Cell,
} from "recharts";
import { format, subDays, parseISO, startOfDay } from "date-fns";

const INTENT_LABELS = {
  PCI_COMPLIANCE: "PCI",
  MAGECART_PREVENTION: "Magecart",
  PRIVACY_GDPR: "Privacy",
  SUPPLY_CHAIN: "Supply Chain",
  TOOL_EVALUATION: "Tool Eval",
  GENERAL_AWARENESS: "General",
};

const NAVY = "#103a77";
const ACCENT = "#4568ff";

export default function TrendCharts({ conversations, clickedSessionIds }) {
  const dailyData = useMemo(() => {
    const days = {};
    for (let i = 29; i >= 0; i--) {
      const d = format(subDays(new Date(), i), "MM/dd");
      days[d] = { date: d, conversations: 0, converted: 0 };
    }
    conversations.forEach(c => {
      if (!c.timestamp) return;
      const d = format(parseISO(c.timestamp), "MM/dd");
      if (days[d]) {
        days[d].conversations++;
        if (clickedSessionIds.has(c.sessionId)) days[d].converted++;
      }
    });
    return Object.values(days).map(d => ({
      ...d,
      rate: d.conversations > 0 ? parseFloat(((d.converted / d.conversations) * 100).toFixed(1)) : 0,
    }));
  }, [conversations, clickedSessionIds]);

  const intentData = useMemo(() => {
    const map = {};
    conversations.forEach(c => {
      const intent = c.intentClassification || "GENERAL_AWARENESS";
      if (!map[intent]) map[intent] = { total: 0, converted: 0 };
      map[intent].total++;
      if (clickedSessionIds.has(c.sessionId)) map[intent].converted++;
    });
    return Object.entries(map).map(([intent, v]) => ({
      intent: INTENT_LABELS[intent] || intent,
      rate: v.total > 0 ? parseFloat(((v.converted / v.total) * 100).toFixed(1)) : 0,
      total: v.total,
    })).sort((a, b) => b.rate - a.rate);
  }, [conversations, clickedSessionIds]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-6">
        <h3 className="text-sm font-semibold mb-4" style={{ color: NAVY }}>Daily Conversations & Conversion Rate (30 days)</h3>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={dailyData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="date" tick={{ fontSize: 10 }} interval={4} />
            <YAxis yAxisId="left" tick={{ fontSize: 10 }} />
            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} unit="%" />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line yAxisId="left" type="monotone" dataKey="conversations" stroke={NAVY} dot={false} name="Conversations" strokeWidth={2} />
            <Line yAxisId="right" type="monotone" dataKey="rate" stroke={ACCENT} dot={false} name="Conv. Rate %" strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-6">
        <h3 className="text-sm font-semibold mb-4" style={{ color: NAVY }}>Conversion Rate by Intent</h3>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={intentData} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
            <XAxis type="number" unit="%" tick={{ fontSize: 10 }} />
            <YAxis type="category" dataKey="intent" tick={{ fontSize: 10 }} width={80} />
            <Tooltip formatter={(v) => `${v}%`} />
            <Bar dataKey="rate" name="Conv. Rate" radius={[0, 4, 4, 0]}>
              {intentData.map((_, i) => (
                <Cell key={i} fill={i === 0 ? NAVY : ACCENT} fillOpacity={1 - i * 0.1} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}