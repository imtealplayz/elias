import {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder
} from 'discord.js';
import { config } from './config.js';
import {
  COLORS,
  TEAL,
  addBalance,
  baseEmbed,
  formatTeal,
  getBalance,
  getEconomyProfile,
  getLeaderboard,
  resetBalance,
  removeBalance,
  recordGame,
  setBalance
} from './teal.js';
import {
  cmdBlackjack,
  cmdCoinflip,
  cmdCrash,
  cmdKeno,
  cmdLimbo,
  cmdMines,
  cmdRoulette,
  cmdSlots,
  cmdTowers,
  cmdUnfreeze,
  handleBlackjack,
  handleMines,
  handleTowers
} from './games/casino.js';

const OWNER_ID = '926063716057894953';

const cooldowns = new Map();
const COOLDOWN_MS = {
  slots: 5000,
  coinflip: 5000,
  roulette: 5000,
  blackjack: 5000,
  crash: 5000,
  mines: 5000,
  towers: 5000,
  keno: 5000,
  limbo: 5000,
  rain: 10000
};

const activeRains = new Map();

function checkGuild(interaction) {
  return Boolean(interaction.guildId);
}

function checkCooldown(userId, commandName) {
  const key = `${userId}:${commandName}`;
  const now = Date.now();
  const duration = COOLDOWN_MS[commandName] || 3000;
  const expires = cooldowns.get(key) || 0;

  if (expires > now) return Math.ceil((expires - now) / 1000);
  cooldowns.set(key, now + duration);
  return 0;
}

function usageError(interaction, description) {
  return interaction.reply({
    embeds: [baseEmbed('❌ Invalid', COLORS.red).setDescription(description)],
    flags: MessageFlags.Ephemeral
  });
}

function formatSigned(amount) {
  const value = Math.floor(Number(amount) || 0);
  return value >= 0 ? `+${formatTeal(value)}` : `-${formatTeal(Math.abs(value))}`;
}

async function cmdBalance(interaction) {
  const balance = await getBalance(interaction.guildId, interaction.user.id);

  await interaction.reply({
    embeds: [
      baseEmbed('💰 Teal Balance', COLORS.teal)
        .setDescription(`You have **${formatTeal(balance)}**.`)
        .setThumbnail(interaction.user.displayAvatarURL())
    ]
  });
}

async function cmdLeaderboard(interaction) {
  const rows = await getLeaderboard(interaction.guildId, 10);

  if (!rows.length) {
    await interaction.reply({
      embeds: [baseEmbed('🏆 Teal Leaderboard', COLORS.gold).setDescription('Nobody has a Teal balance yet.')],
      allowedMentions: { parse: [] }
    });
    return;
  }

  const medals = ['🥇', '🥈', '🥉'];
  const lines = await Promise.all(rows.map(async (row, index) => {
    const user = await interaction.client.users.fetch(row.discord_id).catch(() => null);
    const name = user?.username || `User ${row.discord_id}`;
    return `${medals[index] || `**${index + 1}.**`} **${name}** — ${formatTeal(row.balance)}`;
  }));

  await interaction.reply({
    embeds: [
      baseEmbed('🏆 Teal Leaderboard', COLORS.gold)
        .setDescription(lines.join('\n'))
    ]
  });
}

