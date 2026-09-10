import { config } from './config.js';

const baseUrl = `${config.supabaseUrl.replace(/\/$/, '')}/rest/v1`;

async function request(table, { method = 'GET', query = '', body, prefer } = {}) {
  const response = await fetch(`${baseUrl}/${table}${query}`, {
    method,
    headers: {
      apikey: config.supabaseSecretKey,
      Authorization: `Bearer ${config.supabaseSecretKey}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {})
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    const detail = typeof data === 'string' ? data : JSON.stringify(data);
    throw new Error(`Supabase ${method} ${table} failed (${response.status}): ${detail}`);
  }

  return data;
}

function encode(value) {
  return encodeURIComponent(value);
}

export async function getChannelMode(guildId, channelId) {
  const rows = await request('channels', {
    query: `?select=mode&guild_id=eq.${encode(guildId)}&channel_id=eq.${encode(channelId)}&limit=1`
  });

  return rows?.[0]?.mode || null;
}

export async function listChannelModes(guildId) {
  return request('channels', {
    query: `?select=channel_id,mode&guild_id=eq.${encode(guildId)}&order=mode.asc`
  });
}

export async function setChannelMode(guildId, channelId, mode) {
  return request('channels', {
    method: 'POST',
    query: '?on_conflict=channel_id',
    body: [{
      guild_id: guildId,
      channel_id: channelId,
      mode,
      updated_at: new Date().toISOString()
    }],
    prefer: 'resolution=merge-duplicates,return=minimal'
  });
}

export async function removeChannelMode(guildId, channelId) {
  return request('channels', {
    method: 'DELETE',
    query: `?guild_id=eq.${encode(guildId)}&channel_id=eq.${encode(channelId)}`
  });
}

export async function upsertUser(user) {
  return request('users', {
    method: 'POST',
    query: '?on_conflict=discord_id',
    body: [{
      discord_id: user.id,
      username: user.username,
      display_name: user.displayName || user.username,
      updated_at: new Date().toISOString()
    }],
    prefer: 'resolution=merge-duplicates,return=minimal'
  });
}

export async function saveMessage({ guildId, channelId, userId, username, content }) {
  return request('messages', {
    method: 'POST',
    body: [{
      guild_id: guildId,
      channel_id: channelId,
      discord_id: userId,
      username,
      content
    }],
    prefer: 'return=minimal'
  });
}

export async function getRecentMessages(guildId, channelId, limit) {
  const rows = await request('messages', {
    query: `?select=discord_id,username,content,created_at&guild_id=eq.${encode(guildId)}&channel_id=eq.${encode(channelId)}&order=created_at.desc&limit=${Math.max(1, Number(limit) || 18)}`
  });

  return (rows || []).reverse();
}

export async function getUserMemories(guildId, discordId, limit) {
  return request('memories', {
    query: `?select=id,memory,importance,created_at&guild_id=eq.${encode(guildId)}&discord_id=eq.${encode(discordId)}&order=importance.desc,updated_at.desc&limit=${Math.max(1, Number(limit) || 12)}`
  });
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
  return request('memories', {
    method: 'POST',
    body: rows,
    prefer: 'return=minimal'
  });
}

export async function deleteUserMemories(guildId, discordId) {
  return request('memories', {
    method: 'DELETE',
    query: `?guild_id=eq.${encode(guildId)}&discord_id=eq.${encode(discordId)}`
  });
}
