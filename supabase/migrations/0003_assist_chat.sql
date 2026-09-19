-- Rovty Assist — website support chat.
--
-- A visitor on rovty.com opens the chat widget, which creates a session and
-- posts messages to the rovty.com Worker. The Worker relays each visitor
-- message to a Telegram bot chat (the support person, Iresh, replies from
-- Telegram); Telegram's webhook delivers replies back to the Worker, which
-- stores them here and the widget polls for them.
--
-- Both tables are service-role only: browsers never touch Supabase directly
-- for chat — the Worker is the only client and it authenticates visitors by
-- an unguessable session token it issued.

create table public.assist_sessions (
  id uuid primary key default gen_random_uuid(),
  -- Opaque bearer the widget stores in localStorage; proves ownership of the
  -- session on every request. 32 random bytes, base64url.
  token text not null unique,
  visitor_name text,
  visitor_email text,
  page text,
  user_agent text,
  country text,
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  -- Telegram message_id of the "new conversation" header we posted; replies
  -- to any message in this session are routed via assist_messages.tg_message_id.
  tg_thread_message_id bigint
);

create table public.assist_messages (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.assist_sessions (id) on delete cascade,
  sender text not null check (sender in ('visitor', 'agent', 'system')),
  agent_name text,
  body text not null check (char_length(body) between 1 and 4000),
  -- Telegram message_id of the copy we sent to the bot chat (visitor
  -- messages), or of the agent's reply (agent messages). Lets a Telegram
  -- "Reply" be mapped back to its session.
  tg_message_id bigint,
  created_at timestamptz not null default now()
);
create index assist_messages_session_idx on public.assist_messages (session_id, id);
create unique index assist_messages_tg_idx on public.assist_messages (tg_message_id) where tg_message_id is not null;

alter table public.assist_sessions enable row level security;
alter table public.assist_messages enable row level security;
revoke all on public.assist_sessions from anon, authenticated;
revoke all on public.assist_messages from anon, authenticated;
grant all on public.assist_sessions to service_role;
grant all on public.assist_messages to service_role;
grant usage, select on sequence public.assist_messages_id_seq to service_role;
