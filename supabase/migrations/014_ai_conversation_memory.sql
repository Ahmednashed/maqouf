-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 014: AI conversation memory
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Persistent chat history for the AI Assistant.
--
-- Access model (v1 of memory):
--   • A conversation belongs to ONE user in ONE company.
--   • Users see ONLY their own conversations (user_id = auth.uid())
--     inside their own company (RLS double-check).
--   • Message inserts happen from the authenticated server route using the
--     same cookie session — no service_role anywhere.
--
-- Retention / cleanup strategy (documented, NOT implemented yet):
--   Recommended: a scheduled job (pg_cron or external) deleting conversations
--   with last_message_at older than 90 days:
--     delete from ai_conversations where last_message_at < now() - interval '90 days';
--   ai_messages rows cascade automatically. Do NOT enable until product
--   confirms the retention window. No auto-deletion in this migration.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── A: Conversations ──────────────────────────────────────────────────────────

create table if not exists ai_conversations (
  id              uuid primary key default uuid_generate_v4(),
  company_id      uuid not null references companies(id) on delete cascade,
  user_id         uuid not null references users(id)     on delete cascade,
  title           text not null default '',
  locale          text not null default 'ar',
  -- Compact rolling context of entities discussed (Phase 6 follow-ups):
  -- { "users": ["أحمد"], "places": ["فرع العليا"], "visit_ids": ["..."] }
  entity_context  jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

create index if not exists idx_ai_conv_company on ai_conversations (company_id);
create index if not exists idx_ai_conv_user    on ai_conversations (user_id, last_message_at desc);

-- ── B: Messages ───────────────────────────────────────────────────────────────

create table if not exists ai_messages (
  id              uuid primary key default uuid_generate_v4(),
  conversation_id uuid not null references ai_conversations(id) on delete cascade,
  company_id      uuid not null references companies(id) on delete cascade,
  user_id         uuid not null references users(id)     on delete cascade,
  role            text not null check (role in ('user', 'assistant')),
  content         text not null,
  tool_calls      jsonb,
  sources         jsonb,
  input_tokens    int not null default 0,
  output_tokens   int not null default 0,
  created_at      timestamptz not null default now()
);

create index if not exists idx_ai_msg_conversation on ai_messages (conversation_id, created_at);
create index if not exists idx_ai_msg_company      on ai_messages (company_id);
create index if not exists idx_ai_msg_user         on ai_messages (user_id);
create index if not exists idx_ai_msg_created      on ai_messages (created_at);

-- ── C: RLS — own conversations only, tenant-scoped ────────────────────────────

alter table ai_conversations enable row level security;
alter table ai_messages      enable row level security;

drop policy if exists ai_conv_select on ai_conversations;
create policy ai_conv_select on ai_conversations for select
  using (user_id = auth.uid() and company_id = any(get_my_company_ids()));

drop policy if exists ai_conv_insert on ai_conversations;
create policy ai_conv_insert on ai_conversations for insert
  with check (user_id = auth.uid() and company_id = any(get_my_company_ids()));

drop policy if exists ai_conv_update on ai_conversations;
create policy ai_conv_update on ai_conversations for update
  using      (user_id = auth.uid() and company_id = any(get_my_company_ids()))
  with check (user_id = auth.uid() and company_id = any(get_my_company_ids()));

drop policy if exists ai_conv_delete on ai_conversations;
create policy ai_conv_delete on ai_conversations for delete
  using (user_id = auth.uid() and company_id = any(get_my_company_ids()));

drop policy if exists ai_msg_select on ai_messages;
create policy ai_msg_select on ai_messages for select
  using (user_id = auth.uid() and company_id = any(get_my_company_ids()));

drop policy if exists ai_msg_insert on ai_messages;
create policy ai_msg_insert on ai_messages for insert
  with check (user_id = auth.uid() and company_id = any(get_my_company_ids()));

-- No update policy on messages (immutable once written).
-- Deletes happen via conversation cascade only.
