-- Run once in the existing Elias Supabase project.
create table if not exists public.afk_status (
  guild_id text not null,
  discord_id text not null,
  username text not null,
  display_name text not null,
  reason text,
  started_at timestamptz not null,
  mention_count integer not null default 0,
  pingers jsonb not null default '[]'::jsonb,
  primary key (guild_id, discord_id)
);

create index if not exists afk_guild_idx on public.afk_status(guild_id);
