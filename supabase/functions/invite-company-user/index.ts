/**
 * invite-company-user — Supabase Edge Function
 *
 * Allows an owner or admin to invite a new user to their company by email.
 * The service_role key (required for inviteUserByEmail) is only used here,
 * server-side. The browser client never sees it.
 *
 * Flow
 * ────
 * 1. Validate input (email, role).
 * 2. Authenticate the caller via their JWT → derive company_id from DB
 *    (never trusted from the request body).
 * 3. Verify the caller is owner or admin.
 * 4. If the email already belongs to a registered user (public.users row):
 *      a. Already a member → return { status: "already_member" }.
 *      b. Not yet a member → create company_users directly, return { status: "added" }.
 * 5. New user path:
 *      a. Insert company_user_invitations row first (committed before step b).
 *      b. Call supabase.auth.admin.inviteUserByEmail() — this creates auth.users,
 *         which fires the handle_new_user() trigger; that trigger reads the
 *         invitation row and creates public.users + company_users automatically.
 *      c. Return { status: "invited" }.
 *
 * Required environment variables (set via `supabase secrets set`):
 *   SUPABASE_URL              — auto-injected by Supabase runtime
 *   SUPABASE_ANON_KEY         — auto-injected by Supabase runtime
 *   SUPABASE_SERVICE_ROLE_KEY — auto-injected by Supabase runtime
 *   FRONTEND_URL              — your app's public URL (e.g. https://malgoof.vercel.app)
 *
 * Deployment:
 *   supabase functions deploy invite-company-user --project-ref <ref>
 *   supabase secrets set FRONTEND_URL=https://your-app.com
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Types ────────────────────────────────────────────────────────────────────

interface InviteRequestBody {
  email:   string;
  role:    string;
  color?:  string;
  emp_id?: string;
  region?: string;
}

interface JsonResponse {
  status?:  string;
  message:  string;
  error?:   string;
}

// ─── CORS headers (allow the Next.js frontend to call this function) ──────────

const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
} as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function respond(body: JsonResponse, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

const VALID_ROLES = ["owner", "admin", "merchandiser"] as const;
type ValidRole    = (typeof VALID_ROLES)[number];

function isValidRole(v: string): v is ValidRole {
  return (VALID_ROLES as readonly string[]).includes(v);
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  // ── CORS preflight ────────────────────────────────────────────────────────
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return respond({ error: "method_not_allowed", message: "Only POST is accepted." }, 405);
  }

  try {
    // ── 1. Parse and validate the request body ───────────────────────────────
    let body: InviteRequestBody;
    try {
      body = await req.json() as InviteRequestBody;
    } catch {
      return respond({ error: "bad_request", message: "Request body must be valid JSON." }, 400);
    }

    const email = body.email?.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return respond({ error: "invalid_email", message: "Please provide a valid email address." }, 400);
    }

    if (!body.role || !isValidRole(body.role)) {
      return respond({ error: "invalid_role", message: "Role must be one of: owner, admin, merchandiser." }, 400);
    }

    const role   = body.role;
    const color  = body.color  ?? "#6366F1";
    const emp_id = body.emp_id ?? null;
    const region = body.region ?? null;

    // ── 2. Build clients ─────────────────────────────────────────────────────
    const supabaseUrl        = Deno.env.get("SUPABASE_URL")!;
    const anonKey            = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey     = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const frontendUrl        = Deno.env.get("FRONTEND_URL") ?? "http://localhost:3000";

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return respond({ error: "unauthorized", message: "Missing Authorization header." }, 401);
    }

    // Caller client — authenticated as the requesting user (validates JWT).
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Admin client — service role, never sent to the browser.
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // ── 3. Verify caller identity ────────────────────────────────────────────
    const { data: { user: caller }, error: authErr } = await callerClient.auth.getUser();
    if (authErr || !caller) {
      return respond({ error: "unauthorized", message: "Invalid or expired session. Please sign in again." }, 401);
    }

    // ── 4. Derive company_id from DB — never trust it from the client ────────
    // If the caller belongs to multiple companies (rare), use the first active
    // membership. The frontend already scopes actions to one company at a time.
    const { data: membership, error: memberErr } = await callerClient
      .from("company_users")
      .select("company_id, role")
      .eq("user_id", caller.id)
      .eq("status", "active")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (memberErr || !membership) {
      return respond({ error: "unauthorized", message: "You are not an active member of any company." }, 401);
    }

    if (!["owner", "admin"].includes(membership.role as string)) {
      return respond({ error: "forbidden", message: "Only owners and admins can invite new members." }, 403);
    }

    const company_id  = membership.company_id as string;
    const invited_by  = caller.id;            // public.users.id == auth.users.id

    // ── 5. Check whether the email already belongs to a registered user ──────
    const { data: existingUser } = await adminClient
      .from("users")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (existingUser) {
      // User already has a public.users profile — check company membership.
      const { data: alreadyMember } = await adminClient
        .from("company_users")
        .select("id")
        .eq("company_id", company_id)
        .eq("user_id", existingUser.id as string)
        .maybeSingle();

      if (alreadyMember) {
        // Already in this company — nothing to do.
        return respond({
          status:  "already_member",
          message: "This person is already a member of your company.",
        });
      }

      // Registered but not in this company → create membership directly.
      const { error: insertErr } = await adminClient
        .from("company_users")
        .insert({
          company_id,
          user_id:    existingUser.id,
          role,
          color,
          emp_id,
          region,
          status:     "active",
          invited_by,
        });

      if (insertErr) {
        // Race condition: another request already added them.
        if (insertErr.code === "23505") {
          return respond({
            status:  "already_member",
            message: "This person is already a member of your company.",
          });
        }
        throw insertErr;
      }

      return respond({
        status:  "added",
        message: "Member added successfully. They can now access your company.",
      });
    }

    // ── 6. New user — insert invitation row first, then send invite email ────
    //
    // IMPORTANT: the invitation row must be committed BEFORE calling
    // inviteUserByEmail(), because inviteUserByEmail() synchronously
    // creates auth.users and fires the handle_new_user() DB trigger.
    // That trigger reads this row to link the user to the correct company.

    const { data: invitation, error: invRowErr } = await adminClient
      .from("company_user_invitations")
      .insert({
        company_id,
        email,
        role,
        color,
        emp_id,
        region,
        invited_by,
      })
      .select("id")
      .single();

    if (invRowErr || !invitation) {
      throw invRowErr ?? new Error("Failed to create invitation record.");
    }

    const invitationId = invitation.id as string;

    // ── 7. Send invite email via Supabase Auth admin ─────────────────────────
    const { error: inviteErr } = await adminClient.auth.admin.inviteUserByEmail(
      email,
      {
        // After the user sets their password, Supabase redirects here.
        // The Supabase JS client on this page will pick up the session
        // from the URL fragment and complete the sign-in automatically.
        redirectTo: `${frontendUrl}/login`,
        data: {
          // Metadata is available in raw_user_meta_data inside the trigger.
          // The trigger itself handles company linking; this is informational.
          invited_to_company: company_id,
          invited_role:       role,
        },
      }
    );

    if (inviteErr) {
      // Clean up the staging row so it does not block future retries.
      await adminClient
        .from("company_user_invitations")
        .delete()
        .eq("id", invitationId);

      // "User already registered" means the user registered between our
      // check (step 5) and here — handle as the "registered" path.
      if (
        inviteErr.message?.toLowerCase().includes("already registered") ||
        inviteErr.message?.toLowerCase().includes("already been registered")
      ) {
        // Re-fetch the now-visible user and add them directly.
        const { data: nowExists } = await adminClient
          .from("users")
          .select("id")
          .eq("email", email)
          .maybeSingle();

        if (nowExists) {
          await adminClient
            .from("company_users")
            .insert({
              company_id,
              user_id:    nowExists.id,
              role,
              color,
              emp_id,
              region,
              status:     "active",
              invited_by,
            })
            .then(() => null);                 // ignore duplicate errors silently

          return respond({
            status:  "added",
            message: "Member added successfully. They can now access your company.",
          });
        }
      }

      throw inviteErr;
    }

    // The trigger will have already created public.users and company_users.
    return respond({
      status:  "invited",
      message: "Invitation email sent successfully.",
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "An unexpected error occurred.";
    console.error("[invite-company-user]", message);
    return respond({ error: "internal_error", message }, 500);
  }
});
