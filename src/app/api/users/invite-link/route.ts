import { NextResponse, type NextRequest } from "next/server";
import { createClient }                  from "@/lib/supabase/server";
import { createClient as createAdmin }   from "@supabase/supabase-js";

// ─── Types ────────────────────────────────────────────────────────────────────

interface RequestBody {
  company_user_id: string;
}

interface UserRow {
  id:    string;
  email: string;
}

interface CompanyUserRow {
  id:            string;
  display_email: string | null;
  user:          UserRow | null;
}

// ─── POST /api/users/invite-link ─────────────────────────────────────────────
//
// Generates a password-recovery link for an inactive company member and
// returns it to the admin so it can be shown / copied in the UI.
//
// Security:
//  • Requires an authenticated session (anon-key server client verifies the JWT)
//  • Caller must be an active owner or admin in the same company as the target
//  • company_user_id is validated against the caller's company — no cross-company access
//  • SUPABASE_SERVICE_ROLE_KEY is only read server-side and never returned to the client
//
export async function POST(request: NextRequest) {
  try {
    // ── 1. Verify caller session ─────────────────────────────────────────────
    const supabase = await createClient();
    const { data: { user: caller }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !caller) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    // ── 2. Verify caller is an active owner / admin ──────────────────────────
    const { data: membership } = await supabase
      .from("company_users")
      .select("company_id, role")
      .eq("user_id", caller.id)
      .eq("status", "active")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!membership) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    if (!["owner", "admin"].includes(membership.role as string)) {
      return NextResponse.json({ message: "Only owners and admins can generate invitation links." }, { status: 403 });
    }

    // ── 3. Parse and validate request body ───────────────────────────────────
    const body = await request.json() as RequestBody;
    if (!body?.company_user_id) {
      return NextResponse.json({ message: "company_user_id is required" }, { status: 400 });
    }

    // ── 4. Fetch target user — scoped to the caller's company ────────────────
    const { data: target } = await supabase
      .from("company_users")
      .select("id, display_email, user:users!company_users_user_id_fkey(id, email)")
      .eq("id", body.company_user_id)
      .eq("company_id", membership.company_id as string)
      .maybeSingle();

    const targetRow = target as CompanyUserRow | null;
    // Prefer live auth-user email; fall back to cached display_email for orphaned rows
    const email = targetRow?.user?.email ?? targetRow?.display_email ?? null;
    if (!targetRow || !email) {
      return NextResponse.json({ message: "User not found in your company." }, { status: 404 });
    }

    // ── 5. Build admin client — service_role stays server-side ───────────────
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!serviceKey || !supabaseUrl) {
      console.error("[invite-link] SUPABASE_SERVICE_ROLE_KEY is not set");
      return NextResponse.json(
        { message: "Server misconfiguration: service key not configured." },
        { status: 500 }
      );
    }

    const admin = createAdmin(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // ── 6. Generate a password-recovery link ─────────────────────────────────
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const redirectTo = `${appUrl}/auth/callback?next=/reset-password`;

    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type:    "recovery",
      email,
      options: { redirectTo },
    });

    if (linkErr) {
      if (
        linkErr.message?.toLowerCase().includes("rate limit") ||
        linkErr.message?.toLowerCase().includes("too many")
      ) {
        return NextResponse.json({ message: "rate_limit" }, { status: 429 });
      }
      throw linkErr;
    }

    const actionLink = linkData?.properties?.action_link;
    if (!actionLink) {
      return NextResponse.json({ message: "Failed to generate link." }, { status: 500 });
    }

    return NextResponse.json({ link: actionLink, email });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    console.error("[invite-link]", message);
    return NextResponse.json({ message }, { status: 500 });
  }
}
