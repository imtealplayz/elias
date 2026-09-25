import {
  ActionRowBuilder,
  SlashCommandBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} from 'discord.js';
import { config } from './config.js';

const OWNER_ID = '926063716057894953';

function button(customId, label, style = ButtonStyle.Secondary) {
  return new ButtonBuilder()
    .setCustomId(customId)
    .setLabel(label)
    .setStyle(style);
}

function buildRows(active) {
  const labels = [
    ['general', 'General'],
    ['economy', 'Teal Economy'],
    ['casino', 'Casino'],
    ['stocks', 'Stocks'],
    ['admin', 'Admin']
  ];

  return [
    new ActionRowBuilder().addComponents(
      ...labels.map(([key, label]) =>
        button(`elias_help:${key}`, label, key === active ? ButtonStyle.Primary : ButtonStyle.Secondary)
      )
    )
  ];
}

function generalEmbed() {
  return new EmbedBuilder()
    .setColor(0x00C2B8)
    .setTitle('📖 Elias Help • General')
    .setDescription([
      `**${config.prefix}help** — Show the legacy text help`,
      '**.afk [reason]** — Set your AFK status',
      '**.crc** — Show what you are currently watching on Crunchyroll',
      `**${config.prefix}memory** — DM your stored memories`,
      `**${config.prefix}forget** — Delete your stored memories`,
      '**/help** — Open this categorized help panel'
    ].join('\n'));
}

function economyEmbed() {
  return new EmbedBuilder()
    .setColor(0x00C2B8)
    .setTitle('💠 Elias Help • Teal Economy')
    .setDescription([
      '**/leaderboard** — View the richest Teal users',
      '**/profile [user]** — View a Teal gambling profile',
      '**/tip <user> <amount>** — Send Teal to another user',
      '**/rain <amount> <duration>** — Make it rain Teal',
      '**/portfolio [user]** — View Teal balance + stock portfolio + net worth',
      '',
      '**Teal is Elias’s fictional server currency.**'
    ].join('\n'));
}

function casinoEmbed() {
  return new EmbedBuilder()
    .setColor(0x9B59B6)
    .setTitle('🎰 Elias Help • Casino')
    .setDescription([
      '**/slots <bet>** — Spin the slot machine',
      '**/coinflip <bet> <choice>** — Heads or tails',
      '**/roulette <bet> <type>** — Red/black/green/even/odd or a number',
      '**/blackjack <bet>** — Play blackjack',
      '**/crash <bet>** — Cash out before the crash',
      '**/mines <bet> <mines>** — Find gems without hitting mines',
      '**/towers <bet> [difficulty]** — Climb the tower',
      '**/keno <bet> <picks>** — Pick numbers and match the draw',
      '**/limbo <bet> <target>** — Beat your target multiplier',
      '**/unfreeze** — Clear a frozen casino game'
    ].join('\n'));
}

function stocksEmbed() {
  return new EmbedBuilder()
    .setColor(0x00C2B8)
    .setTitle('📈 Elias Help • Stocks')
    .setDescription([
      '**/stocks view** — View the live stock market',
      '**/stocks buy <symbol> <amount> <password>** — Buy 1–10 shares',
      '**/stocks sell <symbol> <amount>** — Sell shares you own',
      '**/stocks reset** — Reset prices, supply, and all portfolios (owner)',
      '**/portfolio [user]** — View wallet + holdings + net worth',
      '',
      '**Stocks use Teal. Buying and selling changes market prices.**'
    ].join('\n'));
}

function adminEmbed() {
  return new EmbedBuilder()
    .setColor(0xF4C542)
    .setTitle('🛠️ Elias Help • Admin')
    .setDescription([
      '**/give <user> <amount>** — Give Teal (owner only)',
      '**/take <user> <amount>** — Take Teal (owner only)',
      '**/resetbalance <user>** — Reset a user’s Teal balance (owner only)',
      '**/stocks reset** — Reset the entire stock market (owner only)'
    ].join('\n'));
}

export function getHelpCommand() {
  return new SlashCommandBuilder().setName('help').setDescription('View Elias commands by category').toJSON();
}

export function buildHelpPayload(category = 'general') {
  const safeCategory = ['general', 'economy', 'casino', 'stocks', 'admin'].includes(category)
    ? category
    : 'general';

  const embed = {
    general: generalEmbed,
    economy: economyEmbed,
    casino: casinoEmbed,
    stocks: stocksEmbed,
    admin: adminEmbed
  }[safeCategory]();

  embed.setFooter({ text: 'Use the buttons below to switch categories.' });

  return {
    embeds: [embed],
    components: buildRows(safeCategory)
  };
}

export async function handleHelpChatInput(interaction) {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'help') return false;
  await interaction.reply(buildHelpPayload('general'));
  return true;
}

export async function handleHelpInteraction(interaction) {
  if (!interaction.isButton() || !interaction.customId.startsWith('elias_help:')) return false;

  const [, category] = interaction.customId.split(':');
  if (category === 'admin' && interaction.user.id !== OWNER_ID) {
    // Keep admin controls owner-gated; non-owners can still see the category.
  }

  await interaction.update(buildHelpPayload(category));
  return true;
}
