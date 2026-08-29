# Production readiness — end of Phase 2 Batch 13

State of the deployed app, what is known to be imperfect, and the checklist each
future batch should run before calling itself verified.

**Deployed:** `main` @ `72bf61d40314e3957cfdd983340e6f3039f2a296`
**Environment:** https://malgofappv1.vercel.app (Vercel, region `fra1`)
**Captured:** Batch 14. Documentation only — no application code changed.

---

## 1. What Batches 1–13 did

Each batch was merged fast-forward only and verified in production before the
next began.

| # | Area | The substantive change |
|---|---|---|
| 1 | Branch register | Last-visit and assortment columns on `/places`; one shared rule for "last visit" (`completed`/`inprogress` only, never `missed`) |
| 2 | Reports | Merchandiser / branch / status / **last-visit** filters, composing; branch coverage seeded from all active branches so uncovered ones appear |
| 3 | Visit identity | One name-resolution rule (`merchDisplayName`) across every screen, replacing per-screen guesses |
| 4 | Templates | Draft and published-but-empty templates shown as **disabled options with a reason**; Arabic plural field counts via `Intl.PluralRules` |
| 5 | Assortment | Product coverage column; orphan-product detection |
| 6 | Dashboard | **Removed fabricated content** — an AI card asserting invented findings, and a hardcoded always-rising sparkline on every KPI. Replaced with data-derived attention items |
| 7 | Users | Visits-today and assigned-branch columns; unified presence with the dashboard; 9 columns → 8 while adding two |
| 8 | Visit detail | Plan vs record — what a visit was *meant* to cover, not only what it recorded |
| 9 | Location | **Stopped reporting missing GPS as a failed check**; removed the fake map tile |
| 10 | Scheduling | Branch context when creating a visit; recurrence preview from the real generator |
| 11 | Completion | Readiness summary; acknowledgement gate before completing with gaps unrecorded |
| 12 | Save safety | Unsaved edits block completion online, warn offline; draft no longer cleared when dirty |
| 13 | Template execution | Per-field answered state; **fixed a Batch 12 false-dirty bug** that permanently blocked completion |

Two batches (6 and 9) removed things that were actively misleading. Batch 13
fixed a defect introduced by Batch 12 — found only because Batch 13 finally had
a template to type into.

---

## 2. Known warnings — unchanged and expected

`npm run build` exits **0** with **5 warnings**, all the same rule:

```
@next/next/no-img-element  — Using `<img>` could result in slower LCP …
```

| File | Line |
|---|---|
| `dashboard/_components/FieldTeamTable.tsx` | 77 |
| `users/page.tsx` | 250 |
| `users/_components/UserModal.tsx` | 338 |
| `components/layout/Topbar.tsx` | 61, 90 |

All five are **avatar images**. They predate Phase 2 and the count has not moved
across thirteen batches — which is itself the check: if a build reports anything
other than *5 warnings, 0 errors*, something new was introduced.

Switching to `next/image` would mean configuring the Supabase storage host as a
remote pattern and accepting per-image optimisation cost. That is a deliberate
decision, not an oversight, and it is not urgent for small avatars.

---

## 3. Dictionary invariant

Arabic and English must stay in lockstep: **1114 keys each, 0 duplicates, 0
gaps** after Batch 14 removed two dead keys (was 1116 at `72bf61d`). Every batch that touches `translations.ts` should
re-audit. A duplicate key is a TypeScript error (`TS1117`); a *gap* is silent,
which is why it is checked explicitly.

---

## 4. TEST data currently live

Three TEST visits, one modified TEST template field, and a set of TEST
reference rows are live in production. They are correct data producing correct
readings — not bugs — and every effect reverts on cleanup.

Full inventory, dependency order and revert instructions:
**[`TEST-DATA-REGISTRY.md`](./TEST-DATA-REGISTRY.md)**.

Expect these figures while it exists: dashboard timeline **3**, attention **4
items** (not 5), `/users` Ahmed **3 مفتوحة**, `/reports` **9 visits / GPS
started 6**, `/places` خريص last visit **اليوم**.

