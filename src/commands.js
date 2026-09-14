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

function normalizeNumber(value) {
  const text = String(value ?? '').trim();
  return /^\d+$/.test(text) ? text : null;
}

function parseSeasonEpisode(value) {
  const text = String(value || '').trim();
  if (!text) return null;

  const patterns = [
    /\bS(\d+)\s*(?:•|·|[-–—:/|])\s*E(\d+)\b/i,
    /\bS(\d+)\s*E(\d+)\b/i,
    /\bS(\d+)\s*[x×]\s*E?(\d+)\b/i,
    /\bSeason\s*(\d+)\s*(?:•|·|[-–—:/|,]|and)\s*Episode\s*(\d+)\b/i,
    /\bSeason\s*(\d+)\s*Episode\s*(\d+)\b/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return { season: match[1], episode: match[2] };
  }

  return null;
}

function parseSeasonOnly(value) {
  const text = String(value || '').trim();
  if (!text) return null;

  const match = text.match(/\b(?:Season|S)\s*(\d+)\b/i);
  return match ? match[1] : null;
}

function parseEpisodeOnly(value) {
  const text = String(value || '').trim();
  if (!text) return null;

  const match = text.match(/\b(?:Episode|Ep\.?|E)\s*(\d+)\b/i);
  return match ? match[1] : null;
}

function cleanEpisodeTitle(value) {
  const text = String(value || '').trim();
  if (!text) return null;

  const cleaned = text
    .replace(/^S\d+\s*(?:•|·)\s*E\d+\s*[-–—:|·•]?\s*/i, '')
    .replace(/^S\d+\s*E\d+\s*[-–—:|·•]?\s*/i, '')
    .replace(/^Season\s*\d+\s*(?:[-–—:|,]\s*)?Episode\s*\d+\s*[-–—:|·•]?\s*/i, '')
    .trim();

  return cleaned || null;
}

function getActivityAssetText(activity, key) {
  const value = activity?.assets?.[key];
  return typeof value === 'string' ? value.trim() : '';
}

function getNamedEpisodeMetadata(activity) {
  const result = { season: null, episode: null };

  const candidates = [activity];
  for (const node of candidates) {
    if (!node || typeof node !== 'object') continue;

    const seasonValue = node.seasonNumber ?? node.season_number ?? node.season;
    const episodeValue = node.episodeNumber ?? node.episode_number ?? node.episode;

    if (typeof seasonValue === 'number' || typeof seasonValue === 'string') {
      result.season = normalizeNumber(seasonValue);
    }

    if (typeof episodeValue === 'number' || typeof episodeValue === 'string') {
      result.episode = normalizeNumber(episodeValue);
    }
  }

  return result.season || result.episode ? result : null;
}

function findEpisodeMetadataByKey(node, depth = 0, seen = new Set()) {
  if (!node || typeof node !== 'object' || depth > 4 || seen.has(node)) return null;
  seen.add(node);

  const output = { season: null, episode: null };

  for (const [key, value] of Object.entries(node)) {
    const lowerKey = String(key).toLowerCase();

    if (/(?:season|seasonnumber|season_number)/.test(lowerKey)) {
      const number = normalizeNumber(value);
      if (number) output.season = number;
    }

    if (/(?:episode|episodenumber|episode_number)/.test(lowerKey)) {
      const number = normalizeNumber(value);
      if (number) output.episode = number;
    }

    if (value && typeof value === 'object') {
      const nested = findEpisodeMetadataByKey(value, depth + 1, seen);
      if (nested?.season && !output.season) output.season = nested.season;
      if (nested?.episode && !output.episode) output.episode = nested.episode;
    }
  }

  return output.season || output.episode ? output : null;
}

function extractActivitySeasonEpisode(activity) {
  const named = getNamedEpisodeMetadata(activity) || findEpisodeMetadataByKey(activity);
  if (named?.season && named?.episode) return named;

  const name = String(activity?.name || '').trim();
  const details = String(activity?.details || '').trim();
  const state = String(activity?.state || '').trim();
  const largeText = getActivityAssetText(activity, 'largeText') || getActivityAssetText(activity, 'large_text');
  const smallText = getActivityAssetText(activity, 'smallText') || getActivityAssetText(activity, 'small_text');

  const explicit = [state, largeText, smallText, details, name]
    .map(parseSeasonEpisode)
    .find(Boolean) || null;

  if (explicit) return explicit;

  const season = [state, largeText, smallText, details, name]
    .map(parseSeasonOnly)
    .find(Boolean) || null;
  const episode = [state, largeText, smallText, details, name]
    .map(parseEpisodeOnly)
    .find(Boolean) || null;

  return season || episode ? { season, episode } : null;
}

