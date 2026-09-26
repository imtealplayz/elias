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


-- Daily/deposit tracking fields used by the Tokens wallet.
alter table public.teal_economy add column if not exists total_deposited bigint not null default 0 check (total_deposited >= 0);
alter table public.teal_economy add column if not exists total_daily_claimed bigint not null default 0 check (total_daily_claimed >= 0);
alter table public.teal_economy add column if not exists last_daily bigint not null default 0 check (last_daily >= 0);


-- Seven-day withdrawal lock metadata for stock holdings.
alter table public.stock_holdings add column if not exists reserved_quantity integer not null default 0;
alter table public.stock_holdings add column if not exists locked_until timestamptz;
update public.stock_holdings set reserved_quantity = 0 where reserved_quantity is null;
create index if not exists stock_holdings_locked_until_idx on public.stock_holdings(locked_until);