async function cmdProfile(interaction) {
  const target = interaction.options.getUser('user') || interaction.user;
  const data = await getEconomyProfile(interaction.guildId, target.id);
  const stats = data.stats || {};

  const labels = {
    slots: '🎰 Slots',
    coinflip: '🪙 Coinflip',
    roulette: '🎡 Roulette',
    blackjack: '🃏 Blackjack',
    crash: '📈 Crash',
    mines: '💣 Mines',
    towers: '🗼 Towers',
    keno: '🎱 Keno',
    limbo: '🎯 Limbo'
  };

  let wins = 0;
  let losses = 0;
  let profit = 0;

  const gameLines = Object.entries(labels)
    .map(([key, label]) => {
      const stat = stats[key];
      if (!stat || Number(stat.wagered || 0) === 0) return null;

      const w = Number(stat.wins || 0);
      const l = Number(stat.losses || 0);
      const p = Number(stat.profit || 0);
      wins += w;
      losses += l;
      profit += p;

      return `${label} — ${Number(stat.wagered || 0).toLocaleString()} wagered • W/L ${w}/${l}`;
    })
    .filter(Boolean);

  const overall = wins + losses;
  const winRate = overall ? ((wins / overall) * 100).toFixed(1) : '0.0';

  const embed = baseEmbed(`📊 ${target.username}'s Teal Profile`, COLORS.blue)
    .setThumbnail(target.displayAvatarURL())
    .addFields(
      { name: '💰 Balance', value: formatTeal(data.balance), inline: true },
      { name: '🎲 Total Wagered', value: formatTeal(data.total_wagered), inline: true },
      { name: '📈 Overall W/L', value: `${wins}/${losses} • ${winRate}% win rate`, inline: true },
      { name: '💹 Net Game Profit', value: formatSigned(profit), inline: false },
      {
        name: '🎮 Game Breakdown',
        value: gameLines.length ? gameLines.join('\n') : '_No casino games played yet._',
        inline: false
      }
    );

  await interaction.reply({ embeds: [embed] });
}

async function cmdTip(interaction) {
  const target = interaction.options.getUser('user');
  const amount = interaction.options.getInteger('amount');

  if (!target || target.bot) {
    return usageError(interaction, 'Choose a real server member to tip.');
  }
  if (target.id === interaction.user.id) {
    return usageError(interaction, 'You cannot tip yourself.');
  }
  if (!Number.isInteger(amount) || amount < 1) {
    return usageError(interaction, `Tip at least **1 ${TEAL}**.`);
  }

  const senderBalance = await getBalance(interaction.guildId, interaction.user.id);
  if (senderBalance < amount) {
    return interaction.reply({
      embeds: [
        baseEmbed('❌ Insufficient Teal', COLORS.red)
          .setDescription(`You need **${formatTeal(amount)}**, but you only have **${formatTeal(senderBalance)}**.`)
      ],
      flags: MessageFlags.Ephemeral
    });
  }

  await removeBalance(interaction.guildId, interaction.user.id, amount);
  let newBalance;
  try {
    newBalance = await addBalance(interaction.guildId, target.id, amount);
  } catch (error) {
    await addBalance(interaction.guildId, interaction.user.id, amount).catch(() => {});
    throw error;
  }

  await interaction.reply({
    embeds: [
      baseEmbed('💸 Teal Sent', COLORS.green)
        .setDescription(`You sent **${formatTeal(amount)}** to <@${target.id}>.`)
        .addFields({ name: 'Your Balance', value: formatTeal(await getBalance(interaction.guildId, interaction.user.id)), inline: true })
    ]
  });

  try {
    await target.send(`💸 You received **${formatTeal(amount)}** from **${interaction.user.username}** in **${interaction.guild.name}**. Your new balance is **${formatTeal(newBalance)}**.`);
  } catch {}
}