function extractStructuredEpisode(node, depth = 0, seen = new Set()) {
  if (!node || typeof node !== 'object' || depth > 6 || seen.has(node)) return null;
  seen.add(node);

  if (Array.isArray(node)) {
    for (const item of node) {
      const result = extractStructuredEpisode(item, depth + 1, seen);
      if (result?.season || result?.episode) return result;
    }
    return null;
  }

  if (Array.isArray(node['@graph'])) {
    const result = extractStructuredEpisode(node['@graph'], depth + 1, seen);
    if (result?.season || result?.episode) return result;
  }

  const type = node['@type'];
  const types = Array.isArray(type) ? type.map(String) : [String(type || '')];
  const looksLikeEpisode = types.some((value) => /TVEpisode|Episode/i.test(value));

  if (looksLikeEpisode) {
    const season = normalizeNumber(
      node.seasonNumber ?? node.partOfSeason?.seasonNumber ?? node.season?.seasonNumber
    );
    const episode = normalizeNumber(node.episodeNumber);
    const title = typeof node.name === 'string' ? node.name.trim() : null;

    if (season || episode) return { season, episode, title };
  }

  for (const value of Object.values(node)) {
    if (value && typeof value === 'object') {
      const result = extractStructuredEpisode(value, depth + 1, seen);
      if (result?.season || result?.episode) return result;
    }
  }

  return null;
}

function extractJsonLdEpisodes(html) {
  const matches = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);

  for (const match of matches) {
    try {
      const parsed = JSON.parse(match[1].trim());
      const result = extractStructuredEpisode(parsed);
      if (result) return result;
    } catch {
      // Ignore malformed JSON-LD blocks and continue with the remaining page data.
    }
  }

  return null;
}

function extractNumberByKeyFromHtml(html, keyPattern) {
  const patterns = [
    new RegExp(`\\\"(?:${keyPattern})\\\"\\s*:\\s*\\\"?(\\d+)\\\"?`, 'i'),
    new RegExp(`(?:${keyPattern})\\s*[:=]\\s*\\\"?(\\d+)\\\"?`, 'i')
  ];

  for (const pattern of patterns) {
    const match = String(html || '').match(pattern);
    if (match) return match[1];
  }

  return null;
}

function extractExplicitSeasonEpisodeFromHtml(html) {
  const text = String(html || '');
  const patterns = [
    /\bS(\d+)\s*(?:•|·)\s*E(\d+)\b/i,
    /\bS(\d+)\s*E(\d+)\b/i,
    /\bSeason\s*(\d+)\s*(?:•|·|[-–—:/|,]|and)?\s*Episode\s*(\d+)\b/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return { season: match[1], episode: match[2] };
  }

  const episode = extractNumberByKeyFromHtml(text, 'episodeNumber|episode_number');
  const season = extractNumberByKeyFromHtml(text, 'seasonNumber|season_number');

  return season || episode ? { season, episode } : null;
}

function extractEpisodeTitleFromHtml(html) {
  const patterns = [
    /#?\s*E\d+\s*[-–—:]\s*([^<\n]{2,160})/i,
    /\bE\d+\s*[-–—:]\s*([^<\n]{2,160})/i,
    /"episodeTitle"\s*:\s*"([^"]+)"/i,
    /"title"\s*:\s*"(E\d+\s*[-–—:]\s*[^"\n]+)"/i
  ];

  for (const pattern of patterns) {
    const match = String(html || '').match(pattern);
    if (!match) continue;

    const value = String(match[1] || '').trim()
      .replace(/\\u0026/g, '&')
      .replace(/\\u0027/g, "'")
      .replace(/\\"/g, '"')
      .replace(/\\n/g, ' ')
      .trim();

    if (value) return value.replace(/^E\d+\s*[-–—:]\s*/i, '').trim();
  }

  return null;
}

function extractSeasonFromPageText(html) {
  const text = String(html || '');
  const patterns = [
    /\bSeason\s*(\d+)\b/i,
    /\bS(\d+)\s*[-–—:|]/i,
    /\bseasonNumber\s*[=:]\s*["']?(\d+)["']?/i,
    /\bseason_number\s*[=:]\s*["']?(\d+)["']?/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1];
  }

  return null;
}

function extractWatchLinks(html) {
  const links = [];
  const seen = new Set();
  const pattern = /(?:href|url)=["'](https?:\/\/(?:www\.)?crunchyroll\.com\/watch\/[^"'#?]+|\/watch\/[^"'#?]+)["']/gi;

  for (const match of String(html || '').matchAll(pattern)) {
    let url = match[1];
    if (url.startsWith('/')) url = `https://www.crunchyroll.com${url}`;
    if (!seen.has(url)) {
      seen.add(url);
      links.push(url);
    }
    if (links.length >= 6) break;
  }

  return links;
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'Elias/1.0',
      'accept-language': 'en-US,en;q=0.9'
    },
    signal: AbortSignal.timeout(6000),
    redirect: 'follow'
  });

  if (!response.ok) return null;
  return response.text();
}

async function resolveEpisodeFromCrunchyrollPage(url) {
  try {
    const html = await fetchHtml(url);
    if (!html) return null;

    const structured = extractJsonLdEpisodes(html);
    const explicit = extractExplicitSeasonEpisodeFromHtml(html);
    const episodeTitle = structured?.title || extractEpisodeTitleFromHtml(html);
    const season = structured?.season || explicit?.season || extractSeasonFromPageText(html);
    const episode = structured?.episode || explicit?.episode;

    if (season || episode) {
      return { season: season || null, episode: episode || null, episodeTitle };
    }
  } catch {
    // Public page lookup is only a fallback.
  }

  return null;
}

