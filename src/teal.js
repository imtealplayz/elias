import { config } from './config.js';
import { request } from './db.js';

export const TEAL = 'Teal';

export const COLORS = {
  gold: 0xF4C542,
  green: 0x2ECC71,
  red: 0xE74C3C,
  blue: 0x5865F2,
  purple: 0x9B59B6,
  teal: 0x00C2B8
};

export function baseEmbed(title, color = COLORS.gold) {
  const { EmbedBuilder } = requireDiscord();
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setTimestamp()
    .setFooter({ text: 'Teal Economy • Elias' });
}

// Keep the wallet layer independent from command/game modules.
function requireDiscord() {
  // This function exists only to avoid making command/UI imports part of the
  // low-level wallet API.
  return globalThis.__eliasDiscord || {};
}

async function getUser(guildId, discordId) {
  const rows = await request('teal_economy', {
    query: `?select=guild_id,discord_id,balance,total_wagered,stats,updated_at&guild_id=eq.${encode(guildId)}&discord_id=eq.${encode(discordId)}&limit=1`
  });

  if (rows?.[0]) {
    return {
      ...rows[0],
      balance: Number(rows[0].balance || 0),
      total_wagered: Number(rows[0].total_wagered || 0),
      stats: rows[0].stats && typeof rows[0].stats === 'object' ? rows[0].stats : {}
    };
  }

  const created = await request('teal_economy', {
    method: 'POST',
    body: [{ guild_id: guildId, discord_id: discordId, balance: 0, total_wagered: 0, stats: {} }],
    prefer: 'return=representation'
  });

  const row = created?.[0] || {
    guild_id: guildId,
    discord_id: discordId,
    balance: 0,
    total_wagered: 0,
    stats: {}
  };

  return {
    ...row,
    balance: Number(row.balance || 0),
    total_wagered: Number(row.total_wagered || 0),
    stats: row.stats && typeof row.stats === 'object' ? row.stats : {}
  };
}

async function saveUser(user) {
  const rows = await request('teal_economy', {
    method: 'PATCH',
    query: `?guild_id=eq.${encode(user.guild_id)}&discord_id=eq.${encode(user.discord_id)}`,
    body: {
      balance: Math.max(0, Math.floor(Number(user.balance) || 0)),
      total_wagered: Math.max(0, Math.floor(Number(user.total_wagered) || 0)),
      stats: user.stats && typeof user.stats === 'object' ? user.stats : {},
      updated_at: new Date().toISOString()
    },
    prefer: 'return=representation'
  });
  return rows?.[0] || null;
}

export async function getBalance(guildId, discordId) {
  return (await getUser(guildId, discordId)).balance;
}

export async function setBalance(guildId, discordId, amount) {
  const user = await getUser(guildId, discordId);
  user.balance = Math.max(0, Math.floor(Number(amount) || 0));
  await saveUser(user);
  return user.balance;
}

export async function addBalance(guildId, discordId, amount) {
  const value = Math.floor(Number(amount) || 0);
  if (value <= 0) return getBalance(guildId, discordId);
  const user = await getUser(guildId, discordId);
  user.balance += value;
  await saveUser(user);
  return user.balance;
}

export async function removeBalance(guildId, discordId, amount) {
  const value = Math.floor(Number(amount) || 0);
  if (value <= 0) return getBalance(guildId, discordId);

  const user = await getUser(guildId, discordId);
  if (user.balance < value) {
    const error = new Error('INSUFFICIENT_FUNDS');
    error.balance = user.balance;
    throw error;
  }

  user.balance -= value;
  await saveUser(user);
  return user.balance;
}

export async function recordGame(guildId, discordId, game, bet, profit) {
  const user = await getUser(guildId, discordId);
  const wager = Math.max(0, Math.floor(Number(bet) || 0));
  const numericProfit = Math.floor(Number(profit) || 0);

  user.total_wagered += wager;

  if (!user.stats[game]) {
    user.stats[game] = { wagered: 0, wins: 0, losses: 0, profit: 0 };
  }

  user.stats[game].wagered = Number(user.stats[game].wagered || 0) + wager;
  user.stats[game].profit = Number(user.stats[game].profit || 0) + numericProfit;

  if (numericProfit > 0) user.stats[game].wins = Number(user.stats[game].wins || 0) + 1;
  else if (numericProfit < 0) user.stats[game].losses = Number(user.stats[game].losses || 0) + 1;

  await saveUser(user);
  return user;
}

export async function getEconomyProfile(guildId, discordId) {
  return getUser(guildId, discordId);
}

export async function getLeaderboard(guildId, limit = 10) {
  return request('teal_economy', {
    query: `?select=discord_id,balance,total_wagered&guild_id=eq.${encode(guildId)}&order=balance.desc&limit=${Math.max(1, Math.min(25, Number(limit) || 10))}`
  }).then((rows) => (rows || []).map((row) => ({
    ...row,
    balance: Number(row.balance || 0),
    total_wagered: Number(row.total_wagered || 0)
  })));
}

export async function resetBalance(guildId, discordId) {
  return setBalance(guildId, discordId, 0);
}

export function formatTeal(amount) {
  return `${Math.floor(Number(amount) || 0).toLocaleString()} ${TEAL}`;
}

export function getGuildId() {
  return config.guildId;
}

export function encode(value) {
  return encodeURIComponent(value);
}
