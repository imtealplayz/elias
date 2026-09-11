import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { config } from './config.js';
import {
  deleteMemoryIds,
  getChannelMode,
  getRecentMessages,
  getUserMemories,
  saveMemories,
  saveMessage,
  upsertUser
} from './db.js';
import { decideSpontaneousReply, generateReply, getGeminiRetryAfterMs, isGeminiRateLimitError } from './ai.js';
import {
  decideSpontaneousReplyFallback,
  generateReplyFallback,
  getGroqRetryAfterMs,
  isGroqRateLimitError
} from './groq-fallback.js';
import { summarizeMessages } from './summarize.js';
import { handleCommand } from './commands.js';
import { handleTicTacToeInteraction, isTicTacToeRequest, startTicTacToe } from './games/tictactoe.js';

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel]
});

const spontaneousCooldowns = new Map();
const channelQueues = new Map();
const processedMessageIds = new Set();
let aiRateLimitedUntil = 0;
const rateLimitNotices = new Map();

function queueForChannel(channelId, task) {
  const previous = channelQueues.get(channelId) || Promise.resolve();
  const next = previous.catch(() => undefined).then(task).finally(() => {
    if (channelQueues.get(channelId) === next) channelQueues.delete(channelId);
  });
  channelQueues.set(channelId, next);
  return next;
}

function markMessageProcessed(messageId) {
  if (processedMessageIds.has(messageId)) return false;
  processedMessageIds.add(messageId);
  setTimeout(() => processedMessageIds.delete(messageId), 10 * 60 * 1000).unref?.();
  return true;
}

function isAiTemporarilyUnavailable() {
  return Date.now() < aiRateLimitedUntil;
}

function isProviderRateLimitError(error) {
  return isGeminiRateLimitError(error) || isGroqRateLimitError(error);
}

function getRetryAfterMs(error) {
  if (isGeminiRateLimitError(error)) return getGeminiRetryAfterMs(error);
  if (isGroqRateLimitError(error)) return getGroqRetryAfterMs(error);
  return 60 * 1000;
}

function markAiRateLimited(error) {
  aiRateLimitedUntil = Math.max(aiRateLimitedUntil, Date.now() + getRetryAfterMs(error));
  console.warn(`Both AI providers appear unavailable until ${new Date(aiRateLimitedUntil).toISOString()}`);
}

async function sendRateLimitNotice(message) {
  const now = Date.now();
  const lastNotice = rateLimitNotices.get(message.channelId) || 0;
  if (now - lastNotice < 10 * 60 * 1000) return;
  rateLimitNotices.set(message.channelId, now);
  const waitSeconds = Math.max(1, Math.ceil((aiRateLimitedUntil - now) / 1000));
  await message.channel.send(`⏳ I'm temporarily rate-limited by the AI services. Try me again in about ${waitSeconds}s.`);
}

function cleanContent(message) {
  let content = message.content.trim();
  if (client.user) content = content.replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '').trim();
  return content || message.content.trim();
}

function containsNameMention(content) {
  const escaped = config.botName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i').test(content);
}

async function isReplyToElias(message) {
  if (!message.reference?.messageId) return false;
  try {
    const referenced = message.referencedMessage || await message.fetchReference();
    return referenced?.author?.id === client.user?.id;
  } catch {
    return false;
  }
}

function extractExplicitMemories(content) {
  const memories = [];
  const patterns = [
    /^(?:my name is|call me|i(?:'| a)m called)\s+([A-Za-z][A-Za-z0-9_-]{1,31})[.!?]?$/i,
    /^(?:please call me)\s+([A-Za-z][A-Za-z0-9_-]{1,31})[.!?]?$/i
  ];
  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (!match) continue;
    memories.push({ memory: `User prefers to be called ${match[1].trim()}`, importance: 1 });
    break;
  }
  return memories;
}

function mergeMemories(...groups) {
  const merged = [];
  const seen = new Set();
  for (const group of groups) {
    for (const item of group || []) {
      if (typeof item?.memory !== 'string' || !item.memory.trim()) continue;
      const memory = item.memory.trim().replace(/\s+/g, ' ').slice(0, 500);
      const key = memory.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push({ memory, importance: Math.min(1, Math.max(0, Number(item.importance) || 0.5)) });
    }
  }
  return merged;
}

function getSummaryCount(content) {
  const match = content.match(/\bsummar(?:y|ize|ise|ized|ised|izing|ising)\b[\s\S]*?\blast\s+(\d{1,3})\s+messages?\b/i);
  if (match) return Math.min(100, Math.max(1, Number(match[1])));
  if (/\bsummar(?:y|ize|ise)\b/i.test(content)) return 20;
  return null;
}

function isMemoryForgetRequest(content) {
  return /\b(?:forget|remove|delete|erase)\b[\s\S]{0,180}\b(?:this|that|it|thing|memory|about|regarding|from memory|from your memory)\b/i.test(content)
    || /\b(?:forget|remove|delete|erase)\s+(?:the|my|that|this)?\s*(?:memory|memories)\b/i.test(content)
    || /\b(?:forget|remove|delete|erase)\s+(?:about|regarding)\b/i.test(content);
}

function tokenizeForMemoryMatch(text) {
  return new Set(
    String(text || '')
      .toLowerCase()
      .replace(/colour/g, 'color')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length >= 3 && !new Set([
        'the', 'and', 'that', 'this', 'about', 'with', 'from', 'your', 'you', 'for', 'are',
        'was', 'were', 'have', 'has', 'had', 'into', 'just', 'like', 'dont', 'does', 'did',
        'not', 'its', 'her', 'his', 'she', 'him', 'them', 'they', 'thing', 'thingy'
      ]).has(word))
  );
}

