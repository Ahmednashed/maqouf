"use client";

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import type { TrendPoint } from "@/services/dashboard";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  data:   TrendPoint[];
  locale: string;
}

// ─── Custom tooltip ───────────────────────────────────────────────────────────

interface TooltipPayload {
  name:  string;
  value: number;
  color: string;
}

interface TooltipProps {
  active?:  boolean;
  payload?: TooltipPayload[];
  label?:   string;
}

function CustomTooltip({ active, payload, label }: TooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-ink-200 rounded-xl shadow-lg p-3 text-[12px] min-w-[120px]">
      <p className="font-bold text-ink-700 mb-2" dir="ltr">{label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: p.color }} />
            <span className="text-ink-600">{p.name}</span>
          </span>
          <span className="font-bold text-ink-800">{p.value}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────
//
// Always render in LTR — recharts does not support RTL internally.
// The surrounding page layout handles directionality.

const STATUS_BARS = [
  { key: "completed",  color: "#10b981", label: { ar: "مكتملة",      en: "Completed"   } },
  { key: "inprogress", color: "#3b82f6", label: { ar: "جارية",       en: "In Progress" } },
  { key: "pending",    color: "#f59e0b", label: { ar: "معلقة",       en: "Pending"     } },
  { key: "missed",     color: "#f43f5e", label: { ar: "فائتة",       en: "Missed"      } },
] as const;

export function VisitsTrendChart({ data, locale }: Props) {
  const isAr = locale === "ar";

  return (
    <div dir="ltr">   {/* recharts must be LTR */}
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -24 }} barCategoryGap="30%">
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 9.5, fill: "#94a3b8" }}
            tickFormatter={(v: string) => v.slice(5)}   // MM-DD
            interval={Math.max(0, Math.floor(data.length / 8) - 1)}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 9.5, fill: "#94a3b8" }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            iconType="square"
            iconSize={8}
            wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }}
            formatter={(value) => {
              const bar = STATUS_BARS.find((b) => b.key === value);
              return bar ? bar.label[isAr ? "ar" : "en"] : value;
            }}
          />
          {STATUS_BARS.map(({ key, color }) => (
            <Bar
              key={key}
              dataKey={key}
              name={key}
              fill={color}
              stackId="a"
              radius={key === "missed" ? [2, 2, 0, 0] : [0, 0, 0, 0]}
              maxBarSize={32}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
