/**
 * One way to turn a joined merchandiser record into a name to display.
 *
 * WHY THIS EXISTS
 * ───────────────
 * `company_users.display_name` was added in migration 011 precisely so a member
 * survives the deletion of their auth account: the join `user:users(...)` then
 * returns NULL and the cached name is all that is left. Reading
 * `user.full_name` alone therefore breaks in three different ways depending on
 * the screen, and each screen had invented its own:
 *
 *   • visits/[id] rendered an empty string, and an avatar initial of "?"
 *   • the calendar rendered the literal words "Inactive User" as a person's
 *     name — a status, not a name, and not even the right status
 *   • the dashboard timeline read `merch.user.full_name` with no optional
 *     chaining at all, against a type that wrongly promised `user` was always
 *     present, so a null join throws rather than degrading
 *
 * The AI tools already resolved this correctly. This is that same precedence —
 * admin override, then the auth account's name — in one place, so the UI agrees
 * with the assistant and with the Users screen.
 */

/** The minimum shape any joined merchandiser must provide. */
export interface MemberNameSource {
  display_name?: string | null;
  user?: { full_name?: string | null } | null;
}

/**
 * Resolve a member's display name.
 *
 * `fallback` should say the name is unknown — never that the member is
 * inactive. Whether someone still works here is a different question from
 * whether we can read their name, and answering the wrong one misleads.
 */
export function merchDisplayName(
  member: MemberNameSource | null | undefined,
  fallback: string,
): string {
  return (
    member?.display_name?.trim() ||
    member?.user?.full_name?.trim() ||
    fallback
  );
}

/** First character for an avatar bubble, or "؟"/"?" when the name is unknown. */
export function merchInitial(name: string, locale: string): string {
  const ch = name.trim()[0];
  if (!ch) return locale === "ar" ? "؟" : "?";
  return ch.toUpperCase();
}
