import { createAfk, getAfk, recordAfkPing, removeAfk } from './db.js';

const TIMEZONE = 'Asia/Kolkata';

function formatDuration(startedAt, endedAt = new Date()) {
  let seconds = Math.max(0, Math.floor((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000));
  const days = Math.floor(seconds / 86_400); seconds %= 86_400;
  const hours = Math.floor(seconds / 3_600); seconds %= 3_600;
  const minutes = Math.floor(seconds / 60); seconds %= 60;

  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (!parts.length) parts.push(`${seconds}s`);
  return parts.join(' ');
}

function startedRelative(startedAt) {
  const timestamp = Math.floor(new Date(startedAt).getTime() / 1000);
  return `<t:${timestamp}:R>`;
}

export function parseAfkRequest(content) {
  const text = String(content || '').trim();
  if (!/\b(?:i(?:'m| am)|im)\s+(?:going|gonna|going to)\s+afk\b/i.test(text)) return null;

  const match = text.match(/\b(?:i(?:'m| am)|im)\s+(?:going|gonna|going to)\s+afk\b([\s\S]*)/i);
  const trailing = match?.[1]?.trim() || '';
  const reason = trailing
    .replace(/^[,!:;\-\s]+/, '')
    .replace(/^to\s+/i, '')
    .trim()
    .replace(/[.!?]+$/, '')
    .trim();

  return {
    reason: reason && reason.length <= 200 ? reason : null
  };
}

export function formatAfkSet(afk) {
  const reason = afk.reason ? ` for **${afk.reason}**` : '';
  return `💤 You're now AFK${reason} — since ${startedRelative(afk.started_at)}.`;
}

export function formatAfkMention(afk, pingCount) {
  const reason = afk.reason ? ` — **${afk.reason}**` : '';
  return `💤 **${afk.display_name || afk.username}** is AFK${reason}. They've been away since ${startedRelative(afk.started_at)} and have been pinged **${pingCount} ${pingCount === 1 ? 'time' : 'times'}** during this AFK session.`;
}

export function formatAfkEnded(afk, endedAt = new Date()) {
  const duration = formatDuration(afk.started_at, endedAt);
  const pingers = Array.isArray(afk.pingers) ? afk.pingers : [];
  const total = Number(afk.mention_count) || 0;

  if (!total) {
    return `💤 Welcome back! You were AFK for **${duration}**. Nobody pinged you while you were away.`;
  }

  const details = pingers
    .map((entry) => `<@${entry.user_id}> × ${entry.count}`)
    .join(', ');

  return `💤 Welcome back! You were AFK for **${duration}** and got pinged **${total} ${total === 1 ? 'time' : 'times'}** by ${details}.`;
}

export async function setUserAfk({ guildId, user, reason }) {
  const afk = await createAfk({
    guildId,
    discordId: user.id,
    username: user.username,
    displayName: user.displayName || user.username,
    reason,
    startedAt: new Date().toISOString()
  });
  return afk ? formatAfkSet(afk) : null;
}

export async function getUserAfk(guildId, discordId) {
  return getAfk(guildId, discordId);
}

export async function handleAfkPing({ guildId, targetUser, pingedBy }) {
  const afk = await getAfk(guildId, targetUser.id);
  if (!afk) return null;

  const updated = await recordAfkPing(guildId, targetUser.id, {
    userId: pingedBy.id,
    username: pingedBy.username,
    displayName: pingedBy.displayName || pingedBy.username
  });

  const count = Number(updated?.mention_count) || Number(afk.mention_count) + 1;
  return formatAfkMention({ ...afk, ...updated }, count);
}

export async function endUserAfk({ guildId, discordId }) {
  const afk = await getAfk(guildId, discordId);
  if (!afk) return null;
  const ended = await removeAfk(guildId, discordId);
  if (!ended) return null;
  return { message: formatAfkEnded(afk), afk };
}

export function formatAfkStartedAt(afk) {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: TIMEZONE,
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(afk.started_at));
}
