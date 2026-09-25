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
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }

  if (!response.ok) {
    const detail = typeof data === 'string' ? data : JSON.stringify(data);
    throw new Error(`Supabase ${method} ${table} failed (${response.status}): ${detail}`);
  }
  return data;
}

function encode(value) { return encodeURIComponent(value); }

function normalizeMemory(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export async function getChannelMode(guildId, channelId) {
  const rows = await request('channels', { query: `?select=mode&guild_id=eq.${encode(guildId)}&channel_id=eq.${encode(channelId)}&limit=1` });
  return rows?.[0]?.mode || null;
}

export async function listChannelModes(guildId) {
  return request('channels', { query: `?select=channel_id,mode&guild_id=eq.${encode(guildId)}&order=mode.asc` });
}

export async function setChannelMode(guildId, channelId, mode) {
  return request('channels', {
    method: 'POST', query: '?on_conflict=channel_id',
    body: [{ guild_id: guildId, channel_id: channelId, mode, updated_at: new Date().toISOString() }],
    prefer: 'resolution=merge-duplicates,return=minimal'
  });
}

export async function removeChannelMode(guildId, channelId) {
  return request('channels', { method: 'DELETE', query: `?guild_id=eq.${encode(guildId)}&channel_id=eq.${encode(channelId)}` });
}

export async function upsertUser(user) {
  return request('users', {
    method: 'POST', query: '?on_conflict=discord_id',
    body: [{ discord_id: user.id, username: user.username, display_name: user.displayName || user.username, updated_at: new Date().toISOString() }],
    prefer: 'resolution=merge-duplicates,return=minimal'
  });
}

export async function saveMessage({ guildId, channelId, userId, username, content, isBot = false }) {
  return request('messages', {
    method: 'POST',
    body: [{ guild_id: guildId, channel_id: channelId, discord_id: userId, username, content, is_bot: Boolean(isBot) }],
    prefer: 'return=minimal'
  });
}

export async function getRecentMessages(guildId, channelId, limit) {
  const rows = await request('messages', { query: `?select=discord_id,username,content,is_bot,created_at&guild_id=eq.${encode(guildId)}&channel_id=eq.${encode(channelId)}&order=created_at.desc&limit=${Math.max(1, Number(limit) || 18)}` });
  return (rows || []).reverse();
}

export async function getUserMemories(guildId, discordId, limit) {
  return request('memories', { query: `?select=id,memory,importance,created_at&guild_id=eq.${encode(guildId)}&discord_id=eq.${encode(discordId)}&order=importance.desc,updated_at.desc&limit=${Math.max(1, Number(limit) || 12)}` });
}

export async function saveMemories(guildId, discordId, memories) {
  if (!memories?.length) return;
  const existing = await getUserMemories(guildId, discordId, 100);
  const existingKeys = new Set((existing || []).map((item) => normalizeMemory(item.memory)));
  const newKeys = new Set();
  const rows = memories
    .filter((item) => typeof item?.memory === 'string' && item.memory.trim())
    .map((item) => ({ guild_id: guildId, discord_id: discordId, memory: item.memory.trim().replace(/\s+/g, ' ').slice(0, 500), importance: Math.min(1, Math.max(0, Number(item.importance) || 0.5)) }))
    .filter((item) => {
      const key = normalizeMemory(item.memory);
      if (!key || existingKeys.has(key) || newKeys.has(key)) return false;
      newKeys.add(key); return true;
    });
  if (!rows.length) return;
  return request('memories', { method: 'POST', body: rows, prefer: 'return=minimal' });
}

export async function deleteMemoryIds(guildId, discordId, ids) {
  const uniqueIds = [...new Set((ids || []).map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))];
  if (!uniqueIds.length) return 0;
  const deleted = await request('memories', { method: 'DELETE', query: `?guild_id=eq.${encode(guildId)}&discord_id=eq.${encode(discordId)}&id=in.(${uniqueIds.join(',')})`, prefer: 'return=representation' });
  return Array.isArray(deleted) ? deleted.length : 0;
}

export async function deleteUserMemories(guildId, discordId) {
  return request('memories', { method: 'DELETE', query: `?guild_id=eq.${encode(guildId)}&discord_id=eq.${encode(discordId)}` });
}

export async function upsertLastCrunchyrollWatch({ discordId, animeTitle, episodeTitle = null, season = null, episode = null, thumbnailUrl = null, watchedAt = new Date().toISOString() }) {
  const rows = await request('crunchyroll_last_watch', {
    method: 'POST',
    query: '?on_conflict=discord_id',
    body: [{
      discord_id: discordId,
      anime_title: String(animeTitle || 'Unknown anime').trim().slice(0, 300),
      episode_title: episodeTitle ? String(episodeTitle).trim().slice(0, 300) : null,
      season: season ? Number(season) : null,
      episode: episode ? Number(episode) : null,
      thumbnail_url: thumbnailUrl ? String(thumbnailUrl).trim().slice(0, 2000) : null,
      watched_at: watchedAt
    }],
    prefer: 'resolution=merge-duplicates,return=representation'
  });
  return rows?.[0] || null;
}

