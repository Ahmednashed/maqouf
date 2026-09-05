"use client";

import {
  Package, FileText, CheckCircle2, CircleDashed, AlertTriangle, Info,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { TranslationFn } from "@/hooks/use-translation";
import type { TranslationKey } from "@/lib/i18n/translations";
import { pluralKey } from "@/lib/i18n/plural";
import type {
  VisitProductPlan,
  VisitFieldPlan,
  PlannedProduct,
  PlannedField,
} from "@/lib/visit-plan";

// ─────────────────────────────────────────────────────────────────────────────
// The plan side of a visit: what it was meant to cover, and what is still
// outstanding. Read-only by design — every editing control already lives in
// the audit sections below it, and duplicating them here would give the same
// value two owners.
// ─────────────────────────────────────────────────────────────────────────────

const sub = (key: string, vals: Record<string, string | number>) =>
  Object.entries(vals).reduce<string>(
    (acc, [k, v]) => acc.replace(`{${k}}`, String(v)),
    key,
  );

function Stat({
  label, tone = "neutral",
}: { label: string; tone?: "neutral" | "good" | "warn" | "bad" }) {
  const tones = {
    neutral: "bg-ink-100 text-ink-600",
    good:    "bg-emerald-50 text-emerald-700 border border-emerald-200",
    warn:    "bg-amber-50 text-amber-700 border border-amber-200",
    bad:     "bg-rose-50 text-rose-700 border border-rose-200",
  } as const;
  return (
    <span className={cn("inline-flex items-center px-2.5 py-1 rounded-full text-[11.5px] font-semibold", tones[tone])}>
      {label}
    </span>
  );
}

// ─── Product row ──────────────────────────────────────────────────────────────

function ProductLine({
  p, locale, t,
}: { p: PlannedProduct; locale: string; t: TranslationFn }) {
  const name = (locale === "ar" ? p.name_ar : p.name_en) || p.sku || p.product_id;
  const checked = p.state === "checked";

  return (
    <li className="flex items-start gap-2.5 py-2 border-b border-ink-100 last:border-0">
      {checked ? (
        <CheckCircle2 className={cn("w-4 h-4 mt-0.5 shrink-0", p.below_min ? "text-amber-500" : "text-emerald-500")} />
      ) : (
        <CircleDashed className="w-4 h-4 mt-0.5 shrink-0 text-ink-300" />
      )}

      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-ink-800 leading-tight">
          {name}
          {p.sku && <span className="ms-1.5 text-[11px] font-mono text-ink-400">{p.sku}</span>}
        </p>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1">
          {p.is_mandatory && (
            <span className="text-[10.5px] font-semibold text-violet-700 bg-violet-50 border border-violet-200 rounded-full px-1.5 py-0.5">
              {t("visits.plan.required")}
            </span>
          )}
          {p.min_stock > 0 && (
            <span className="text-[11px] text-ink-400">
              {sub(t("visits.plan.minStock"), { n: p.min_stock })}
            </span>
          )}
          {p.state === "unexpected" && (
            <span className="text-[10.5px] font-semibold text-ink-500 bg-ink-100 rounded-full px-1.5 py-0.5">
              {t("visits.plan.unexpected")}
            </span>
          )}
        </div>
      </div>

      <div className="text-end shrink-0">
        {checked ? (
          <>
            <p className={cn("text-[13px] font-bold", p.below_min ? "text-amber-600" : "text-ink-800")}>
              {p.qty_found}
            </p>
            {p.below_min && (
              <p className="text-[10.5px] text-amber-600 font-medium">{t("visits.plan.belowMin")}</p>
            )}
          </>
        ) : (
          <p className="text-[11.5px] text-ink-300">{t("visits.plan.notCheckedYet")}</p>
        )}
      </div>
    </li>
  );
}

// ─── Field row ────────────────────────────────────────────────────────────────

function FieldLine({
  f, locale, t,
}: { f: PlannedField; locale: string; t: TranslationFn }) {
  const label = (locale === "ar" ? f.label_ar : f.label_en) || f.id;

  // A section is a heading in the form, so it renders as one here too rather
  // than as a question that is permanently unanswered.
  if (f.type === "section") {
    return (
      <li className="pt-3 pb-1 first:pt-0">
        <p className="text-[11.5px] font-bold text-ink-500 uppercase tracking-wide">{label}</p>
      </li>
    );
  }

  return (
    <li className="flex items-center gap-2.5 py-2 border-b border-ink-100 last:border-0">
      {f.answered
        ? <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-500" />
        : <CircleDashed className="w-4 h-4 shrink-0 text-ink-300" />}
      <p className="text-[13px] text-ink-800 flex-1 min-w-0 leading-tight">
        {label}
        {f.required && (
          <span className="ms-1.5 text-[10.5px] font-semibold text-violet-700 bg-violet-50 border border-violet-200 rounded-full px-1.5 py-0.5">
            {t("visits.plan.required")}
          </span>
        )}
      </p>
      {!f.answered && (
        <span className="text-[11.5px] text-ink-300 shrink-0">{t("visits.plan.notAnsweredYet")}</span>
      )}
    </li>
  );
}

// ─── Panel ────────────────────────────────────────────────────────────────────

export interface VisitPlanPanelProps {
  productPlan:  VisitProductPlan;
  fieldPlan:    VisitFieldPlan | null;
  templateName: string;
  /** true before the visit starts — the whole panel is then the page's content. */
  planned:      boolean;
  /** Hide the per-product list when the editable audit list already shows it. */
  compact:      boolean;
  loading:      boolean;
  locale:       string;
  t:            TranslationFn;
}

export function VisitPlanPanel({
  productPlan, fieldPlan, templateName, planned, compact, loading, locale, t,
}: VisitPlanPanelProps) {
  if (loading) {
    return <div className="h-40 rounded-2xl bg-ink-100 animate-pulse mb-6" />;
  }

  const { expectedCount, checkedCount, mandatoryCount, mandatoryCheckedCount, belowMinCount } = productPlan;

  // In compact mode the audit list below renders exactly the products that have
  // a visit_products row, so listing those again here would print the whole
  // assortment twice. Only products with no row at all are invisible to it —
  // added to the branch after the visit was seeded — and only those are
  // repeated. The counts above still cover everything.
  const invisibleBelow = productPlan.products.filter((p) => !p.has_record);
  const listed         = compact ? invisibleBelow : productPlan.products;
  const allChecked     = expectedCount > 0 && checkedCount === expectedCount;

  return (
    <section className="rounded-2xl border border-ink-100 bg-white shadow-sm mb-6 overflow-hidden">
      <header className="px-5 py-3.5 border-b border-ink-100 bg-ink-50/50">
        <h2 className="text-[13px] font-bold text-ink-700 flex items-center gap-2">
          <Info className="w-4 h-4 text-brand-500" />
          {t("visits.plan.title")}
        </h2>
        {planned && (
          <p className="text-[12px] text-ink-400 mt-0.5">{t("visits.plan.plannedHint")}</p>
        )}
      </header>

      <div className="p-5 space-y-5">
        {/* ── Form ─────────────────────────────────────────────────────────── */}
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <h3 className="text-[12.5px] font-bold text-ink-600 flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-ink-400" />
              {t("visits.plan.templateTitle")}
            </h3>
            {templateName && <span className="text-[12px] text-ink-500">{templateName}</span>}
            {fieldPlan && fieldPlan.answerableCount > 0 && (
              <>
                <Stat
                  label={sub(t("visits.plan.answered"), {
                    done: fieldPlan.answeredCount, total: fieldPlan.answerableCount,
                  })}
                  tone={fieldPlan.answeredCount === fieldPlan.answerableCount ? "good" : "neutral"}
                />
                {fieldPlan.requiredCount > 0 && (
                  fieldPlan.missingRequired.length > 0
                    ? <Stat
                        tone="warn"
                        label={sub(
                          t(pluralKey(
                            "visits.plan.missingRequired",
                            fieldPlan.missingRequired.length,
                            locale,
                          ) as TranslationKey),
                          { n: fieldPlan.missingRequired.length },
                        )}
                      />
                    : <Stat tone="good" label={t("visits.plan.allRequiredDone")} />
                )}
              </>
            )}
          </div>

          {!fieldPlan || fieldPlan.fields.length === 0 ? (
            <p className="text-[12.5px] text-ink-400">{t("visits.plan.noTemplate")}</p>
          ) : (
            <ul className="mt-1">
              {fieldPlan.fields.map((f) => (
                <FieldLine key={f.id} f={f} locale={locale} t={t} />
              ))}
            </ul>
          )}
        </div>

        {/* ── Products ─────────────────────────────────────────────────────── */}
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <h3 className="text-[12.5px] font-bold text-ink-600 flex items-center gap-1.5">
              <Package className="w-3.5 h-3.5 text-ink-400" />
              {t("visits.plan.productsTitle")}
            </h3>
            {expectedCount > 0 && (
              <>
                <Stat
                  label={sub(t("visits.plan.checkedOf"), { done: checkedCount, total: expectedCount })}
                  tone={checkedCount === expectedCount ? "good" : "neutral"}
                />
                {mandatoryCount > 0 && (
                  <Stat
                    label={sub(t("visits.plan.mandatoryOf"), { done: mandatoryCheckedCount, total: mandatoryCount })}
                    tone={mandatoryCheckedCount === mandatoryCount ? "good" : "warn"}
                  />
                )}
                {belowMinCount > 0 && (
                  <Stat tone="bad" label={sub(t("visits.plan.belowMinCount"), { n: belowMinCount })} />
                )}
              </>
            )}
          </div>

          {productPlan.products.length === 0 ? (
            <p className="text-[12.5px] text-ink-400">{t("visits.plan.noAssortment")}</p>
          ) : listed.length > 0 ? (
            <>
              {compact && (
                <p className="text-[11.5px] text-ink-400 mb-1 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                  {t("visits.plan.expectedNotChecked")}
                </p>
              )}
              <ul>
                {listed.map((p) => (
                  <ProductLine key={p.product_id} p={p} locale={locale} t={t} />
                ))}
              </ul>
            </>
          ) : allChecked ? (
            <p className="text-[12.5px] text-emerald-600 font-medium flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" />
              {t("visits.plan.nothingPending")}
            </p>
          ) : null
          /* Nothing rendered here when products remain unchecked but the audit
             list below already shows them — the counts above carry that. Saying
             "nothing outstanding" would be false. */}
        </div>
      </div>
    </section>
  );
}
