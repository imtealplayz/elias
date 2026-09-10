import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import { config } from './config.js';

export const supabase = createClient(config.supabaseUrl, config.supabaseSecretKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false
  },
  realtime: {
    transport: ws
  }
});

async function unwrap(promise, label) {
  const { data, error } = await promise;
  if (error) {
    console.error(`[DB] ${label}:`, error.message);
    throw error;
  }
  return data;
}

export async function getChannelMode(guildId, channelId) {
  const row = await unwrap(
    supabase
      .from('channels')
      .select('mode')
      .eq('guild_id', guildId)
      .eq('channel_id', channelId)
      .maybeSingle(),
    'getChannelMode'
  );

  return row?.mode || null;
}

export async function setChannelMode(guildId, channelId, mode) {
  return unwrap(
    supabase
      .from('channels')
      .upsert({
        guild_id: guildId,
        channel_id: channelId,
        mode,
        updated_at: new Date().toISOString()
      }, { onConflict: 'channel_id' }),
    'setChannelMode'
  );
}

export async function removeChannelMode(guildId, channelId) {
  return unwrap(
    supabase
      .from('channels')
      .delete()
      .eq('guild_id', guildId)
      .eq('channel_id', channelId),
    'removeChannelMode'
  );
}

export async function upsertUser(user) {
  return unwrap(
    supabase
      .from('users')
      .upsert({
        discord_id: user.id,
        username: user.username,
        display_name: user.displayName || user.username,
        updated_at: new Date().toISOString()
      }, { onConflict: 'discord_id' }),
    'upsertUser'
  );
}

export async function saveMessage({ guildId, channelId, userId, username, content }) {
  return unwrap(
    supabase.from('messages').insert({
      guild_id: guildId,
      channel_id: channelId,
      discord_id: userId,
      username,
      content
    }),
    'saveMessage'
  );
}

export async function getRecentMessages(guildId, channelId, limit) {
  const rows = await unwrap(
    supabase
      .from('messages')
      .select('discord_id, username, content, created_at')
      .eq('guild_id', guildId)
      .eq('channel_id', channelId)
      .order('created_at', { ascending: false })
      .limit(limit),
    'getRecentMessages'
  );

  return rows.reverse();
}

export async function getUserMemories(guildId, discordId, limit) {
  return unwrap(
    supabase
      .from('memories')
      .select('id, memory, importance, created_at')
      .eq('guild_id', guildId)
      .eq('discord_id', discordId)
      .order('importance', { ascending: false })
      .order('updated_at', { ascending: false })
      .limit(limit),
    'getUserMemories'
  );
}

export async function saveMemories(guildId, discordId, memories) {
  if (!memories?.length) return;

  const rows = memories
    .filter((item) => typeof item?.memory === 'string' && item.memory.trim())
    .map((item) => ({
      guild_id: guildId,
      discord_id: discordId,
      memory: item.memory.trim().slice(0, 500),
      importance: Math.min(1, Math.max(0, Number(item.importance) || 0.5))
    }));

  if (!rows.length) return;
  return unwrap(supabase.from('memories').insert(rows), 'saveMemories');
}