function pickMemoriesToForget(content, memories, history) {
  if (!isMemoryForgetRequest(content) || !memories?.length) return [];

  const vagueReference = /\b(?:forget|remove|delete|erase)\s+(?:about\s+)?(?:this|that|it|thing|thingy)\b/i.test(content)
    || /\b(?:forget|remove|delete|erase)\s+(?:this|that|it)\b/i.test(content);

  const explicitTarget = vagueReference
    ? ''
    : content
      .replace(/\b(?:please\s+)?(?:forget|remove|delete|erase)\b/gi, ' ')
      .replace(/\b(?:about|regarding|from your memory|from memory|this|that|it)\b/gi, ' ')
      .replace(/[.!?,:;]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const context = vagueReference
    ? (history || []).slice(-4).map((message) => message.content).join(' ')
    : explicitTarget;

  const targetTokens = tokenizeForMemoryMatch(context);
  if (!targetTokens.size) return [];

  const scored = memories
    .map((memory) => {
      const memoryTokens = tokenizeForMemoryMatch(memory.memory);
      let overlap = 0;
      for (const token of targetTokens) {
        if (memoryTokens.has(token)) overlap++;
      }

      const memoryText = String(memory.memory || '').toLowerCase().replace(/colour/g, 'color');
      const targetText = String(context || '').toLowerCase().replace(/colour/g, 'color');
      const substringBoost = targetText.length >= 5 && memoryText.includes(targetText) ? 2 : 0;

      return { memory, score: overlap + substringBoost };
    })
    .filter((entry) => entry.score >= 1)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  if (!scored.length) return [];

  if (vagueReference && scored[0].score < 2) return [];
  return scored.map((entry) => entry.memory);
}

async function forgetRelevantMemories({ content, memories, history, guildId, discordId }) {
  const selected = pickMemoriesToForget(content, memories, history);
  if (!selected.length) return { deleted: 0, remainingMemories: memories };

  const ids = selected.map((memory) => memory.id);
  const deleted = await deleteMemoryIds(guildId, discordId, ids);
  const deletedSet = new Set(ids.map(Number));
  const remainingMemories = memories.filter((memory) => !deletedSet.has(Number(memory.id)));

  console.log(`Deleted ${deleted} memory item(s) for ${discordId} after explicit forget request.`);
  return { deleted, remainingMemories };
}

async function handleSummaryRequest(message, content) {
  const count = getSummaryCount(content);
  if (!count) return false;
  if (isAiTemporarilyUnavailable()) {
    await sendRateLimitNotice(message);
    return true;
  }

  const fetched = await message.channel.messages.fetch({ limit: Math.min(100, count + 1) });
  const messages = [...fetched.values()].filter((item) => item.id !== message.id).sort((a, b) => a.createdTimestamp - b.createdTimestamp).slice(-count);
  if (!messages.length) {
    await message.reply({ content: "I couldn't find any messages to summarize.", allowedMentions: { repliedUser: false } });
    return true;
  }

  try {
    const summary = await summarizeMessages(messages);
    await message.reply({ content: `**Summary of the last ${messages.length} messages**\n\n${summary}`, allowedMentions: { repliedUser: false } });
  } catch (error) {
    if (isProviderRateLimitError(error)) {
      markAiRateLimited(error);
      await sendRateLimitNotice(message);
      return true;
    }
    throw error;
  }
  return true;
}

async function sendLongReply(message, reply) {
  const text = reply.trim();
  if (!text) return;
  for (let i = 0; i < text.length; i += 1900) {
    const chunk = text.slice(i, i + 1900);
    if (i === 0) await message.reply({ content: chunk, allowedMentions: { repliedUser: false } });
    else await message.channel.send(chunk);
  }
}

async function generateReplyWithFallback(payload) {
  try {
    return await generateReply(payload);
  } catch (primaryError) {
    console.warn('Gemini request failed; trying Groq fallback:', primaryError?.message || primaryError);
    try {
      return await generateReplyFallback(payload);
    } catch (fallbackError) {
      if (isProviderRateLimitError(fallbackError)) throw fallbackError;
      if (isProviderRateLimitError(primaryError)) throw primaryError;
      throw fallbackError;
    }
  }
}

async function decideSpontaneousReplyWithFallback(payload) {
  try {
    return await decideSpontaneousReply(payload);
  } catch (primaryError) {
    console.warn('Gemini classifier failed; trying Groq fallback:', primaryError?.message || primaryError);
    try {
      return await decideSpontaneousReplyFallback(payload);
    } catch (fallbackError) {
      if (isProviderRateLimitError(fallbackError)) throw fallbackError;
      if (isProviderRateLimitError(primaryError)) throw primaryError;
      throw fallbackError;
    }
  }
}

async function respondToMessage(message, mode) {
  const content = cleanContent(message);
  if (!content) return;
  if (isAiTemporarilyUnavailable()) {
    await sendRateLimitNotice(message);
    return;
  }

  const [history, loadedMemories] = await Promise.all([
    getRecentMessages(config.guildId, message.channelId, config.maxContextMessages),
    getUserMemories(config.guildId, message.author.id, config.maxMemoriesPerUser)
  ]);

  const { remainingMemories } = await forgetRelevantMemories({
    content,
    memories: loadedMemories,
    history,
    guildId: config.guildId,
    discordId: message.author.id
  });

  await upsertUser(message.author);
  await saveMessage({ guildId: message.guildId, channelId: message.channelId, userId: message.author.id, username: message.member?.displayName || message.author.username, content, isBot: false });

  try {
    const result = await generateReplyWithFallback({
      user: { username: message.member?.displayName || message.author.username, id: message.author.id },
      content,
      history,
      memories: remainingMemories,
      mode
    });
    await sendLongReply(message, result.reply);
    await saveMessage({ guildId: message.guildId, channelId: message.channelId, userId: client.user.id, username: client.user.username, content: result.reply, isBot: true });
    const allMemories = mergeMemories(extractExplicitMemories(content), result.memories);
    if (allMemories.length) await saveMemories(config.guildId, message.author.id, allMemories);
  } catch (error) {
    if (isProviderRateLimitError(error)) {
      markAiRateLimited(error);
      await sendRateLimitNotice(message);
      return;
    }
    throw error;
  }
}

async function handleSemiMessage(message, content) {
  if (isAiTemporarilyUnavailable()) return;
  const repliedToElias = await isReplyToElias(message);
  const directlyAddressed = message.mentions.has(client.user.id) || repliedToElias || containsNameMention(content);

  if (directlyAddressed) {
    if (await handleSummaryRequest(message, content)) return;
    if (isTicTacToeRequest(content)) {
      await startTicTacToe(message);
      return;
    }
    await respondToMessage(message, 'semi');
    return;
  }

  const now = Date.now();
  const lastSpontaneous = spontaneousCooldowns.get(message.channelId) || 0;
  if (now - lastSpontaneous < config.semiCooldownMs) return;
  if (Math.random() > config.spontaneousChance) return;

  const history = await getRecentMessages(config.guildId, message.channelId, config.maxContextMessages);
  try {
    const shouldReply = await decideSpontaneousReplyWithFallback({ user: { username: message.member?.displayName || message.author.username, id: message.author.id }, content, history });
    if (!shouldReply) return;
    spontaneousCooldowns.set(message.channelId, now);
    await respondToMessage(message, 'semi');
  } catch (error) {
    if (isProviderRateLimitError(error)) {
      markAiRateLimited(error);
      return;
    }
    throw error;
  }
}

client.once('ready', () => {
  console.log(`✅ ${client.user.tag} is online.`);
  console.log(`Guild lock: ${config.guildId}`);
  console.log(`Primary model: ${config.geminiModel}`);
  console.log(`Fallback model: ${config.groqModel}`);
});

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.guildId !== config.guildId) return;
    await handleTicTacToeInteraction(interaction);
  } catch (error) {
    console.error('Tic-Tac-Toe interaction error:', error);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      try { await interaction.reply({ content: '⚠️ Something went wrong with the game.', ephemeral: true }); } catch {}
    }
  }
});