async function cmdRain(interaction) {
  const amount = interaction.options.getInteger('amount');
  const duration = interaction.options.getInteger('duration');

  if (!Number.isInteger(amount) || amount < 1) {
    return usageError(interaction, `Rain amount must be at least **1 ${TEAL}**.`);
  }
  if (!Number.isInteger(duration) || duration < 10 || duration > 300) {
    return usageError(interaction, 'Duration must be between **10 and 300 seconds**.');
  }

  if (activeRains.has(interaction.guildId)) {
    return interaction.reply({
      embeds: [baseEmbed('⛈️ Rain Active', COLORS.red).setDescription('There is already an active Teal rain in this server.')],
      flags: MessageFlags.Ephemeral
    });
  }

  const balance = await getBalance(interaction.guildId, interaction.user.id);
  if (balance < amount) {
    return interaction.reply({
      embeds: [baseEmbed('❌ Insufficient Teal', COLORS.red).setDescription(`You need **${formatTeal(amount)}**, but only have **${formatTeal(balance)}**.`)],
      flags: MessageFlags.Ephemeral
    });
  }

  await removeBalance(interaction.guildId, interaction.user.id, amount);
  await interaction.reply({ content: '🌧️ Teal rain started!', flags: MessageFlags.Ephemeral });

  const channel = interaction.channel;
  if (!channel) return;

  const endAt = Math.floor((Date.now() + duration * 1000) / 1000);
  const message = await channel.send({
    embeds: [
      baseEmbed('🌧️ Teal Rain', COLORS.teal)
        .setDescription(
          `**<@${interaction.user.id}>** is making it rain!\n\nReact with 🌧️ to claim an equal share.\n\n⏰ Ends <t:${endAt}:R>\n💰 Prize pool: **${formatTeal(amount)}**`
        )
    ]
  });

  await message.react('🌧️').catch(() => {});
  activeRains.set(interaction.guildId, true);

  setTimeout(async () => {
    activeRains.delete(interaction.guildId);

    const fresh = await message.fetch().catch(() => null);
    if (!fresh) return;

    const reaction = fresh.reactions.cache.get('🌧️');
    const users = reaction ? await reaction.users.fetch().catch(() => null) : null;
    const participants = new Set();

    users?.forEach((user) => {
      if (!user.bot) participants.add(user.id);
    });

    if (!participants.size) {
      await fresh.edit({
        embeds: [
          baseEmbed('🌧️ Rain Ended', COLORS.red)
            .setDescription(`Nobody joined. **${formatTeal(amount)}** was lost.`)
        ]
      }).catch(() => {});
      return;
    }

    const share = Math.floor(amount / participants.size);
    for (const userId of participants) {
      if (share > 0) await addBalance(interaction.guildId, userId, share);
    }

    await fresh.edit({
      embeds: [
        baseEmbed('🌧️ Rain Ended!', COLORS.green)
          .setDescription(
            `**${formatTeal(amount)}** was split between **${participants.size}** participant(s).\n\n${[...participants].map((id) => `<@${id}>`).join(', ')}`
          )
          .addFields({ name: 'Each Received', value: formatTeal(share), inline: true })
      ]
    }).catch(() => {});
  }, duration * 1000);
}

async function requireOwner(interaction) {
  if (interaction.user.id === OWNER_ID) return true;

  await interaction.reply({
    embeds: [baseEmbed('❌ No Permission', COLORS.red).setDescription('Only the Teal economy owner can use this command.')],
    flags: MessageFlags.Ephemeral
  });
  return false;
}

async function cmdGive(interaction) {
  if (!(await requireOwner(interaction))) return;

  const target = interaction.options.getUser('user');
  const amount = interaction.options.getInteger('amount');
  if (!target || !Number.isInteger(amount) || amount < 1) {
    return usageError(interaction, 'Provide a valid user and a positive Teal amount.');
  }

  const balance = await addBalance(interaction.guildId, target.id, amount);

  await interaction.reply({
    embeds: [
      baseEmbed('✅ Teal Given', COLORS.green)
        .addFields(
          { name: 'User', value: `<@${target.id}>`, inline: true },
          { name: 'Given', value: `+${formatTeal(amount)}`, inline: true },
          { name: 'New Balance', value: formatTeal(balance), inline: true }
        )
    ]
  });
}

