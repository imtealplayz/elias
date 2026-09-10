import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { config } from './config.js';
import {
  getChannelMode,
  getRecentMessages,
  getUserMemories,
  saveMemories,
  saveMessage,
  upsertUser
} from './db.js';
import { decideSpontaneousReply, generateReply } from './ai.js';
import { handleCommand } from './commands.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

const spontaneousCooldowns = new Map();
const channelQueues = new Map();
const processedMessageIds = new Set();

function queueForChannel(channelId, task) {
  const previous = channelQueues.get(channelId) || Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(task)
    .finally(() => {
      if (channelQueues.get(channelId) === next) {
        channelQueues.delete(channelId);
      }
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

function cleanContent(message) {
  let content = message.content.trim();

  if (client.user) {
    content = content.replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '').trim();
  }

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

async function sendLongReply(message, reply) {
  const text = reply.trim();
  if (!text) return;

  for (let i = 0; i < text.length; i += 1900) {
    const chunk = text.slice(i, i + 1900);
    if (i === 0) {
      await message.reply({ content: chunk, allowedMentions: { repliedUser: false } });
    } else {
      await message.channel.send(chunk);
    }
  }
}

async function respondToMessage(message, mode) {
  const content = cleanContent(message);
  if (!content) return;

  // Fetch previous conversation context before inserting the current user message,
  // so the current message is not duplicated in the model input.
  const [history, memories] = await Promise.all([
    getRecentMessages(config.guildId, message.channelId, config.maxContextMessages),
    getUserMemories(config.guildId, message.author.id, config.maxMemoriesPerUser)
  ]);

  await upsertUser(message.author);
  await saveMessage({
    guildId: message.guildId,
    channelId: message.channelId,
    userId: message.author.id,
    username: message.member?.displayName || message.author.username,
    content,
    isBot: false
  });

  const result = await generateReply({
    user: {
      username: message.member?.displayName || message.author.username,
      id: message.author.id
    },
    content,
    history,
    memories,
    mode
  });

  await sendLongReply(message, result.reply);

  // Persist Elias's own response so future turns know exactly what she said.
  await saveMessage({
    guildId: message.guildId,
    channelId: message.channelId,
    userId: client.user.id,
    username: client.user.username,
    content: result.reply,
    isBot: true
  });

  if (result.memories.length) {
    await saveMemories(config.guildId, message.author.id, result.memories);
  }
}

async function handleSemiMessage(message, content) {
  const repliedToElias = await isReplyToElias(message);
  const directlyAddressed =
    message.mentions.has(client.user.id) ||
    repliedToElias ||
    containsNameMention(content);

  if (directlyAddressed) {
    await respondToMessage(message, 'semi');
    return;
  }

  const now = Date.now();
  const lastSpontaneous = spontaneousCooldowns.get(message.channelId) || 0;

  if (now - lastSpontaneous < config.semiCooldownMs) return;
  if (Math.random() > config.spontaneousChance) return;

  const history = await getRecentMessages(config.guildId, message.channelId, config.maxContextMessages);
  const shouldReply = await decideSpontaneousReply({
    user: {
      username: message.member?.displayName || message.author.username,
      id: message.author.id
    },
    content,
    history
  });

  if (!shouldReply) return;

  spontaneousCooldowns.set(message.channelId, now);
  await respondToMessage(message, 'semi');
}

client.once('ready', () => {
  console.log(`✅ ${client.user.tag} is online.`);
  console.log(`Guild lock: ${config.guildId}`);
  console.log(`Model: ${config.groqModel}`);
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

    // Unconfigured channels are silent by design.
    if (!mode || mode === 'blocked') return;

    const content = cleanContent(message);

    if (mode === 'main') {
      await queueForChannel(message.channelId, () => respondToMessage(message, 'main'));
      return;
    }

    if (mode === 'semi') {
      await queueForChannel(message.channelId, () => handleSemiMessage(message, content));
    }
  } catch (error) {
    console.error('Message handler error:', error);

    // Avoid spamming users with stack traces/API details.
    if (message.guildId === config.guildId && !message.author.bot && message.content.length < 2000) {
      try {
        await message.channel.send('⚠️ I hit an error while thinking. Try again in a moment.');
      } catch {
        // Ignore secondary Discord errors.
      }
    }
  }
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});

client.login(config.token);
