import { PermissionFlagsBits } from 'discord.js';
import { config } from './config.js';
import { getChannelMode, removeChannelMode, setChannelMode, getUserMemories, supabase } from './db.js';

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
    `\`${config.prefix}main [#channel]\` — make a channel MAIN`,
    `\`${config.prefix}unmain [#channel]\` — remove MAIN mode`,
    `\`${config.prefix}semi [#channel]\` — make a channel SEMI-ACTIVE`,
    `\`${config.prefix}unsemi [#channel]\` — remove SEMI-ACTIVE mode`,
    `\`${config.prefix}block [#channel]\` — make a channel completely silent`,
    `\`${config.prefix}unblock [#channel]\` — remove BLOCKED mode`,
    `\`${config.prefix}channels\` — show configured channels`,
    `\`${config.prefix}memory\` — show your stored memories`,
    `\`${config.prefix}forget\` — delete all of your stored memories`,
    `\`${config.prefix}help\` — show this help`
  ].join('\n');
}

export async function handleCommand(message) {
  const body = message.content.slice(config.prefix.length).trim();
  const [command] = body.split(/\s+/);
  const name = command?.toLowerCase();

  if (!name) return true;

  if (['main', 'unmain', 'semi', 'unsemi', 'block', 'unblock'].includes(name)) {
    if (!isAdmin(message)) {
      await message.reply('You need **Manage Server** permission to change Elias channel modes.');
      return true;
    }

    const channel = targetChannel(message);

    if (name === 'main') {
      await setChannelMode(config.guildId, channel.id, 'main');
      await message.reply(`✅ ${channel} is now a **MAIN** Elias channel.`);
      return true;
    }

    if (name === 'semi') {
      await setChannelMode(config.guildId, channel.id, 'semi');
      await message.reply(`✅ ${channel} is now a **SEMI-ACTIVE** Elias channel.`);
      return true;
    }

    if (name === 'block') {
      await setChannelMode(config.guildId, channel.id, 'blocked');
      await message.reply(`🔒 ${channel} is now **BLOCKED**. Elias will not talk there.`);
      return true;
    }

    if (name === 'unmain' || name === 'unsemi' || name === 'unblock') {
      const current = await getChannelMode(config.guildId, channel.id);
      const expected = name.slice(3);
      const expectedMode = expected === 'main' ? 'main' : expected === 'semi' ? 'semi' : 'blocked';

      if (current === expectedMode) {
        await removeChannelMode(config.guildId, channel.id);
        await message.reply(`✅ Removed **${expectedMode.toUpperCase()}** mode from ${channel}. Elias will stay silent there until another mode is set.`);
      } else {
        await message.reply(`That channel is not currently **${expectedMode.toUpperCase()}**.`);
      }
      return true;
    }
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

    if (!memories.length) {
      await message.reply('I don\'t have any saved memories about you yet.');
      return true;
    }

    const lines = memories.map((memory, index) => `${index + 1}. ${memory.memory}`);
    await message.reply(`**What I remember about you:**\n${lines.join('\n')}`);
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
