import { config } from './config.js';
import { createReminder, deleteReminder, getNextReminder, getPendingReminders, getUserReminders } from './db.js';

const TIMEZONE = 'Asia/Kolkata';
let schedulerTimer = null;

function parseClock(value) {
  const match = String(value || '').match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const meridiem = match[3]?.toLowerCase();
  if (minute > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === 'pm' && hour !== 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
  } else if (hour > 23) return null;
  return { hour, minute };
}

function localParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(date);
  const result = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { year: Number(result.year), month: Number(result.month), day: Number(result.day), hour: Number(result.hour), minute: Number(result.minute), second: Number(result.second) };
}

function toISTDate(year, month, day, hour, minute) {
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - (5 * 60 + 30) * 60_000);
}

function parseDuration(text) {
  const match = String(text).match(/\b(?:in|after)\s+(\d+(?:\.\d+)?)\s*(minutes?|mins?|m|hours?|hrs?|h|days?|d)\b/i);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const unit = match[2].toLowerCase();
  const multiplier = unit.startsWith('m') ? 60_000 : unit.startsWith('h') ? 3_600_000 : 86_400_000;
  return { dueAt: new Date(Date.now() + amount * multiplier), phrase: match[0] };
}

function parseAbsolute(text) {
  const match = String(text).match(/\b(today|tomorrow)\b(?:\s+at)?\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i);
  if (!match) return null;
  const clock = parseClock(match[2]);
  if (!clock) return null;
  const now = localParts();
  const date = new Date(Date.UTC(now.year, now.month - 1, now.day));
  if (match[1].toLowerCase() === 'tomorrow') date.setUTCDate(date.getUTCDate() + 1);
  const dueAt = toISTDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), clock.hour, clock.minute);
  if (dueAt.getTime() <= Date.now()) return null;
  return { dueAt, phrase: match[0] };
}

function parseAt(text) {
  const match = String(text).match(/\bat\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i);
  if (!match) return null;
  const clock = parseClock(match[1]);
  if (!clock) return null;
  const now = localParts();
  let dueAt = toISTDate(now.year, now.month, now.day, clock.hour, clock.minute);
  if (dueAt.getTime() <= Date.now()) {
    const date = new Date(Date.UTC(now.year, now.month - 1, now.day + 1));
    dueAt = toISTDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), clock.hour, clock.minute);
  }
  return { dueAt, phrase: match[0] };
}

function taskFrom(text, phrase) {
  return String(text)
    .replace(/^\s*(?:elias[,!]?\s*)?/i, '')
    .replace(/^\s*(?:please\s+)?(?:remind|reminder)\s+(?:me|us)\s*(?:to)?\s*/i, '')
    .replace(/^\s*(?:set|make|create)\s+(?:a\s+)?reminder\s*(?:for)?\s*/i, '')
    .replace(phrase, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[,.:;\-\s]+|[,.:;\-\s]+$/g, '')
    .trim();
}