async function cmdTake(interaction) {
  if (!(await requireOwner(interaction))) return;

  const target = interaction.options.getUser('user');
  const amount = interaction.options.getInteger('amount');
  if (!target || !Number.isInteger(amount) || amount < 1) {
    return usageError(interaction, 'Provide a valid user and a positive Teal amount.');
  }

  const balance = await getBalance(interaction.guildId, target.id);
  const newBalance = await setBalance(interaction.guildId, target.id, Math.max(0, balance - amount));

  await interaction.reply({
    embeds: [
      baseEmbed('✅ Teal Taken', COLORS.gold)
        .addFields(
          { name: 'User', value: `<@${target.id}>`, inline: true },
          { name: 'Taken', value: `-${formatTeal(Math.min(amount, balance))}`, inline: true },
          { name: 'New Balance', value: formatTeal(newBalance), inline: true }
        )
    ]
  });
}

async function cmdResetBalance(interaction) {
  if (!(await requireOwner(interaction))) return;

  const target = interaction.options.getUser('user');
  if (!target) return usageError(interaction, 'Choose the user whose Teal balance should be reset.');

  await resetBalance(interaction.guildId, target.id);

  await interaction.reply({
    embeds: [
      baseEmbed('♻️ Teal Balance Reset', COLORS.gold)
        .setDescription(`<@${target.id}>'s Teal balance is now **0 ${TEAL}**.`)
    ]
  });
}

export function getEconomyCommands() {
  return [
    new SlashCommandBuilder()
      .setName('balance')
      .setDescription('View your Teal currency balance'),

    new SlashCommandBuilder()
      .setName('leaderboard')
      .setDescription('View the richest Teal users'),

    new SlashCommandBuilder()
      .setName('profile')
      .setDescription('View a Teal gambling profile')
      .addUserOption((o) => o.setName('user').setDescription('User to view')),

    new SlashCommandBuilder()
      .setName('tip')
      .setDescription('Send Teal to another user')
      .addUserOption((o) => o.setName('user').setDescription('User to tip').setRequired(true))
      .addIntegerOption((o) => o.setName('amount').setDescription('Teal amount').setMinValue(1).setRequired(true)),

    new SlashCommandBuilder()
      .setName('rain')
      .setDescription('Make it rain Teal')
      .addIntegerOption((o) => o.setName('amount').setDescription('Teal prize pool').setMinValue(1).setRequired(true))
      .addIntegerOption((o) => o.setName('duration').setDescription('Duration in seconds').setMinValue(10).setMaxValue(300).setRequired(true)),

    new SlashCommandBuilder()
      .setName('give')
      .setDescription('Give Teal to a user')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addUserOption((o) => o.setName('user').setDescription('User to receive Teal').setRequired(true))
      .addIntegerOption((o) => o.setName('amount').setDescription('Teal amount').setMinValue(1).setRequired(true)),

    new SlashCommandBuilder()
      .setName('take')
      .setDescription('Take Teal from a user')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addUserOption((o) => o.setName('user').setDescription('User to take Teal from').setRequired(true))
      .addIntegerOption((o) => o.setName('amount').setDescription('Teal amount').setMinValue(1).setRequired(true)),

    new SlashCommandBuilder()
      .setName('resetbalance')
      .setDescription('Reset a user\'s Teal balance to zero')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addUserOption((o) => o.setName('user').setDescription('User whose balance to reset').setRequired(true)),

    new SlashCommandBuilder()
      .setName('unfreeze')
      .setDescription('Clear your frozen casino game without a refund'),

    new SlashCommandBuilder()
      .setName('slots')
      .setDescription('Spin the Teal slot machine')
      .addIntegerOption((o) => o.setName('bet').setDescription('Teal amount to bet').setMinValue(1).setRequired(true)),

    new SlashCommandBuilder()
      .setName('coinflip')
      .setDescription('Flip a coin, double or nothing')
      .addIntegerOption((o) => o.setName('bet').setDescription('Teal amount to bet').setMinValue(1).setRequired(true))
      .addStringOption((o) => o.setName('choice').setDescription('Heads or tails').setRequired(true)
        .addChoices({ name: '🟡 Heads', value: 'heads' }, { name: '⚪ Tails', value: 'tails' })),

    new SlashCommandBuilder()
      .setName('roulette')
      .setDescription('Spin Teal roulette')
      .addIntegerOption((o) => o.setName('bet').setDescription('Teal amount to bet').setMinValue(1).setRequired(true))
      .addStringOption((o) => o.setName('type').setDescription('red / black / green / even / odd / 0-36').setRequired(true)),

    new SlashCommandBuilder()
      .setName('blackjack')
      .setDescription('Play blackjack for Teal')
      .addIntegerOption((o) => o.setName('bet').setDescription('Teal amount to bet').setMinValue(1).setRequired(true)),

    new SlashCommandBuilder()
      .setName('crash')
      .setDescription('Cash out before the multiplier crashes')
      .addIntegerOption((o) => o.setName('bet').setDescription('Teal amount to bet').setMinValue(1).setRequired(true)),

    new SlashCommandBuilder()
      .setName('mines')
      .setDescription('Uncover gems, avoid mines')
      .addIntegerOption((o) => o.setName('bet').setDescription('Teal amount to bet').setMinValue(1).setRequired(true))
      .addIntegerOption((o) => o.setName('mines').setDescription('Number of mines (1-20)').setMinValue(1).setMaxValue(20).setRequired(true)),

    new SlashCommandBuilder()
      .setName('towers')
      .setDescription('Climb the tower and pick safe tiles')
      .addIntegerOption((o) => o.setName('bet').setDescription('Teal amount to bet').setMinValue(1).setRequired(true))
      .addStringOption((o) => o.setName('difficulty').setDescription('Game difficulty')
        .addChoices(
          { name: '🟢 Easy (1 bomb)', value: 'easy' },
          { name: '🟡 Medium (1-2 bombs)', value: 'medium' },
          { name: '🔴 Hard (2 bombs)', value: 'hard' }
        )),

    new SlashCommandBuilder()
      .setName('keno')
      .setDescription('Pick numbers and match the draw')
      .addIntegerOption((o) => o.setName('bet').setDescription('Teal amount to bet').setMinValue(1).setRequired(true))
      .addStringOption((o) => o.setName('picks').setDescription('2-10 picks from 1-80, comma separated').setRequired(true)),

    new SlashCommandBuilder()
      .setName('limbo')
      .setDescription('Set a target multiplier and try to beat it')
      .addIntegerOption((o) => o.setName('bet').setDescription('Teal amount to bet').setMinValue(1).setRequired(true))
      .addNumberOption((o) => o.setName('target').setDescription('Target multiplier (1.01-100)').setMinValue(1.01).setMaxValue(100).setRequired(true))
  ].map((command) => command.toJSON());
}

