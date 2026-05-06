import { useMemo } from "react";

const NAVY = "#103a77";

function formatReferralSource(src) {
  if (!src) return "direct";
  try {
    const url = src.startsWith("http") ? new URL(src) : null;
    if (!url) return src;
    const host = url.hostname.replace(/^www\./, "");
    const path = url.pathname.replace(/\/$/, "");
    // Show up to first two path segments
    const segments = path.split("/").filter(Boolean).slice(0, 2);
    return segments.length > 0 ? `${host}/${segments.join("/")}` : host;
  } catch {
    return src;
  }
}

function SegmentTable({ title, data, columns }) {
  return (
    <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5 flex-1 min-w-0">
      <h3 className="text-sm font-semibold mb-3" style={{ color: NAVY }}>{title}</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-100">
              {columns.map(col => (
                <th key={col.key} className="text-left py-2 pr-3 font-semibold text-slate-500">{col.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.length === 0 && (
              <tr><td colSpan={columns.length} className="py-4 text-center text-slate-400">No data</td></tr>
            )}
            {data.map((row, i) => (
              <tr key={i} className="border-b border-slate-50 hover:bg-slate-50">
                {columns.map(col => (
                  <td key={col.key} className="py-2 pr-3 text-slate-700">{row[col.key]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function SegmentTables({ conversations }) {
  const geoData = useMemo(() => {
    const map = {};
    conversations.forEach(c => {
      const key = c.geo || "Unknown";
      if (!map[key]) map[key] = { total: 0, converted: 0 };
      map[key].total++;
      if (c.conversationOutcome === "CONVERTED") map[key].converted++;
    });
    return Object.entries(map)
      .map(([geo, v]) => ({
        geo,
        conversations: v.total,
        converted: v.converted,
        rate: `${v.total > 0 ? ((v.converted / v.total) * 100).toFixed(1) : 0}%`,
      }))
      .sort((a, b) => b.conversations - a.conversations)
      .slice(0, 10);
  }, [conversations]);

  const referralData = useMemo(() => {
    const map = {};
    conversations.forEach(c => {
      const key = c.referralSource || "direct";
      if (!map[key]) map[key] = { total: 0, converted: 0 };
      map[key].total++;
      if (c.conversationOutcome === "CONVERTED") map[key].converted++;
    });
    return Object.entries(map)
      .map(([source, v]) => ({
        source: formatReferralSource(source),
        conversations: v.total,
        converted: v.converted,
        rate: `${v.total > 0 ? ((v.converted / v.total) * 100).toFixed(1) : 0}%`,
      }))
      .sort((a, b) => b.conversations - a.conversations)
      .slice(0, 10);
  }, [conversations]);

  const pageData = useMemo(() => {
    const map = {};
    conversations.forEach(c => {
      const pages = c.pagesViewed ? c.pagesViewed.split(",") : [];
      const landing = pages[0] || "Unknown";
      if (!map[landing]) map[landing] = { total: 0, cta: 0 };
      map[landing].total++;
      if (c.ctaReached) map[landing].cta++;
    });
    return Object.entries(map)
      .map(([page, v]) => ({
        page: page.length > 35 ? page.slice(0, 35) + "…" : page,
        conversations: v.total,
        ctaRate: `${v.total > 0 ? ((v.cta / v.total) * 100).toFixed(1) : 0}%`,
      }))
      .sort((a, b) => b.conversations - a.conversations)
      .slice(0, 10);
  }, [conversations]);

  return (
    <div className="flex flex-col lg:flex-row gap-6 mb-8">
      <SegmentTable
        title="Conversion Rate by Country"
        data={geoData}
        columns={[
          { key: "geo", label: "Country" },
          { key: "conversations", label: "Convs." },
          { key: "converted", label: "Conv." },
          { key: "rate", label: "Rate" },
        ]}
      />
      <SegmentTable
        title="Conversion Rate by Referral"
        data={referralData}
        columns={[
          { key: "source", label: "Source" },
          { key: "conversations", label: "Convs." },
          { key: "converted", label: "Conv." },
          { key: "rate", label: "Rate" },
        ]}
      />
      <SegmentTable
        title="Top Performing Pages"
        data={pageData}
        columns={[
          { key: "page", label: "Landing Page" },
          { key: "conversations", label: "Convs." },
          { key: "ctaRate", label: "CTA Rate" },
        ]}
      />
    </div>
  );
}