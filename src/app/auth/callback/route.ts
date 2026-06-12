import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // Validate next is a relative path to prevent open-redirect
      const redirectPath = next.startsWith("/") ? next : "/dashboard";
      return NextResponse.redirect(`${origin}${redirectPath}`);
    }

    // Expired or already-used link
    return NextResponse.redirect(`${origin}/reset-password?error=link_expired`);
  }

  // No code — nothing to exchange
  return NextResponse.redirect(`${origin}/login`);
}
