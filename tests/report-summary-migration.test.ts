// Migration 026 — report_summary: static contract checks.
//
// There is no database in the test run, so none of this executes the SQL. It
// pins the text of the migration against the rules the function must keep:
// who can call it, whose rows it sees, which filters touch which counts, what
// it refuses to compute, and that its columns line up with the ReportSummary
// type the app already renders.
//
// What these checks CANNOT prove, and must be verified after the SQL is applied
// (separately authorised):
//   • that it parses and creates — no PostgreSQL here;
//   • the numbers — parity with fetchReportSummary on real data, signed in;
//   • RLS in practice — a merchandiser sees only their own visits' counts, and
//     only their own visits' product rows (visit_products_select's subquery is
//     itself evaluated under visits_select);
//   • the grants in practice — an anonymous REST call refused, a signed-in
//     (authenticated) call allowed and returning exactly one row;
//   • PostgREST passing p_status as the visit_status enum;
//   • that the planner actually uses idx_visits_company_date.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { check, eq, ok } from "./_harness.ts";

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "supabase", "migrations");
const FILE = "026_report_summary_rpc.sql";
const raw = readFileSync(join(MIGRATIONS, FILE), "utf8");

// `--` line comments removed, so prose in the header cannot satisfy or trip a
// check. No string literal in this file contains `--`.
const sql = raw.split(/\r?\n/).map((l) => l.replace(/--.*$/, "")).join("\n");
const squash = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

const bodyStart = sql.indexOf("as $$");
const bodyEnd = sql.indexOf("$$;", bodyStart);
const body = squash(sql.slice(bodyStart + 5, bodyEnd));
const head = squash(sql.slice(0, bodyStart));
const tail = squash(sql.slice(bodyEnd));

const IDENTITY = "public.report_summary(date, date, uuid, uuid, public.visit_status)";

console.log("1) the migration sits where the runner expects it");
{
  const files = readdirSync(MIGRATIONS).filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort();
  const numbers = files.map((f) => Number(f.slice(0, 3)));
  eq("exactly one 026 migration", files.filter((f) => f.startsWith("026_")), [FILE]);
  check("025 exists", files.includes("025_company_attention_rpc.sql"), files.filter((f) => f.startsWith("025_")));
  // Later migrations are expected; only the sequence up to 026 is pinned.
  eq("001 through 026 all present, once each, with no gap",
     numbers.filter((n) => n <= 26), Array.from({ length: 26 }, (_, i) => i + 1));
  eq("no migration number is used twice", numbers.filter((n, i) => numbers.indexOf(n) !== i), []);
  eq("exactly one function defined", (squash(sql).match(/create or replace function/g) ?? []).length, 1);
}

console.log("2) signature and return shape");
{
  check("signature: range required, three optional filters, status as the enum",
    head.includes(
      "create or replace function public.report_summary( p_from date, p_to date, " +
      "p_merch_id uuid default null, p_place_id uuid default null, " +
      "p_status public.visit_status default null )"),
    head.slice(0, 260));

  const ret = head.slice(head.indexOf("returns table ("), head.indexOf(") language sql"));
  const cols = [...ret.matchAll(/(\w+) (int|bigint)\b/g)].map((m) => `${m[1]} ${m[2]}`);
  eq("twelve columns, in this order, with these types", cols, [
    "total_visits int", "completed int", "missed int", "pending int", "inprogress int",
    "active_merchandisers int", "covered_branches int", "scheduled_branches int",
    "duration_sum bigint", "duration_count int",
    "audited_products int", "products_with_shortfall int",
  ]);
}

console.log("3) runs as the caller, pinned search path, read-only");
{
  check("SECURITY INVOKER", head.includes("security invoker"));
  check("never SECURITY DEFINER", !squash(sql).includes("security definer"));
  check("language sql", head.includes("language sql"));
  check("stable", head.includes(" stable "));
  check("search path pinned to public", head.includes("set search_path = public"));
  for (const w of ["insert ", "update ", "delete ", "truncate ", "alter ", "drop "]) {
    check(`body never contains ${w.trim()}`, !body.includes(w), w);
  }
}

console.log("4) no clock, no timezone: the app supplies the dates");
{
  for (const w of ["current_date", "current_timestamp", "localtimestamp", "localtime",
                   "now(", "clock_timestamp", "statement_timestamp", "transaction_timestamp",
                   "at time zone", "timezone("]) {
    check(`body does not use ${w}`, !body.includes(w), w);
  }
  check("no BETWEEN SYMMETRIC (a reversed range must match nothing)", !body.includes("symmetric"));
}

console.log("5) no rates, no averages, no rounding in SQL");
{
  for (const w of ["round(", "avg(", "trunc(", "ceil(", "floor(", "completion_rate", "avg_duration", "/"]) {
    check(`body does not contain ${w}`, !body.includes(w), w);
  }
}

// The two CTEs, cut apart so each filter can be checked where it belongs.
const visitCte = body.slice(body.indexOf("with visit as ("), body.indexOf("product as ("));
const productCte = body.slice(body.indexOf("product as ("), body.indexOf(") select vs."));

console.log("6) the visit counts: range, merchandiser, branch and status");
{
  check("inclusive lower bound", visitCte.includes("v.scheduled_date >= p_from"));
  check("inclusive upper bound", visitCte.includes("v.scheduled_date <= p_to"));
  check("optional merchandiser", visitCte.includes("(p_merch_id is null or v.merch_id = p_merch_id)"));
  check("optional branch", visitCte.includes("(p_place_id is null or v.place_id = p_place_id)"));
  check("optional status", visitCte.includes("(p_status is null or v.status = p_status)"));
  check("reads visits only", visitCte.includes("from public.visits v") && !visitCte.includes("visit_products"));
}