client.on('messageCreate', async (message) => {
  try {
    if (message.author.bot) return;
    if (!message.guild) return;
    if (message.guild.id !== config.guildId) return;
    if (!markMessageProcessed(message.id)) return;
    if (message.content.startsWith(config.prefix)) {
      await handleCommand(message);
      return;
    }

    const mode = await getChannelMode(config.guildId, message.channelId);
    if (!mode || mode === 'blocked') return;
    const content = cleanContent(message);

    if (mode === 'main') {
      if (await handleSummaryRequest(message, content)) return;
      if (isTicTacToeRequest(content)) {
        await startTicTacToe(message);
        return;
      }
      await queueForChannel(message.channelId, () => respondToMessage(message, 'main'));
      return;
    }
    if (mode === 'semi') await queueForChannel(message.channelId, () => handleSemiMessage(message, content));
  } catch (error) {
    console.error('Message handler error:', error);
    if (message.guildId === config.guildId && !message.author.bot && message.content.length < 2000) {
      if (isProviderRateLimitError(error)) {
        markAiRateLimited(error);
        try { await sendRateLimitNotice(message); } catch {}
        return;
      }
      try { await message.channel.send('⚠️ I hit an error while thinking. Try again in a moment.'); } catch {}
    }
  }
});

process.on('unhandledRejection', (error) => console.error('Unhandled rejection:', error));
process.on('uncaughtException', (error) => console.error('Uncaught exception:', error));

client.login(config.token);