async function searchCrunchyrollForEpisode(title, episodeTitle) {
  if (!title || !episodeTitle) return null;

  const query = encodeURIComponent(`${title} ${episodeTitle}`);
  const searchUrl = `https://www.crunchyroll.com/search?q=${query}`;

  try {
    const html = await fetchHtml(searchUrl);
    if (!html) return null;

    const links = extractWatchLinks(html);
    for (const url of links) {
      const info = await resolveEpisodeFromCrunchyrollPage(url);
      if (!info) continue;

      if (!info.episodeTitle || info.episodeTitle.toLowerCase() === episodeTitle.toLowerCase()) {
        return info;
      }
    }
  } catch {
    // Ignore search failures and leave the activity-only data intact.
  }

  return null;
}

async function fetchCrunchyrollWatchData(activity, localInfo) {
  const syncId = String(activity?.syncId || '').trim();
  const activityUrl = String(activity?.url || '').trim();
  const urls = [];

  if (/^https?:\/\/(?:www\.)?crunchyroll\.com\//i.test(activityUrl)) {
    urls.push(activityUrl);
  }

  if (syncId && /^[A-Za-z0-9_-]+$/.test(syncId)) {
    urls.push(`https://www.crunchyroll.com/watch/${encodeURIComponent(syncId)}`);
  }

  const uniqueUrls = [...new Set(urls)];

  for (const url of uniqueUrls) {
    const result = await resolveEpisodeFromCrunchyrollPage(url);
    if (result) return result;
  }

  const title = String(activity?.details || '').trim();
  const episodeTitle = [
    String(activity?.state || '').trim(),
    getActivityAssetText(activity, 'largeText'),
    getActivityAssetText(activity, 'large_text'),
    getActivityAssetText(activity, 'smallText'),
    getActivityAssetText(activity, 'small_text')
  ]
    .map(cleanEpisodeTitle)
    .find((value) => value && value !== title && !parseSeasonEpisode(value));

  return searchCrunchyrollForEpisode(title, episodeTitle);
}

function parseWatchInfo(activity) {
  const name = String(activity?.name || '').trim();
  const details = String(activity?.details || '').trim();
  const state = String(activity?.state || '').trim();
  const largeText = getActivityAssetText(activity, 'largeText') || getActivityAssetText(activity, 'large_text');
  const smallText = getActivityAssetText(activity, 'smallText') || getActivityAssetText(activity, 'small_text');

  const episodeMetadata = extractActivitySeasonEpisode(activity) || {};
  const isCrunchyrollName = /^crunchyroll$/i.test(name) || /crunchyroll/i.test(name);
  const title = (isCrunchyrollName ? details : name) || details || 'Unknown anime';

  const episodeTitle = [state, largeText, smallText]
    .map(cleanEpisodeTitle)
    .find((value) => value && value !== title && !parseSeasonEpisode(value) && !/^crunchyroll$/i.test(value)) || null;

  return {
    title: title.replace(/^crunchyroll$/i, 'Unknown anime').trim(),
    episodeTitle,
    season: episodeMetadata.season || null,
    episode: episodeMetadata.episode || null
  };
}

async function resolveWatchInfo(activity) {
  const local = parseWatchInfo(activity);

  if (local.season && local.episode) return local;

  const remote = await fetchCrunchyrollWatchData(activity, local);
  if (!remote) return local;

  return {
    ...local,
    episodeTitle: local.episodeTitle || remote.episodeTitle || null,
    season: local.season || remote.season || null,
    episode: local.episode || remote.episode || null
  };
}

function buildCurrentlyWatchingEmbed({ memberName, activity, watchInfo }) {
  const { title, episodeTitle, season, episode } = watchInfo;
  const descriptionLines = [];

  if (episodeTitle && episodeTitle !== title) {
    descriptionLines.push(`**${episodeTitle}**`);
  }

  if (season && episode) {
    descriptionLines.push(`S${season} • E${episode}`);
  }

  const embed = new EmbedBuilder()
    .setColor(0x00C2B8)
    .setAuthor({ name: `${memberName} is currently watching` })
    .setTitle(title)
    .setFooter({ text: 'Crunchyroll' });

  if (descriptionLines.length) {
    embed.setDescription(descriptionLines.join('\n'));
  }

  const assets = activity.assets;
  const largeImage = assets?.largeImageURL?.() || assets?.largeImage?.url || assets?.largeImage;
  if (largeImage) embed.setThumbnail(largeImage);

  return embed;
}

async function replyCurrentlyWatching(target, activity) {
  if (!activity) {
    await target.reply({
      content: 'I can\'t see you watching anything on Crunchyroll right now.',
      allowedMentions: { repliedUser: false }
    });
    return true;
  }

  const memberName = target.member?.displayName || target.user?.globalName || target.author?.globalName || target.user?.username || target.author?.username || 'You';
  const watchInfo = await resolveWatchInfo(activity);
  const embed = buildCurrentlyWatchingEmbed({ memberName, activity, watchInfo });

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
