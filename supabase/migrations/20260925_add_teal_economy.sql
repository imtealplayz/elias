-- Elias Teal economy
-- Apply this migration once in the Supabase SQL editor.
create table if not exists public.teal_economy (
  guild_id text not null,
  discord_id text not null,
  balance bigint not null default 0 check (balance >= 0),
  total_wagered bigint not null default 0 check (total_wagered >= 0),
  stats jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (guild_id, discord_id)
);

create index if not exists teal_economy_guild_balance_idx
  on public.teal_economy(guild_id, balance desc);

create index if not exists teal_economy_guild_wagered_idx
  on public.teal_economy(guild_id, total_wagered desc);
