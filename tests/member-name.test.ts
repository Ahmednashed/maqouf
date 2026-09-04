// merchDisplayName / merchInitial — Batch 3.
//
// The orphaned-member case is the point of this module: company_users.display_name
// (migration 011) exists so a member survives deletion of their auth account,
// at which point the `user:users(...)` join returns NULL. Before this was
// centralised, three screens each guessed differently — an empty string, the
// literal words "Inactive User" as a person's name, and an unguarded
// `merch.user.full_name` that threw.
//
// The distinction these pin: failing to READ a name is not the same as the
// member being inactive, and the fallback must never claim the latter.

import { eq } from "./_harness.ts";
import { merchDisplayName, merchInitial, type MemberNameSource } from "@/lib/utils/member-name";

const UNKNOWN = "Unknown";

// ── Precedence: admin override wins over the auth account ────────────────────
eq("display_name wins when both are present",
   merchDisplayName({ display_name: "Ahmed", user: { full_name: "Ahmed Nashed" } }, UNKNOWN),
   "Ahmed");
eq("falls back to the auth account name",
   merchDisplayName({ display_name: null, user: { full_name: "Ahmed Nashed" } }, UNKNOWN),
   "Ahmed Nashed");

// ── The orphaned member — the case this module exists for ────────────────────
eq("null join falls back to the cached display_name",
   merchDisplayName({ display_name: "Ahmed", user: null }, UNKNOWN),
   "Ahmed");
eq("no name anywhere yields the fallback, not a throw",
   merchDisplayName({ display_name: null, user: null }, UNKNOWN),
   UNKNOWN);
eq("a missing user key is treated like a null join",
   merchDisplayName({ display_name: "Ahmed" }, UNKNOWN),
   "Ahmed");
eq("an entirely absent member yields the fallback",
   merchDisplayName(undefined, UNKNOWN), UNKNOWN);
eq("a null member yields the fallback",
   merchDisplayName(null, UNKNOWN), UNKNOWN);

// ── Blank and whitespace names are not names ─────────────────────────────────
eq("empty display_name falls through to the auth name",
   merchDisplayName({ display_name: "", user: { full_name: "Ahmed Nashed" } }, UNKNOWN),
   "Ahmed Nashed");
eq("whitespace-only display_name falls through",
   merchDisplayName({ display_name: "   ", user: { full_name: "Ahmed Nashed" } }, UNKNOWN),
   "Ahmed Nashed");
eq("whitespace at both levels yields the fallback",
   merchDisplayName({ display_name: "  ", user: { full_name: " " } }, UNKNOWN),
   UNKNOWN);
eq("a name with surrounding spaces is trimmed",
   merchDisplayName({ display_name: "  Ahmed  ", user: null }, UNKNOWN),
   "Ahmed");

// ── Arabic names are not special-cased ───────────────────────────────────────
eq("Arabic display_name is returned as-is",
   merchDisplayName({ display_name: "أحمد", user: null }, "غير معروف"),
   "أحمد");
eq("Arabic fallback is used when nothing resolves",
   merchDisplayName({ display_name: null, user: null }, "غير معروف"),
   "غير معروف");

// ── The fallback is the caller's word, never a status ────────────────────────
// Regression guard: the calendar once rendered "Inactive User" here. Nothing in
// this module may invent a status.
{
  const out = merchDisplayName({ display_name: null, user: null }, UNKNOWN);
  eq("fallback is returned verbatim", out, UNKNOWN);
  eq("no status word is invented", /inactive/i.test(out), false);
}

// ── merchInitial ─────────────────────────────────────────────────────────────
eq("first letter, uppercased", merchInitial("ahmed", "en"), "A");
eq("already uppercase is unchanged", merchInitial("Ahmed", "en"), "A");
eq("leading space is ignored", merchInitial("  ahmed", "en"), "A");
eq("Arabic initial is the first letter", merchInitial("أحمد", "ar"), "أ");
eq("empty name gives the Arabic question mark in Arabic", merchInitial("", "ar"), "؟");
eq("empty name gives a plain question mark in English", merchInitial("", "en"), "?");
eq("whitespace-only name is treated as empty", merchInitial("   ", "en"), "?");
