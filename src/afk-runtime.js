import { Client } from 'discord.js';
import { config } from './config.js';
import {
  endUserAfk,
  getUserAfk,
  handleAfkPing,
  parseAfkRequest,
  setUserAfk
} from './afk.js';

const lastMessageChannels = new Map();
const PATCH_MARKER = Symbol.for('elias.afkRuntimePatched');

export function getLastMessageChannel(guildId, userId) {
  return lastMessageChannels.get(`${guildId}:${userId}`) || null;
}

async function sendChannelMessage(message, content) {
  try {
    await message.channel.send({ content, allowedMentions: { parse: [] } });
  } catch (error) {
    console.error('Failed to send AFK notice:', error?.message || error);
  }
}

function isAfkCommand(content) {
  const prefix = String(config.prefix || '.');
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escapedPrefix}afk(?:\\s|$)`, 'i').test(String(content || '').trim());
}

if (!Client.prototype[PATCH_MARKER]) {
  const originalOn = Client.prototype.on;

  Client.prototype.on = function patchedOn(event, listener) {
    if (event !== 'messageCreate' || typeof listener !== 'function') {
      return originalOn.call(this, event, listener);
    }

    const wrappedListener = async (...args) => {
      const message = args[0];
      if (!message || !message.guild || message.author?.bot) {
        return listener(...args);
      }

      const guildId = message.guild.id;
      const userId = message.author.id;
      lastMessageChannels.set(`${guildId}:${userId}`, message.channelId);

      if (guildId !== config.guildId) {
        return listener(...args);
      }

      try {
        const afkRequest = parseAfkRequest(message.content);
        if (afkRequest) {
          const reply = await setUserAfk({ guildId, user: message.author, reason: afkRequest.reason });
          if (reply) await sendChannelMessage(message, reply);
          return;
        }

        const currentAfk = await getUserAfk(guildId, userId);
        if (currentAfk && !isAfkCommand(message.content)) {
          const ended = await endUserAfk({ guildId, discordId: userId });
          if (ended) await sendChannelMessage(message, ended.message);
        }

        const mentionedUsers = message.mentions?.users;
        if (mentionedUsers?.size) {
          for (const target of mentionedUsers.values()) {
            if (!target || target.id === userId || target.bot) continue;
            const notice = await handleAfkPing({
              guildId,
              targetUser: target,
              pingedBy: message.member
                ? {
                    id: userId,
                    username: message.author.username,
                    displayName: message.member.displayName || message.author.username
                  }
                : {
                    id: userId,
                    username: message.author.username,
                    displayName: message.author.username
                  }
            });
            if (notice) await sendChannelMessage(message, notice);
          }
        }
      } catch (error) {
        console.error('AFK handler error:', error?.message || error);
      }

      return listener(...args);
    };

    return originalOn.call(this, event, wrappedListener);
  };

  Object.defineProperty(Client.prototype, PATCH_MARKER, { value: true });
}
