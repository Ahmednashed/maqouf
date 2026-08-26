# Pending runtime verification

Things that are implemented and pass type-check, build and code review, but
have **not** been exercised end-to-end against the live system. Delete an entry
once it has been verified, and say what you saw.

---

## Pending invitations list (`users.pendingTitle` section)

**Status:** code complete, never seen working with real data.
**Blocked on:** an invitable email address.

### What exists

- `fetchPendingInvitations()` — `src/services/invitations.ts`
  Reads `company_user_invitations` where `accepted_at IS NULL`, deduplicated by
  lowercased email, most recent row per address.
- `usePendingInvitations()` — `src/hooks/use-users.ts`
  Invalidated in the invite mutation's `onSettled`.
- The amber "pending invitations" section with the Resend button —
  `src/app/(dashboard)/users/page.tsx`.

### Why it is unverified

The section only renders when at least one *unaccepted* invitation row exists,
and no such row has ever been created:

| Address tried | Result | Row created? |
|---|---|---|
| `test-invite@example.com` | HTTP 500 — `Email address "test-invite@example.com" is invalid` | no |
| `ah2491991@gmail.com` (existing member) | HTTP 200 — `already_member`, no change made | no |

Supabase Auth rejects `example.com` outright (RFC 2606 reserved domain), so the
Edge Function fails before writing anything. Inviting someone who is already a
member deliberately writes nothing.

Repeated attempts also tripped Supabase's per-project invite throttle
(`email rate limit exceeded`), so allow it to cool down before retrying.

### How to finish it

Needs an address that Supabase will accept **and** that reaches only the
account owner — a Gmail plus-address such as `owner+invitetest@gmail.com`
works. **Ask the owner for the address; do not invent one.** Sending an
invitation emails a real person.

Then confirm:

1. The invite returns `invited` (not `added`, not `already_member`).
2. The address appears under **pending invitations**, in the amber section —
   *not* in the Active members table. This is the bug the section was built
   to fix.
3. **Resend** re-sends and does not duplicate the row (the Edge Function
   inserts a new row per invite; `fetchPendingInvitations` dedupes by email).
4. Accepting the invitation moves the person out of the pending section and
   into the members table.

### Known gap

There is no way to revoke a pending invitation from the UI: no DELETE policy
exists on `company_user_invitations`, so a client-side delete would fail under
RLS. Revoking needs a migration or an Edge Function, and neither has been
written. Do not add a Revoke button until one is.