export async function handleEconomyChatInput(interaction) {
  if (!interaction.isChatInputCommand()) return false;
  if (!checkGuild(interaction)) return false;

  const name = interaction.commandName;
  const economyCommands = new Set([
    'balance', 'leaderboard', 'profile', 'tip', 'rain', 'give', 'take', 'resetbalance',
    'unfreeze', 'slots', 'coinflip', 'roulette', 'blackjack', 'crash',
    'mines', 'towers', 'keno', 'limbo'
  ]);

  if (!economyCommands.has(name)) return false;

  try {
    // Acknowledge before any Supabase work so Discord cannot time out.
    await interaction.deferReply();

    // Existing command handlers use interaction.reply(). Give them a local
    // wrapper that edits the already-acknowledged interaction without mutating
    // the discord.js Interaction instance itself.
    const commandInteraction = new Proxy(interaction, {
      get(target, property, receiver) {
        if (property === 'reply') {
          return async (options) => {
            const payload = { ...options };
            delete payload.ephemeral;
            delete payload.flags;
            return target.editReply(payload);
          };
        }
        return Reflect.get(target, property, receiver);
      }
    });
    if (['slots', 'coinflip', 'roulette', 'blackjack', 'crash', 'mines', 'towers', 'keno', 'limbo', 'rain'].includes(name)) {
      const wait = checkCooldown(interaction.user.id, name);
      if (wait > 0) {
        await commandInteraction.reply({
          embeds: [baseEmbed('⏳ Slow Down', COLORS.red).setDescription(`Use **/${name}** again in **${wait}s**.`)],
          flags: MessageFlags.Ephemeral
        });
        return true;
      }
    }

    switch (name) {
      case 'balance':
        await cmdBalance(commandInteraction);
        return true;
      case 'leaderboard':
        await cmdLeaderboard(commandInteraction);
        return true;
      case 'profile':
        await cmdProfile(commandInteraction);
        return true;
      case 'tip':
        await cmdTip(commandInteraction);
        return true;
      case 'rain':
        await cmdRain(commandInteraction);
        return true;
      case 'give':
        await cmdGive(commandInteraction);
        return true;
      case 'take':
        await cmdTake(commandInteraction);
        return true;
      case 'resetbalance':
        await cmdResetBalance(commandInteraction);
        return true;
      case 'unfreeze':
        await cmdUnfreeze(commandInteraction, interaction.user.id, interaction.guildId);
        return true;
      case 'slots':
        await cmdSlots(commandInteraction, interaction.user.id, interaction.guildId, interaction.options.getInteger('bet'));
        return true;
      case 'coinflip':
        await cmdCoinflip(commandInteraction, interaction.user.id, interaction.guildId, interaction.options.getInteger('bet'), interaction.options.getString('choice'));
        return true;
      case 'roulette':
        await cmdRoulette(commandInteraction, interaction.user.id, interaction.guildId, interaction.options.getInteger('bet'), interaction.options.getString('type'));
        return true;
      case 'blackjack':
        await cmdBlackjack(commandInteraction, interaction.user.id, interaction.guildId, interaction.options.getInteger('bet'));
        return true;
      case 'crash':
        await cmdCrash(commandInteraction, interaction.user.id, interaction.guildId, interaction.options.getInteger('bet'));
        return true;
      case 'mines':
        await cmdMines(commandInteraction, interaction.user.id, interaction.guildId, interaction.options.getInteger('bet'), interaction.options.getInteger('mines'));
        return true;
      case 'towers':
        await cmdTowers(commandInteraction, interaction.user.id, interaction.guildId, interaction.options.getInteger('bet'), interaction.options.getString('difficulty') || 'easy');
        return true;
      case 'keno':
        await cmdKeno(commandInteraction, interaction.user.id, interaction.guildId, interaction.options.getInteger('bet'), interaction.options.getString('picks'));
        return true;
      case 'limbo':
        await cmdLimbo(commandInteraction, interaction.user.id, interaction.guildId, interaction.options.getInteger('bet'), interaction.options.getNumber('target'));
        return true;
      default:
        return false;
    }
  } catch (error) {
    console.error(`Teal economy command error (${name}):`, error?.message || error);

    const payload = {
      embeds: [baseEmbed('❌ Teal Economy Error', COLORS.red).setDescription('Something went wrong while processing that command.')]
    };

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ ...payload, flags: MessageFlags.Ephemeral }).catch(() => {});
    } else {
      await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral }).catch(() => {});
    }

    return true;
  }
}

export async function handleEconomyInteraction(interaction) {
  if (interaction.isButton()) {
    if (interaction.customId.startsWith('bj:') || interaction.customId === 'bj_hit' || interaction.customId === 'bj_stand' || interaction.customId === 'bj_double') return handleBlackjack(interaction);
    if (interaction.customId.startsWith('mines_') || interaction.customId.startsWith('mines:') || interaction.customId === 'mines_cashout') return handleMines(interaction);
    if (interaction.customId.startsWith('tower_pick_') || interaction.customId === 'tower_cashout') {
      return handleTowers(interaction);
    }
  }
  return false;
}

export const economyRuntime = { recordGame };
