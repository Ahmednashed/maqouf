import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll()  { return cookieStore.getAll(); },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {}
        },
      },
    }
  );
}

/**
 * Request-scoped client authenticated by a Supabase ACCESS TOKEN instead of
 * cookies — for native callers (Malgoof Mobile) sending
 * `Authorization: Bearer <token>`. Anon key only (never service-role);
 * every PostgREST/RPC call carries the caller's JWT, so `auth.uid()` and
 * RLS behave exactly as with the cookie client. There is no server-side
 * session: callers MUST validate the token with
 * `supabase.auth.getUser(token)` before trusting the request.
 */
export function createBearerClient(accessToken: string) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return []; },
        setAll() {},
      },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    }
  );
}
