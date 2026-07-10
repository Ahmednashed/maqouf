import { z } from "zod";
import type { AiLocale } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Executive answer contract (Phase 4). For analytical questions the final
// turn produces this structured object (strict schema + Zod validation),
// which is then rendered to clean natural text — guaranteeing no malformed
// markdown and a consistent facts → causes → impact → actions shape.
// ─────────────────────────────────────────────────────────────────────────────

const severityEnum   = z.enum(["critical", "warning", "info", "positive"]);
const confidenceEnum = z.enum(["high", "medium", "low"]);

export const executiveAnswerSchema = z.object({
  directAnswer: z.string().min(1).max(400),
  keyFindings: z.array(z.object({
    finding:  z.string().max(200),
    evidence: z.string().max(200),
    severity: severityEnum,
  })).max(6),
  likelyCauses: z.array(z.object({
    cause:      z.string().max(200),
    confidence: confidenceEnum,
    evidence:   z.string().max(200),
  })).max(4),
  operationalImpact: z.string().max(300),
  recommendations: z.array(z.object({
    priority: z.number().int().min(1).max(9),
    action:   z.string().max(160),
    reason:   z.string().max(160),
  })).max(5),
  caveats:   z.array(z.string().max(160)).max(4),
  sourceIds: z.array(z.string().max(64)).max(8),
});

export type ExecutiveAnswer = z.infer<typeof executiveAnswerSchema>;

/** JSON-schema mirror for OpenAI strict structured outputs. */
export const EXECUTIVE_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    directAnswer: { type: "string" },
    keyFindings: {
      type: "array", maxItems: 6,
      items: {
        type: "object",
        properties: {
          finding:  { type: "string" },
          evidence: { type: "string" },
          severity: { type: "string", enum: ["critical", "warning", "info", "positive"] },
        },
        required: ["finding", "evidence", "severity"],
        additionalProperties: false,
      },
    },
    likelyCauses: {
      type: "array", maxItems: 4,
      items: {
        type: "object",
        properties: {
          cause:      { type: "string" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          evidence:   { type: "string" },
        },
        required: ["cause", "confidence", "evidence"],
        additionalProperties: false,
      },
    },
    operationalImpact: { type: "string" },
    recommendations: {
      type: "array", maxItems: 5,
      items: {
        type: "object",
        properties: {
          priority: { type: "integer" },
          action:   { type: "string" },
          reason:   { type: "string" },
        },
        required: ["priority", "action", "reason"],
        additionalProperties: false,
      },
    },
    caveats:   { type: "array", items: { type: "string" }, maxItems: 4 },
    sourceIds: { type: "array", items: { type: "string" }, maxItems: 8 },
  },
  required: [
    "directAnswer", "keyFindings", "likelyCauses",
    "operationalImpact", "recommendations", "caveats", "sourceIds",
  ],
  additionalProperties: false,
};

// ─── Rendering (pure, testable — clean text, no markdown artifacts) ───────────

const SEVERITY_MARK: Record<string, string> = {
  critical: "🔴", warning: "🟠", info: "ℹ️", positive: "✅",
};

const L = (locale: AiLocale, ar: string, en: string) => (locale === "ar" ? ar : en);

/** Hedge causal wording for non-high confidence. */
function causeLine(c: ExecutiveAnswer["likelyCauses"][number], locale: AiLocale): string {
  const hedge = c.confidence === "high"
    ? ""
    : L(locale, " (قد تكون مرتبطة — غير مؤكد)", " (may be related — not confirmed)");
  return `- ${c.cause}${hedge} — ${c.evidence}`;
}

export function renderExecutiveAnswer(
  a:      ExecutiveAnswer,
  locale: AiLocale
): string {
  const parts: string[] = [a.directAnswer.trim()];

  if (a.keyFindings.length > 0) {
    parts.push(
      "",
      L(locale, "أهم النتائج المدعومة بالبيانات:", "Key data-backed findings:"),
      ...a.keyFindings.map((f, i) =>
        `${i + 1}. ${SEVERITY_MARK[f.severity] ?? ""} ${f.finding} — ${f.evidence}`.trim()
      ),
    );
  }

  if (a.likelyCauses.length > 0) {
    parts.push(
      "",
      L(locale, "الأسباب المحتملة:", "Likely causes:"),
      ...a.likelyCauses.map((c) => causeLine(c, locale)),
    );
  }

  if (a.operationalImpact.trim()) {
    parts.push("", L(locale, "الأثر التشغيلي:", "Operational impact:"), a.operationalImpact.trim());
  }

  if (a.recommendations.length > 0) {
    const sorted = [...a.recommendations].sort((x, y) => x.priority - y.priority);
    parts.push(
      "",
      L(locale, "الأولويات المقترحة:", "Recommended priorities:"),
      ...sorted.map((r, i) => `${i + 1}. ${r.action} — ${r.reason}`),
    );
  }

  if (a.caveats.length > 0) {
    parts.push(
      "",
      L(locale, "ملاحظات:", "Caveats:"),
      ...a.caveats.map((c) => `- ${c}`),
    );
  }

  return parts.join("\n");
}
