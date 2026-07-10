-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 013: AI usage tracking (daily request limits + token accounting)
-- ─────────────────────────────────────────────────────────────────────────────
--
-- One row per (company, user, day). Written ONLY through the two
-- SECURITY DEFINER RPCs below — clients cannot insert/update directly,
-- so client-side counters are never trusted. No service_role involved:
-- both RPCs derive identity from auth.uid().
-- ─────────────────────────────────────────────────────────────────────────────

-- ── A: Table ──────────────────────────────────────────────────────────────────

create table if not exists ai_usage_daily (
  id            uuid primary key default uuid_generate_v4(),
  company_id    uuid not null references companies(id) on delete cascade,
  user_id       uuid not null references users(id)     on delete cascade,
  usage_date    date not null default current_date,
  request_count int  not null default 0,
  input_tokens  bigint not null default 0,
  output_tokens bigint not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (company_id, user_id, usage_date)
);

create index if not exists idx_ai_usage_company_date
  on ai_usage_daily (company_id, usage_date desc);

-- ── B: RLS — read own company, no direct writes ───────────────────────────────

alter table ai_usage_daily enable row level security;

drop policy if exists ai_usage_select on ai_usage_daily;
create policy ai_usage_select on ai_usage_daily for select
  using (company_id = any(get_my_company_ids()));

-- Deliberately NO insert/update/delete policies: writes go through the
-- SECURITY DEFINER RPCs only.

-- ── C: RPC — check limit and increment atomically ────────────────────────────
--
-- Returns the request count AFTER increment when allowed, or -1 when the
-- daily limit is already reached (row untouched). The caller (API route)
-- maps -1 to HTTP 429.

create or replace function check_and_increment_ai_usage(p_limit int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id    uuid;
  v_company_id uuid;
  v_count      int;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    return -1;
  end if;

  select company_id into v_company_id
  from   company_users
  where  user_id = v_user_id
    and  status  = 'active'
  order by created_at
  limit 1;

  if v_company_id is null then
    return -1;
  end if;

  insert into ai_usage_daily (company_id, user_id, usage_date, request_count)
  values (v_company_id, v_user_id, current_date, 0)
  on conflict (company_id, user_id, usage_date) do nothing;

  -- Atomic conditional increment: only bump when under the limit
  update ai_usage_daily
  set    request_count = request_count + 1,
         updated_at    = now()
  where  company_id = v_company_id
    and  user_id    = v_user_id
    and  usage_date = current_date
    and  request_count < p_limit
  returning request_count into v_count;

  if v_count is null then
    return -1;   -- limit reached
  end if;
  return v_count;
end;
$$;

-- ── D: RPC — record token usage after a completed request ────────────────────

create or replace function record_ai_tokens(p_input bigint, p_output bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id    uuid;
  v_company_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then return; end if;

  select company_id into v_company_id
  from   company_users
  where  user_id = v_user_id
    and  status  = 'active'
  order by created_at
  limit 1;

  if v_company_id is null then return; end if;

  update ai_usage_daily
  set    input_tokens  = input_tokens  + greatest(p_input,  0),
         output_tokens = output_tokens + greatest(p_output, 0),
         updated_at    = now()
  where  company_id = v_company_id
    and  user_id    = v_user_id
    and  usage_date = current_date;
end;
$$;