export async function getLastCrunchyrollWatch(discordId) {
  const rows = await request('crunchyroll_last_watch', {
    query: `?select=discord_id,anime_title,episode_title,season,episode,thumbnail_url,watched_at&discord_id=eq.${encode(discordId)}&limit=1`
  });
  return rows?.[0] || null;
}

export async function createReminder({ guildId, discordId, channelId, task, dueAt }) {
  const rows = await request('reminders', {
    method: 'POST',
    body: [{ guild_id: guildId, discord_id: discordId, channel_id: channelId, task: String(task).trim().slice(0, 300), due_at: dueAt }],
    prefer: 'return=representation'
  });
  return rows?.[0] || null;
}

export async function getUserReminders(guildId, discordId, limit = 10) {
  return request('reminders', {
    query: `?select=id,channel_id,task,due_at,created_at&guild_id=eq.${encode(guildId)}&discord_id=eq.${encode(discordId)}&due_at=gte.${encode(new Date().toISOString())}&order=due_at.asc&limit=${Math.max(1, Number(limit) || 10)}`
  });
}

export async function deleteReminder(id) {
  return request('reminders', { method: 'DELETE', query: `?id=eq.${encode(id)}` });
}

export async function getPendingReminders(now = new Date().toISOString(), limit = 100) {
  return request('reminders', {
    query: `?select=id,guild_id,discord_id,channel_id,task,due_at&due_at=lte.${encode(now)}&order=due_at.asc&limit=${Math.max(1, Number(limit) || 100)}`
  });
}

export async function getNextReminder() {
  const rows = await request('reminders', {
    query: `?select=id,guild_id,discord_id,channel_id,task,due_at&order=due_at.asc&limit=1`
  });
  return rows?.[0] || null;
}

export async function createAfk({ guildId, discordId, username, displayName, reason, startedAt }) {
  const rows = await request('afk_status', {
    method: 'POST',
    query: '?on_conflict=guild_id,discord_id',
    body: [{ guild_id: guildId, discord_id: discordId, username, display_name: displayName, reason: reason || null, started_at: startedAt, mention_count: 0, pingers: [] }],
    prefer: 'resolution=merge-duplicates,return=representation'
  });
  return rows?.[0] || null;
}

export async function getAfk(guildId, discordId) {
  const rows = await request('afk_status', {
    query: `?select=guild_id,discord_id,username,display_name,reason,started_at,mention_count,pingers&guild_id=eq.${encode(guildId)}&discord_id=eq.${encode(discordId)}&limit=1`
  });
  return rows?.[0] || null;
}

export async function recordAfkPing(guildId, discordId, pinger) {
  const afk = await getAfk(guildId, discordId);
  if (!afk) return null;

  const pingers = Array.isArray(afk.pingers) ? [...afk.pingers] : [];
  const existing = pingers.find((entry) => entry.user_id === pinger.userId);
  if (existing) {
    existing.count = Number(existing.count) + 1;
    existing.username = pinger.username;
    existing.display_name = pinger.displayName;
  } else {
    pingers.push({ user_id: pinger.userId, username: pinger.username, display_name: pinger.displayName, count: 1 });
  }

  const rows = await request('afk_status', {
    method: 'PATCH',
    query: `?guild_id=eq.${encode(guildId)}&discord_id=eq.${encode(discordId)}`,
    body: { mention_count: Number(afk.mention_count) + 1, pingers },
    prefer: 'return=representation'
  });
  return rows?.[0] || null;
}

export async function removeAfk(guildId, discordId) {
  const rows = await request('afk_status', {
    method: 'DELETE',
    query: `?guild_id=eq.${encode(guildId)}&discord_id=eq.${encode(discordId)}`,
    prefer: 'return=representation'
  });
  return rows?.[0] || null;
}

export async function resetStocks() {
  await request('stock_holdings', {
    method: 'DELETE',
    query: '?stock_id=not.is.null',
    prefer: 'return=minimal'
  });

  await request('stocks', {
    method: 'PATCH',
    query: '?id=gt.0',
    body: {
      price: 75,
      total_supply: 150
    },
    prefer: 'return=minimal'
  });

  return true;
}

export async function getStocks() {
  const stocks = await request('stocks', {
    query: '?select=id,symbol,name,price,total_supply&order=id.asc'
  });
  const holdings = await request('stock_holdings', {
    query: '?select=stock_id,quantity'
  });
  const totals = new Map();
  for (const row of holdings || []) {
    totals.set(row.stock_id, (totals.get(row.stock_id) || 0) + Number(row.quantity || 0));
  }
  return (stocks || []).map((stock) => ({
    ...stock,
    price: Number(stock.price),
    totalSupply: Number(stock.total_supply),
    owned: totals.get(stock.id) || 0,
    available: Math.max(0, Number(stock.total_supply) - (totals.get(stock.id) || 0))
  }));
}

