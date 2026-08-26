import type { TranslationKey } from "@/lib/i18n/translations";

/**
 * Supabase Auth and the invite Edge Function answer in English, and once the
 * service started reading the real response body (rather than the generic
 * "non-2xx" string) that English began reaching an Arabic-speaking admin
 * verbatim — "email rate limit exceeded" in the middle of an RTL screen.
 *
 * Map the failures we actually see onto real copy. Anything unrecognised
 * returns null and the caller falls back to the raw message: showing an
 * untranslated reason is worse than showing a translated one, but far better
 * than swallowing a reason we simply have not learned to phrase yet.
 */
export function inviteErrorKey(message: string): TranslationKey | null {
  const m = message.toLowerCase();

  // Supabase throttles invite emails per project.
  if (m.includes("rate limit")) return "users.errorInviteRateLimit";

  // The Edge Function's own already_member answer, should it ever arrive as
  // an error rather than a 200 result.
  if (m.includes("already a member") || m.includes("already_member")) {
    return "users.alreadyMember";
  }

  // GoTrue rejects reserved and malformed domains, e.g.
  //   Email address "someone@example.com" is invalid
  if (m.includes("unable to validate email")) return "users.errorInviteInvalidEmail";
  if (m.includes("email") && m.includes("invalid")) return "users.errorInviteInvalidEmail";

  if (
    m.includes("not allowed") ||
    m.includes("forbidden")   ||
    m.includes("permission")  ||
    m.includes("unauthorized")
  ) {
    return "users.errorInvitePermission";
  }

  return null;
}
