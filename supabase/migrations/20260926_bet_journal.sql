-- Run once in the Supabase SQL editor. Existing rdg_picks records are untouched.
create table if not exists public.rdg_bet_journal (
  owner_hash text not null,
  id text not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  primary key (owner_hash, id)
);
create table if not exists public.rdg_bet_settlements (
  owner_hash text not null,
  id text not null,
  bet_id text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (owner_hash, id),
  foreign key (owner_hash, bet_id) references public.rdg_bet_journal(owner_hash,id)
);
alter table public.rdg_bet_journal enable row level security;
alter table public.rdg_bet_settlements enable row level security;
revoke all on public.rdg_bet_journal, public.rdg_bet_settlements from anon, authenticated;
grant select, insert on public.rdg_bet_journal, public.rdg_bet_settlements to service_role;
-- Browser clients cannot query or mutate another journal; the server scopes by a hashed random token.
create or replace function public.rdg_reject_journal_change() returns trigger language plpgsql as $$
begin raise exception 'Journal snapshots and settlement history are append-only'; end; $$;
drop trigger if exists rdg_immutable_bets on public.rdg_bet_journal;
create trigger rdg_immutable_bets before update or delete on public.rdg_bet_journal for each row execute function public.rdg_reject_journal_change();
drop trigger if exists rdg_immutable_settlements on public.rdg_bet_settlements;
create trigger rdg_immutable_settlements before update or delete on public.rdg_bet_settlements for each row execute function public.rdg_reject_journal_change();