export async function getUserPortfolio(discordId) {
  return request('stock_holdings', {
    query: '?select=stock_id,quantity,stocks(symbol,name,price,total_supply)&discord_id=eq.' + encode(discordId) + '&order=stock_id.asc'
  }).then((rows) => (rows || []).map((row) => ({
    stockId: row.stock_id,
    quantity: Number(row.quantity),
    symbol: row.stocks?.symbol || 'UNKNOWN',
    name: row.stocks?.name || 'Unknown Stock',
    price: Number(row.stocks?.price || 0),
    totalSupply: Number(row.stocks?.total_supply || 150)
  })));
}

export async function buyStock(discordId, symbol, quantity) {
  const stocks = await request('stocks', {
    query: '?select=id,symbol,name,price,total_supply&symbol=eq.' + encode(symbol) + '&limit=1'
  });
  const stock = stocks?.[0];
  if (!stock) throw new Error('STOCK_NOT_FOUND');

  const holdings = await request('stock_holdings', {
    query: '?select=quantity&stock_id=eq.' + encode(stock.id)
  });
  const marketOwned = (holdings || []).reduce((sum, row) => sum + Number(row.quantity || 0), 0);
  const available = Number(stock.total_supply) - marketOwned;
  if (Number(quantity) > available) throw new Error('INSUFFICIENT_SUPPLY');

  const existing = await request('stock_holdings', {
    query: '?select=stock_id,quantity&discord_id=eq.' + encode(discordId) + '&stock_id=eq.' + encode(stock.id) + '&limit=1'
  });
  const currentQuantity = Number(existing?.[0]?.quantity || 0);
  const newQuantity = currentQuantity + Number(quantity);

  if (existing?.[0]) {
    await request('stock_holdings', {
      method: 'PATCH',
      query: '?discord_id=eq.' + encode(discordId) + '&stock_id=eq.' + encode(stock.id),
      body: { quantity: newQuantity },
      prefer: 'return=minimal'
    });
  } else {
    await request('stock_holdings', {
      method: 'POST',
      body: [{ discord_id: discordId, stock_id: stock.id, quantity: Number(quantity) }],
      prefer: 'return=minimal'
    });
  }

  const oldPrice = Number(stock.price);
  const priceIncrease = Number((oldPrice * (Number(quantity) / Number(stock.total_supply)) * 0.5).toFixed(2));
  const newPrice = Math.max(0.01, Number((oldPrice + priceIncrease).toFixed(2)));
  await request('stocks', {
    method: 'PATCH',
    query: '?id=eq.' + encode(stock.id),
    body: { price: newPrice },
    prefer: 'return=minimal'
  });

  return {
    stock: { ...stock, price: newPrice },
    quantity: newQuantity,
    totalValue: newQuantity * newPrice,
    available: available - Number(quantity)
  };
}

export async function sellStock(discordId, symbol, quantity) {
  const stocks = await request('stocks', {
    query: '?select=id,symbol,name,price,total_supply&symbol=eq.' + encode(symbol) + '&limit=1'
  });
  const stock = stocks?.[0];
  if (!stock) throw new Error('STOCK_NOT_FOUND');

  const existing = await request('stock_holdings', {
    query: '?select=stock_id,quantity&discord_id=eq.' + encode(discordId) + '&stock_id=eq.' + encode(stock.id) + '&limit=1'
  });
  const currentQuantity = Number(existing?.[0]?.quantity || 0);
  if (currentQuantity < Number(quantity)) throw new Error('INSUFFICIENT_SHARES');

  const newQuantity = currentQuantity - Number(quantity);
  if (newQuantity === 0) {
    await request('stock_holdings', {
      method: 'DELETE',
      query: '?discord_id=eq.' + encode(discordId) + '&stock_id=eq.' + encode(stock.id)
    });
  } else {
    await request('stock_holdings', {
      method: 'PATCH',
      query: '?discord_id=eq.' + encode(discordId) + '&stock_id=eq.' + encode(stock.id),
      body: { quantity: newQuantity },
      prefer: 'return=minimal'
    });
  }

  const oldPrice = Number(stock.price);
  const priceDecrease = Number((oldPrice * (Number(quantity) / Number(stock.total_supply)) * 0.5).toFixed(2));
  const newPrice = Math.max(0.01, Number((oldPrice - priceDecrease).toFixed(2)));
  await request('stocks', {
    method: 'PATCH',
    query: '?id=eq.' + encode(stock.id),
    body: { price: newPrice },
    prefer: 'return=minimal'
  });

  return {
    stock: { ...stock, price: newPrice },
    quantity: Number(quantity),
    totalValue: Number(quantity) * newPrice
  };
}

export { request };