console.log("7) the product figures: joined to visits for range, completed status and filters; no status filter");
{
  check("joined to public.visits (range, completed status and filters live there)",
    productCte.includes("from public.visit_products vp join public.visits v on v.id = vp.visit_id"));
  eq("visit_products appears exactly once in the whole body", (body.match(/visit_products/g) ?? []).length, 1);
  check("completed visits only", productCte.includes("v.status = 'completed'"));
  check("inclusive lower bound", productCte.includes("v.scheduled_date >= p_from"));
  check("inclusive upper bound", productCte.includes("v.scheduled_date <= p_to"));
  check("optional merchandiser", productCte.includes("(p_merch_id is null or v.merch_id = p_merch_id)"));
  check("optional branch", productCte.includes("(p_place_id is null or v.place_id = p_place_id)"));
  check("the status filter does NOT reach the product figures", !productCte.includes("p_status"));
}

console.log("8) NULL versus zero, and missing values");
{
  eq("both product figures are NULL when there are no audit rows",
    (body.match(/case when count\(\*\) = 0 then null/g) ?? []).length, 2);
  check("a missing qty_missing counts as not short", body.includes("coalesce(qty_missing, 0) > 0"));
  eq("durations: completed visits with a positive duration, for both sum and count",
    (body.match(/where status = 'completed' and duration_minutes > 0/g) ?? []).length, 2);
  check("an empty duration sum is 0, not NULL", body.includes("coalesce(sum(duration_minutes) filter ("));
  check("covered branches count completed visits only",
    body.includes("count(distinct place_id) filter (where status = 'completed')"));
  check("scheduled branches count every visit", body.includes("count(distinct place_id)::int as scheduled_branches"));
  check("active merchandisers count every visit", body.includes("count(distinct merch_id)::int as active_merchandisers"));
  check("one row even when empty: two ungrouped aggregates, cross-joined",
    body.includes(") vs cross join (") && !body.includes("group by"));
}

console.log("9) status values exist in the enum");
{
  const enumLine = readFileSync(join(MIGRATIONS, "001_initial_schema.sql"), "utf8")
    .match(/CREATE TYPE visit_status\s+AS ENUM \(([^)]*)\)/);
  const values = enumLine ? [...enumLine[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : [];
  eq("the enum is the four statuses", values, ["pending", "inprogress", "completed", "missed"]);
  const used = Array.from(new Set(Array.from(body.matchAll(/status = '([^']+)'/g), (m) => m[1]))).sort();
  eq("every status literal in the body is an enum value", used.filter((s) => !values.includes(s)), []);
  eq("and all four are counted", used, ["completed", "inprogress", "missed", "pending"]);
}

console.log("10) grants: authenticated only; anonymous calls refused");
{
  check("revoked from PUBLIC", tail.includes(`revoke execute on function ${IDENTITY} from public;`));
  check("revoked from anon", tail.includes(`revoke execute on function ${IDENTITY} from anon;`));
  check("granted to authenticated", tail.includes(`grant execute on function ${IDENTITY} to authenticated;`));
  check("never granted to anon", !/grant[^;]*to anon/.test(tail));
  check("never granted to PUBLIC", !/grant[^;]*to public/.test(tail));
  check("described", tail.includes(`comment on function ${IDENTITY} is`));
  check("PostgREST reloads its schema", tail.includes("notify pgrst, 'reload schema';"));
}

console.log("10b) the header states the security model accurately");
{
  const doc = raw.toLowerCase();
  check("does not claim visit_products_select lacks the merchandiser restriction",
    !doc.includes("does not carry the") && !doc.includes("company-scoped only"));
  check("explains that the policy's subquery runs under visits_select",
    doc.includes("subquery is itself evaluated under visits_select"));
  check("explains why the join is still needed",
    doc.includes("it is needed for the semantics"));
  check("documents the anonymous refusal", doc.includes("expected to be refused"));
  check("documents signed-in verification", doc.includes("results are verified signed"));
}

console.log("11) no index added");
{
  check("no CREATE INDEX", !squash(sql).includes("create index"));
  check("no CREATE UNIQUE INDEX", !squash(sql).includes("create unique index"));
}

console.log("12) the columns line up with ReportSummary");
{
  const src = readFileSync(join(ROOT, "src", "services", "reports.ts"), "utf8");
  const iface = src.slice(src.indexOf("export interface ReportSummary {"));
  const block = iface.slice(0, iface.indexOf("\n}"));
  const fields = [...block.matchAll(/^\s+(\w+):/gm)].map((m) => m[1]);

  const APP_COMPUTED = ["completion_rate", "avg_duration"];
  const SQL_ONLY = ["duration_sum", "duration_count"];
  const sqlCols = [
    "total_visits", "completed", "missed", "pending", "inprogress",
    "active_merchandisers", "covered_branches", "scheduled_branches",
    "duration_sum", "duration_count", "audited_products", "products_with_shortfall",
  ];

  check("ReportSummary still has the two fields the app will compute",
    APP_COMPUTED.every((f) => fields.includes(f)), fields);
  eq("every other ReportSummary field comes straight from a column",
    fields.filter((f) => !APP_COMPUTED.includes(f) && !sqlCols.includes(f)), []);
  eq("every column feeds ReportSummary, directly or through the app's arithmetic",
    sqlCols.filter((c) => !SQL_ONLY.includes(c) && !fields.includes(c)), []);
  ok("nothing in the app calls the function yet",
    !src.includes("report_summary"), "fetchReportSummary must stay on table reads until the integration batch");
}
