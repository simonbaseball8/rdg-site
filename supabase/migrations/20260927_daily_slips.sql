-- Additive public MODEL record only; personal journals remain private.
create table if not exists public.rdg_daily_slips (
  id text primary key,
  snapshot jsonb not null,
  settlements jsonb not null default '[]'::jsonb,
  revision integer not null default 0,
  created_at timestamptz not null default now()
);
alter table public.rdg_daily_slips enable row level security;
revoke all on public.rdg_daily_slips from anon, authenticated;
grant select, insert, update on public.rdg_daily_slips to service_role;
create or replace function public.rdg_protect_daily_snapshot() returns trigger language plpgsql as $$
begin
  if new.snapshot is distinct from old.snapshot or new.id is distinct from old.id or new.created_at is distinct from old.created_at then
    raise exception 'Original daily slip is immutable';
  end if;
  if new.revision <> old.revision + 1 or jsonb_array_length(new.settlements) <> jsonb_array_length(old.settlements) + 1 or (new.settlements - (jsonb_array_length(new.settlements)-1)) is distinct from old.settlements then
    raise exception 'Settlement history is append-only';
  end if;
  return new;
end; $$;
drop trigger if exists rdg_daily_immutable on public.rdg_daily_slips;
create trigger rdg_daily_immutable before update on public.rdg_daily_slips for each row execute function public.rdg_protect_daily_snapshot();
