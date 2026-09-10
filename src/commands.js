import { PermissionFlagsBits } from 'discord.js';
import { config } from './config.js';
import {
  getChannelMode,
  removeChannelMode,
  setChannelMode,
  getUserMemories,
  supabase
} from './db.js';

function targetChannel(message) {
  return message.mentions.channels.first() || message.channel;
}

function isAdmin(message) {
  return message.member?.permissions.has(PermissionFlagsBits.ManageGuild) ||
    message.member?.permissions.has(PermissionFlagsBits.Administrator);
}

function helpText() {
  return [
    '**Elias commands**',
    `\\${config.prefix}main [#channel]\\` — make a channel MAIN`,
    `\\${config.prefix}unmain [#channel]\\` — remove MAIN mode`,
    `\\${config.prefix}semi [#channel]\\` — make a channel SEMI-ACTIVE`,
    `\\${config.prefix}unsemi [#channel]\\` — remove SEMI-ACTIVE mode`,
    `\\${config.prefix}block [#channel]\\` — make a channel completely silent`,
    `\\${config.prefix}unblock [#channel]\\` — remove BLOCKED mode`,
    `\\${config.prefix}channels\\` — show configured channels`,
    `\\${config.prefix}memory\\` — DM your stored memories`,
    `\\${config.prefix}forget\\` — delete all of your stored memories`,
    `\\${config.prefix}help\\` — show this help`
  ].join('\n');
}

const commandModes = {
  main: 'main',
  unmain: 'main',
  semi: 'semi',
  unsemi: 'semi',
  block: 'blocked',
  unblock: 'blocked'
};

export async function handleCommand(message) {
  const body = message.content.slice(config.prefix.length).trim();
  const [command] = body.split(/\s+/);
  const name = command?.toLowerCase();

  if (!name) return true;

  if (Object.hasOwn(commandModes, name)) {
    if (!isAdmin(message)) {
      await message.reply('You need **Manage Server** permission to change Elias channel modes.');
      return true;
    }

    const channel = targetChannel(message);
    const mode = commandModes[name];
    const isRemoval = name.startsWith('un');

    if (isRemoval) {
      const current = await getChannelMode(config.guildId, channel.id);

      if (current === mode) {
        await removeChannelMode(config.guildId, channel.id);
        await message.reply(`✅ Removed **${mode.toUpperCase()}** mode from ${channel}. Elias will stay silent there until another mode is set.`);
      } else {
        await message.reply(`That channel is not currently **${mode.toUpperCase()}**.`);
      }
      return true;
    }

    await setChannelMode(config.guildId, channel.id, mode);

    const labels = {
      main: 'MAIN',
      semi: 'SEMI-ACTIVE',
      blocked: 'BLOCKED'
    };

    const descriptions = {
      main: 'Elias will actively reply to messages there.',
      semi: 'Elias will reply when addressed and occasionally jump into conversation.',
      blocked: 'Elias will never respond to normal messages there.'
    };

    await message.reply(`✅ ${channel} is now **${labels[mode]}**. ${descriptions[mode]}`);
    return true;
  }

  if (name === 'channels') {
    if (!isAdmin(message)) {
      await message.reply('You need **Manage Server** permission to view Elias channel configuration.');
      return true;
    }

    const { data, error } = await supabase
      .from('channels')
      .select('channel_id, mode')
      .eq('guild_id', config.guildId)
      .order('mode');

    if (error) throw error;

    if (!data?.length) {
      await message.reply('No Elias channels are configured yet.');
      return true;
    }

    const lines = data.map((row) => `<#${row.channel_id}> → **${row.mode.toUpperCase()}**`);
    await message.reply(lines.join('\n'));
    return true;
  }

  if (name === 'memory') {
    const memories = await getUserMemories(config.guildId, message.author.id, config.maxMemoriesPerUser);
    const text = memories.length
      ? memories.map((memory, index) => `${index + 1}. ${memory.memory}`).join('\n')
      : 'I don\'t have any saved memories about you yet.';

    try {
      await message.author.send(`**What ${config.botName} remembers about you:**\n${text}`);
      await message.react('📬');
    } catch {
      await message.reply('I couldn\'t DM you. Please enable DMs from server members and try again.');
    }
    return true;
  }

  if (name === 'forget') {
    const { error } = await supabase
      .from('memories')
      .delete()
      .eq('guild_id', config.guildId)
      .eq('discord_id', message.author.id);

    if (error) throw error;
    await message.reply('🧠✅ Deleted all memories I had stored about you.');
    return true;
  }

  if (name === 'help') {
    await message.reply(helpText());
    return true;
  }

  return false;
}
