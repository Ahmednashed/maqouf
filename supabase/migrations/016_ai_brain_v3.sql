-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 016: AI Operations Brain v3 — observability + structured findings
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Extends request logging with planner/evidence metadata and adds a
-- findings column for structured executive answers. No prompts,
-- chain-of-thought, or raw tool results are stored anywhere.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── A: Extended request-log columns ───────────────────────────────────────────

alter table ai_request_logs
  add column if not exists intent                  text,
  add column if not exists planner_used            boolean not null default false,
  add column if not exists evidence_confidence     text,
  add column if not exists clarification_requested boolean not null default false,
  add column if not exists resolved_entity_types   text[] not null default '{}';

-- ── B: Structured findings on assistant messages ──────────────────────────────

alter table ai_messages
  add column if not exists findings jsonb;

-- ── C: Extended server-write RPC (replaces the v2 signature) ─────────────────

drop function if exists log_ai_request(
  uuid, text, text, text[], int, int, int, int, boolean, text
);

create or replace function log_ai_request(
  p_conversation_id         uuid,
  p_request_id              text,
  p_model                   text,
  p_tool_names              text[],
  p_tool_rounds             int,
  p_duration_ms             int,
  p_input_tokens            int,
  p_output_tokens           int,
  p_success                 boolean,
  p_error_category          text,
  p_intent                  text default null,
  p_planner_used            boolean default false,
  p_evidence_confidence     text default null,
  p_clarification_requested boolean default false,
  p_resolved_entity_types   text[] default '{}'
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
    success, error_category,
    intent, planner_used, evidence_confidence,
    clarification_requested, resolved_entity_types
  ) values (
    v_company_id, v_user_id, p_conversation_id, left(p_request_id, 32), left(p_model, 64),
    p_tool_names[1:20], p_tool_rounds, p_duration_ms, p_input_tokens, p_output_tokens,
    p_success, left(p_error_category, 32),
    left(p_intent, 40), p_planner_used, left(p_evidence_confidence, 12),
    p_clarification_requested, p_resolved_entity_types[1:8]
  );
exception when others then
  null;  -- observability must never break anything
end;
$$;
