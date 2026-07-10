-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 015: AI request logs (observability + cost tracking)
-- ─────────────────────────────────────────────────────────────────────────────
--
-- One row per AI chat request. Written ONLY through the SECURITY DEFINER
-- RPC below (server route, fire-and-forget). Never stores prompts, tool
-- results, or secrets — metadata only.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists ai_request_logs (
  id              uuid primary key default uuid_generate_v4(),
  company_id      uuid not null references companies(id) on delete cascade,
  user_id         uuid not null references users(id)     on delete cascade,
  conversation_id uuid references ai_conversations(id) on delete set null,
  request_id      text not null,
  model           text not null,
  tool_names      text[] not null default '{}',
  tool_rounds     int  not null default 0,
  duration_ms     int  not null default 0,
  input_tokens    int  not null default 0,
  output_tokens   int  not null default 0,
  success         boolean not null default true,
  error_category  text,
  created_at      timestamptz not null default now()
);

create index if not exists idx_ai_logs_created      on ai_request_logs (created_at desc);
create index if not exists idx_ai_logs_company_date on ai_request_logs (company_id, created_at desc);
create index if not exists idx_ai_logs_user         on ai_request_logs (user_id);
create index if not exists idx_ai_logs_conversation on ai_request_logs (conversation_id);

-- ── RLS: read own company; NO direct client writes ───────────────────────────

alter table ai_request_logs enable row level security;

drop policy if exists ai_logs_select on ai_request_logs;
create policy ai_logs_select on ai_request_logs for select
  using (company_id = any(get_my_company_ids()));

-- ── Server-write RPC (identity derived from auth.uid()) ───────────────────────

create or replace function log_ai_request(
  p_conversation_id uuid,
  p_request_id      text,
  p_model           text,
  p_tool_names      text[],
  p_tool_rounds     int,
  p_duration_ms     int,
  p_input_tokens    int,
  p_output_tokens   int,
  p_success         boolean,
  p_error_category  text
)
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
  where  user_id = v_user_id and status = 'active'
  order by created_at
  limit 1;

  if v_company_id is null then return; end if;

  insert into ai_request_logs (
    company_id, user_id, conversation_id, request_id, model,
    tool_names, tool_rounds, duration_ms, input_tokens, output_tokens,
    success, error_category
  ) values (
    v_company_id, v_user_id, p_conversation_id, left(p_request_id, 32), left(p_model, 64),
    p_tool_names[1:20], p_tool_rounds, p_duration_ms, p_input_tokens, p_output_tokens,
    p_success, left(p_error_category, 32)
  );
exception when others then
  null;  -- observability must never break anything
end;
$$;