export function parseReminderRequest(content) {
  const text = String(content || '').trim();
  if (!/\b(?:remind me|reminder|set a reminder|remember to|don't let me forget)\b/i.test(text)) return null;
  const timing = parseDuration(text) || parseAbsolute(text) || parseAt(text);
  if (!timing) return null;
  const task = taskFrom(text, timing.phrase);
  if (!task || task.length > 300) return null;
  const maxDelay = 365 * 24 * 60 * 60 * 1000;
  if (timing.dueAt.getTime() <= Date.now() || timing.dueAt.getTime() > Date.now() + maxDelay) return null;
  return { task, dueAt: timing.dueAt };
}

export function parseReminderQuestion(content) {
  const text = String(content || '').trim();
  if (/^\s*(?:what are|show|list)\s+(?:my\s+)?reminders?\s*\??\s*$/i.test(text)) return { type: 'list' };
  if (/\b(?:cancel|remove|delete|forget)\b[\s\S]{0,80}\breminders?\b/i.test(text)) {
    const target = text.replace(/\b(?:cancel|remove|delete|forget)\b/gi, ' ').replace(/\b(?:my|the|a|an)?\s*reminders?\b/gi, ' ').replace(/\s+/g, ' ').trim();
    return { type: 'cancel', target: target || null };
  }
  return null;
}

function tokens(value) {
  return new Set(String(value || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((word) => word.length >= 3));
}

export function chooseReminder(reminders, target) {
  if (!reminders.length) return null;
  if (!target) return reminders[0];
  const wanted = tokens(target);
  return reminders
    .map((reminder) => {
      const taskTokens = tokens(reminder.task);
      let overlap = 0;
      for (const word of wanted) if (taskTokens.has(word)) overlap++;
      return { reminder, score: overlap };
    })
    .sort((a, b) => b.score - a.score)[0]?.reminder || null;
}

export function formatReminderCreated(reminder) {
  const timestamp = Math.floor(new Date(reminder.due_at || reminder.dueAt).getTime() / 1000);
  return `⏰ Got it — I'll remind you to **${reminder.task}** <t:${timestamp}:R> (<t:${timestamp}:f>).`;
}

export function formatReminderList(reminders) {
  if (!reminders.length) return "You don't have any pending reminders.";
  const formatter = new Intl.DateTimeFormat('en-IN', { timeZone: TIMEZONE, dateStyle: 'medium', timeStyle: 'short' });
  return `⏰ **Your pending reminders**\n${reminders.slice(0, 10).map((item, index) => `${index + 1}. **${item.task}** — ${formatter.format(new Date(item.due_at))} IST`).join('\n')}`;
}

export async function handleReminderRequest({ content, guildId, userId }) {
  const create = parseReminderRequest(content);
  if (create) {
    const reminder = await createReminder({ guildId, discordId: userId, channelId: 'dm', task: create.task, dueAt: create.dueAt.toISOString() });
    if (!reminder) return null;
    scheduleNextReminder().catch((error) => console.error('Failed to schedule new reminder:', error?.message || error));
    return formatReminderCreated(reminder);
  }

  const management = parseReminderQuestion(content);
  if (!management) return null;

  const reminders = await getUserReminders(guildId, userId, 10);
  if (management.type === 'list') return formatReminderList(reminders);

  const selected = chooseReminder(reminders, management.target);
  if (!selected) return "I couldn't find a pending reminder matching that.";
  await deleteReminder(selected.id);
  scheduleNextReminder().catch((error) => console.error('Failed to reschedule after reminder cancellation:', error?.message || error));
  return `✅ Cancelled your reminder: **${selected.task}**.`;
}

async function discordApi(path, options = {}) {
  const response = await fetch(`https://discord.com/api/v10${path}`, {
    ...options,
    headers: { Authorization: `Bot ${config.token}`, 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Discord API ${response.status}: ${JSON.stringify(data)}`);
  return data;
}

async function getOrCreateDm(userId) {
  const channel = await discordApi('/users/@me/channels', {
    method: 'POST', body: JSON.stringify({ recipient_id: userId })
  });
  return channel.id;
}

async function getServerChannelId(guildId) {
  const guild = await discordApi(`/guilds/${guildId}`);
  const channels = await discordApi(`/guilds/${guildId}/channels`);
  const usable = Array.isArray(channels)
    ? channels.filter((channel) => channel.type === 0 || channel.type === 5)
    : [];

  const systemChannel = usable.find((channel) => channel.id === guild.system_channel_id);
  if (systemChannel) return systemChannel.id;

  const general = usable.find((channel) => /^(general|chat|main)$/i.test(channel.name || ''));
  if (general) return general.id;

  return usable.sort((a, b) => (a.position ?? 0) - (b.position ?? 0))[0]?.id || null;
}

async function sendReminder(reminder) {
  let delivered = false;

  try {
    const dmChannelId = await getOrCreateDm(reminder.discord_id);
    await discordApi(`/channels/${dmChannelId}/messages`, {
      method: 'POST', body: JSON.stringify({ content: `⏰ **Reminder:** ${reminder.task}` })
    });
    delivered = true;
  } catch (error) {
    console.error(`Failed to DM reminder ${reminder.id}:`, error?.message || error);
  }

  try {
    const serverChannelId = reminder.channel_id !== 'dm'
      ? reminder.channel_id
      : await getServerChannelId(reminder.guild_id);

    if (!serverChannelId) throw new Error('No usable server text channel was found.');

    await discordApi(`/channels/${serverChannelId}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        content: `⏰ <@${reminder.discord_id}> **Reminder:** ${reminder.task}`,
        allowed_mentions: { users: [reminder.discord_id] }
      })
    });
    delivered = true;
  } catch (error) {
    console.error(`Failed to post server reminder ${reminder.id}:`, error?.message || error);
  }

  if (!delivered) throw new Error('Reminder could not be delivered to either Discord destination.');
}

export async function processDueReminders() {
  const due = await getPendingReminders(new Date().toISOString(), 100);
  for (const reminder of due) {
    try {
      await sendReminder(reminder);
      await deleteReminder(reminder.id);
    } catch (error) {
      console.error(`Failed to deliver reminder ${reminder.id}:`, error?.message || error);
      // Leave the row in Supabase so a transient Discord/API error can be retried.
    }
  }
}

export async function scheduleNextReminder() {
  if (schedulerTimer) clearTimeout(schedulerTimer);
  schedulerTimer = null;

  await processDueReminders();
  const next = await getNextReminder();
  if (!next) return;

  const delay = Math.max(1000, new Date(next.due_at).getTime() - Date.now());
  schedulerTimer = setTimeout(() => {
    scheduleNextReminder().catch((error) => console.error('Reminder scheduler error:', error));
  }, delay);
  schedulerTimer.unref?.();
}

scheduleNextReminder().catch((error) => console.error('Failed to start reminder scheduler:', error));
