import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { config } from './config.js';
import {
  getChannelMode,
  listChannelModes,
  removeChannelMode,
  setChannelMode,
  getUserMemories,
  deleteUserMemories
} from './db.js';
import { getUserAfk, setUserAfk } from './afk.js';

function targetChannel(message) {
  return message.mentions.channels.first() || message.channel;
}

function isAdmin(message) {
  return message.member?.permissions.has(PermissionFlagsBits.ManageGuild) ||
    message.member?.permissions.has(PermissionFlagsBits.Administrator);
}

function code(text) {
  return '`' + text + '`';
}

function helpText() {
  return [
    '**Elias commands**',
    `${code(`${config.prefix}main [#channel]`)} — make a channel MAIN`,
    `${code(`${config.prefix}unmain [#channel]`)} — remove MAIN mode`,
    `${code(`${config.prefix}semi [#channel]`)} — make a channel SEMI-ACTIVE`,
    `${code(`${config.prefix}unsemi [#channel]`)} — remove SEMI-ACTIVE mode`,
    `${code(`${config.prefix}block [#channel]`)} — make a channel completely silent`,
    `${code(`${config.prefix}unblock [#channel]`)} — remove BLOCKED mode`,
    `${code(`${config.prefix}channels`)} — show configured channels`,
    `${code('.afk [reason]')} — set your AFK status`,
    `${code('.crc')} — show what you're currently watching on Crunchyroll`,
    `${code(`${config.prefix}memory`)} — DM your stored memories`,
    `${code(`${config.prefix}forget`)} — delete all of your stored memories`,
    `${code(`${config.prefix}help`)} — show this help`
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

function getCrunchyrollActivityFromActivities(activities) {
  return (activities || []).find((activity) => {
    const name = String(activity?.name || '').toLowerCase();
    const details = String(activity?.details || '').toLowerCase();
    const state = String(activity?.state || '').toLowerCase();
    const url = String(activity?.url || '').toLowerCase();

    return name === 'crunchyroll' ||
      name.includes('crunchyroll') ||
      details.includes('crunchyroll') ||
      state.includes('crunchyroll') ||
      url.includes('crunchyroll.com');
  });
}

function getCrunchyrollActivity(message) {
  return getCrunchyrollActivityFromActivities(message.member?.presence?.activities);
}

function parseSeasonEpisode(value) {
  const text = String(value || '').trim();
  if (!text) return null;

  // Only accept an explicit Sx • Ey / SxEy pattern.
  // Do not scan arbitrary numeric fields from the activity object.
  const match = text.match(/\bS(\d+)\s*(?:•|·)\s*E(\d+)\b/i) ||
    text.match(/\bS(\d+)\s*E(\d+)\b/i);

  if (!match) return null;
  return { season: match[1], episode: match[2] };
}

function cleanEpisodeTitle(value) {
  const text = String(value || '').trim();
  if (!text) return null;

  const cleaned = text
    .replace(/^S\d+\s*(?:•|·)\s*E\d+\s*[-–—:|·•]?\s*/i, '')
    .replace(/^S\d+\s*E\d+\s*[-–—:|·•]?\s*/i, '')
    .trim();

  return cleaned || null;
}

function getActivityAssetText(activity, key) {
  const value = activity?.assets?.[key];
  return typeof value === 'string' ? value.trim() : '';
}

function parseWatchInfo(activity) {
  const name = String(activity?.name || '').trim();
  const details = String(activity?.details || '').trim();
  const state = String(activity?.state || '').trim();
  const largeText = getActivityAssetText(activity, 'largeText') || getActivityAssetText(activity, 'large_text');
  const smallText = getActivityAssetText(activity, 'smallText') || getActivityAssetText(activity, 'small_text');

  // Crunchyroll/Discord can place Sx • Ey in a textual activity field such as
  // state or asset hover text. Search only those known metadata strings.
  const seasonEpisode = [state, largeText, smallText, details]
    .map(parseSeasonEpisode)
    .find(Boolean) || null;

  const isCrunchyrollName = /^crunchyroll$/i.test(name) || /crunchyroll/i.test(name);
  const title = (isCrunchyrollName ? details : name) || details || 'Unknown anime';

  // Prefer a state/asset text as the episode title when it is not itself the
  // Sx • Ey marker. This prevents the anime title from being duplicated.
  const episodeTitle = [state, largeText, smallText]
    .map((value) => cleanEpisodeTitle(value))
    .find((value) => value && !/^S\d+\s*(?:•|·)\s*E\d+$/i.test(value) && !/^S\d+\s*E\d+$/i.test(value) && !/^crunchyroll$/i.test(value) && value !== title) || null;

  return {
    title: title.replace(/^crunchyroll$/i, 'Unknown anime').trim(),
    episodeTitle,
    season: seasonEpisode?.season || null,
    episode: seasonEpisode?.episode || null
  };
}

function buildCurrentlyWatchingEmbed({ memberName, activity }) {
  const { title, episodeTitle, season, episode } = parseWatchInfo(activity);

  const embed = new EmbedBuilder()
    .setColor(0x00C2B8)
    .setAuthor({ name: `${memberName} is currently watching` })
    .setTitle(title)
    .setDescription([
      episodeTitle ? `**${episodeTitle}**` : null,
      '📺 Currently watching on Crunchyroll'
    ].filter(Boolean).join('\n'))
    .addFields({
      name: 'Episode',
      value: season && episode ? `S${season} • E${episode}` : 'Unknown',
      inline: true
    })
    .setFooter({ text: 'Crunchyroll' });

  const assets = activity.assets;
  const largeImage = assets?.largeImageURL?.() || assets?.largeImage?.url || assets?.largeImage;
  if (largeImage) embed.setThumbnail(largeImage);

  return embed;
}

async function replyCurrentlyWatching(target, activity) {
  if (!activity) {
    await target.reply({
      content: '📺 I can\'t see you watching anything on Crunchyroll right now.',
      allowedMentions: { repliedUser: false }
    });
    return true;
  }

  const memberName = target.member?.displayName || target.user?.globalName || target.author?.globalName || target.user?.username || target.author?.username || 'You';
  const embed = buildCurrentlyWatchingEmbed({ memberName, activity });

  await target.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
  return true;
}

async function handleCurrentlyWatching(message) {
  return replyCurrentlyWatching(message, getCrunchyrollActivity(message));
}

export async function handleCurrentlyWatchingInteraction(interaction, client) {
  let activity = null;

  if (interaction.guild) {
    const member = interaction.guild.members.cache.get(interaction.user.id);
    activity = getCrunchyrollActivityFromActivities(member?.presence?.activities);
  }

  if (!activity) {
    for (const guild of client.guilds.cache.values()) {
      const presence = guild.presences.cache.get(interaction.user.id);
      activity = getCrunchyrollActivityFromActivities(presence?.activities);
      if (activity) break;
    }
  }

  return replyCurrentlyWatching(interaction, activity);
}

export async function handleCommand(message) {
  const isAfkCommand = /^\.afk(?:\s|$)/i.test(message.content);
  const isCrcCommand = /^\.crc(?:\s|$)/i.test(message.content);
  const body = isAfkCommand
    ? message.content.slice(4).trim()
    : isCrcCommand
      ? message.content.slice(4).trim()
      : message.content.slice(config.prefix.length).trim();
  const [command] = body.split(/\s+/);
  const name = isAfkCommand ? 'afk' : isCrcCommand ? 'crc' : command?.toLowerCase();

  if (!name) return true;

  if (name === 'crc') {
    return handleCurrentlyWatching(message);
  }

  if (name === 'afk') {
    const reason = (isAfkCommand ? body : body.slice(command.length))
      .trim()
      .replace(/^[,!:;\-\s]+/, '')
      .trim()
      .slice(0, 200) || null;
    const existing = await getUserAfk(config.guildId, message.author.id);

    if (existing) {
      await message.reply({
        content: `💤 You're already AFK${existing.reason ? ` for **${existing.reason}**` : ''}. Send a normal message when you're back.`,
        allowedMentions: { repliedUser: false }
      });
      return true;
    }

    const reply = await setUserAfk({ guildId: config.guildId, user: message.author, reason });
    if (reply) {
      await message.reply({ content: reply, allowedMentions: { repliedUser: false } });
    } else {
      await message.reply({ content: '❌ I couldn\'t set your AFK status. Try again in a moment.', allowedMentions: { repliedUser: false } });
    }
    return true;
  }

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

    const rows = await listChannelModes(config.guildId);

    if (!rows?.length) {
      await message.reply('No Elias channels are configured yet.');
      return true;
    }

    const lines = rows.map((row) => `<#${row.channel_id}> → **${row.mode.toUpperCase()}**`);
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
    await deleteUserMemories(config.guildId, message.author.id);
    await message.reply('🧠✅ Deleted all memories I had stored about you.');
    return true;
  }

  if (name === 'help') {
    await message.reply(helpText());
    return true;
  }

  return false;
}