---

## 5. Verified only by unit test

Honest gaps. Each is covered by tests but has never been seen in a browser,
because production data cannot currently produce the state.

| What | Why unreachable |
|---|---|
| GPS **`verified`** and **`outside`** states | Would require a real device position inside a 200 m radius, or faking one. `startVisit` throws on out-of-radius, so `outside` is unreachable by design |
| **`false` / `0`** as template answers | No yes/no or numeric field exists on any template |
| Pending-invitations list | Needs an invitable address — see [`PENDING-VERIFICATION.md`](./PENDING-VERIFICATION.md) |
| Published-but-empty template row | The publish guard prevents the state existing; only ever observed by correct absence |

Faking any of these would produce exactly the kind of fabricated evidence
Batches 6 and 9 existed to remove. They stay unverified until real data can
produce them.

---

## 6. Known rough edges — not yet fixed

| Thing | Detail |
|---|---|
| Products list is briefly empty after starting a visit | `initVisitProducts()` writes the rows but the `visit-products` query key is not invalidated; resolves on reload. **Pre-existing** |
| Completing still does not save the audit | `handleSave` is separate. Batch 12 made this safe (unsaved work blocks completion) rather than changing the rule. Auto-save was rejected because `handleSave` silently no-ops offline |
| Offline completion can still lose work | Blocking would strand a field user, so it warns and requires acknowledgement. The draft survives, but nothing re-syncs it later |
| Photo fields excluded from drafts | A photo-only edit may not register as dirty. Not exercised — no template has photo fields |
| Two "answered" counts on one screen | The template header is **live**; the plan panel and completion dialog are **saved-based**. Intended, but they differ while edits are unsaved |
| 12 modals not on the shared `Modal` | Including `CompleteModal`. Cosmetic inconsistency |
| `STALE_AFTER_DAYS = 14` duplicated in spirit | `lib/attention.ts` and the reports `gt14` bucket carry the same number in two files |

Performance risks are separate and larger:
**[`PERFORMANCE-RISKS.md`](./PERFORMANCE-RISKS.md)**.

---

## 7. Deployment verification checklist

What every batch has actually run. Reproducible rather than aspirational.

### Before merge
1. `npm run type-check` → exit 0
2. `npm run build` → exit 0, **0 errors, 5 warnings** (§2)
3. Dictionary audit → equal counts, 0 dupes, 0 gaps (§3)
4. Unit tests for any new pure logic, compiled against the **byte-identical**
   source file (`diff -q` the copy before trusting the result)
5. Browser sweep on localhost while logged in
6. Console clean, including **one hard reload** — hydration errors only fire on
   initial SSR hydration, so client-side navigation hides them

### Merge
7. `git merge --ff-only`, after asserting `git merge-base --is-ancestor`
8. Re-run type-check and build **on the merged commit**, not just the branch
9. Working tree clean; report the final `main` SHA

### After push
10. Capture the served **dictionary chunk hash** *before* pushing, then poll for
    it to change. Do **not** poll the webpack runtime chunk — it does not always
    change between deploys, and it produced a false "not deployed" reading once
11. Confirm the deployed commit by **content fingerprinting**: strings added by
    the commit are present *and* strings it removed are absent. Prefer strings
    unique to the tip commit so it discriminates from the one before it
12. Re-run the browser sweep against production while logged in
13. Report exactly what production data was touched, and restore anything
    temporary

### Traps worth remembering
- **Scope DOM queries to the dialog.** The page behind a modal often contains a
  button with the same label; a page-wide `find` will grab the wrong one and
  report a gate as broken when it is not. This caused two false alarms.
- **A blank page may be skeletons.** `innerText` is empty while loading. Wait
  and re-check before concluding anything.
- **Verify by discrimination, not absence.** A count of zero proves nothing if
  every case reads zero. Change the data — or say plainly that the state could
  not be produced.
