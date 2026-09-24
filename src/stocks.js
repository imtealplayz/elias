import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  ModalBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  SlashCommandBuilder,
  TextDisplayBuilder
} from 'discord.js';
import { buyStock, getStocks, getUserPortfolio, sellStock } from './db.js';

const STOCK_PASSWORD = 'zip123';
const MAX_BUY_QUANTITY = 10;
const STOCK_CURRENCY_LABEL = 'Robux';

function divider() {
  return new SeparatorBuilder()
    .setDivider(true)
    .setSpacing(SeparatorSpacingSize.Small);
}

function text(content) {
  return new TextDisplayBuilder().setContent(content);
}

function buildStocksComponents(stocks) {
  const rows = stocks.length
    ? stocks.map((stock) => {
        return '**' + stock.symbol + '** — ' + Number(stock.price).toFixed(2) + ' ' + STOCK_CURRENCY_LABEL +
          ' each • ' + stock.available + '/' + stock.totalSupply + ' available';
      })
    : ['No stocks are configured yet.'];

  const container = new ContainerBuilder()
    .setAccentColor(0x00C2B8)
    .addTextDisplayComponents(text('# 📈 Stock Market'))
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(text(rows.join('\n')))
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(text('Each stock has **150 total shares**. Buying increases its price; selling decreases it.'))
    .addSeparatorComponents(divider())
    .addActionRowComponents(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('stocks:refresh').setLabel('Refresh').setStyle(ButtonStyle.Secondary)));

  return [container];
}

function buildPortfolioComponents(user, portfolio) {
  const lines = portfolio.map((item) => {
    const value = Number(item.quantity) * Number(item.price);
    return '**' + item.symbol + '** — ' + item.quantity + ' owned • ' +
      Number(item.price).toFixed(2) + ' ' + STOCK_CURRENCY_LABEL + ' each • ' +
      value.toFixed(2) + ' ' + STOCK_CURRENCY_LABEL + ' total';
  });
  const totalValue = portfolio.reduce(
    (sum, item) => sum + Number(item.quantity) * Number(item.price),
    0
  );

  const description = portfolio.length
    ? lines.join('\n')
    : 'No stocks owned.';

  const container = new ContainerBuilder()
    .setAccentColor(0x00C2B8)
    .addTextDisplayComponents(text('## 💼 Stock Portfolio'))
    .addTextDisplayComponents(text('**Holder:** <@' + user.id + '>'))
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(text(description))
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(text('**Total portfolio value:** ' + totalValue.toFixed(2) + ' ' + STOCK_CURRENCY_LABEL));

  return [container];
}

function parseQuantity(value, max = Number.MAX_SAFE_INTEGER) {
  const quantity = Number.parseInt(String(value || '').trim(), 10);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > max) return null;
  return quantity;
}

function normalizeSymbol(value) {
  return String(value || '').trim().toUpperCase();
}

export async function registerStockCommands(client, legacyGuildId) {
  const commands = [
    new SlashCommandBuilder()
      .setName('stocks')
      .setDescription('View the demo stock market')
      .addSubcommand((sub) => sub
        .setName('buy')
        .setDescription('Buy stocks')
        .addStringOption((o) => o.setName('symbol').setDescription('Stock symbol').setRequired(true))
        .addIntegerOption((o) => o.setName('amount').setDescription('Amount to buy (1-10)').setMinValue(1).setMaxValue(10).setRequired(true))
        .addStringOption((o) => o.setName('password').setDescription('Buy password').setRequired(true)))
      .addSubcommand((sub) => sub
        .setName('sell')
        .setDescription('Sell stocks')
        .addStringOption((o) => o.setName('symbol').setDescription('Stock symbol').setRequired(true))
        .addIntegerOption((o) => o.setName('amount').setDescription('Amount to sell').setMinValue(1).setRequired(true)))
      .toJSON(),
    new SlashCommandBuilder()
      .setName('portfolio')
      .setDescription('View a stock portfolio')
      .addUserOption((option) => option
        .setName('user')
        .setDescription('User whose portfolio you want to view')
        .setRequired(false))
      .toJSON()
  ];

  // Publish these commands at application level.
  // Using set() replaces the stock commands as one atomic global registration
  // instead of relying on per-command create/edit calls.
  const globalCommands = await client.application.commands.set(commands);

  // Also keep the configured test guild in sync for immediate testing while
  // Discord propagates the global commands.
  if (legacyGuildId) {
    const testGuild = await client.guilds.fetch(legacyGuildId);
    await testGuild.commands.set(commands);
  }

  console.log(
    `Registered global stock commands: ${globalCommands
      .filter((command) => command.name === 'stocks' || command.name === 'portfolio')
      .map((command) => command.name)
      .join(', ')}`
  );
}

export async function handleStocksChatInput(interaction) {
  if (!interaction.isChatInputCommand()) return false;

  if (interaction.commandName === 'stocks') {
    const subcommand = interaction.options.getSubcommand(false);
    if (subcommand === 'buy' || subcommand === 'sell') {
      const symbol = normalizeSymbol(interaction.options.getString('symbol'));
      const quantity = interaction.options.getInteger('amount');
      if (subcommand === 'buy') {
        const password = interaction.options.getString('password');
        if (password !== STOCK_PASSWORD) {
          await interaction.reply({ content: '❌ Incorrect password.', ephemeral: true });
          return true;
        }
        await interaction.deferReply({ ephemeral: true });
        try {
          const result = await buyStock(interaction.user.id, symbol, quantity);
          await interaction.editReply({ content: '✅ Bought **' + quantity + ' ' + result.stock.symbol + '**. New price: **' + Number(result.stock.price).toFixed(2) + ' ' + STOCK_CURRENCY_LABEL + '**.' });
        } catch (error) {
          console.error('Stock purchase error:', error?.message || error);
          let message = '❌ I could not complete that purchase. Try again.';
          if (error?.message === 'STOCK_NOT_FOUND') message = '❌ That stock does not exist. Check `/stocks` for the current symbols.';
          if (error?.message === 'INSUFFICIENT_SUPPLY') message = '❌ There are not enough shares of that stock left.';
          await interaction.editReply({ content: message });
        }
        return true;
      }
      await interaction.deferReply({ ephemeral: true });
      try {
        const result = await sellStock(interaction.user.id, symbol, quantity);
        await interaction.editReply({ content: '✅ Sold **' + quantity + ' ' + result.stock.symbol + '**. New price: **' + Number(result.stock.price).toFixed(2) + ' ' + STOCK_CURRENCY_LABEL + '**.' });
      } catch (error) {
        console.error('Stock sale error:', error?.message || error);
        let message = '❌ I could not complete that sale. Try again.';
        if (error?.message === 'STOCK_NOT_FOUND') message = '❌ That stock does not exist. Check `/stocks` for the current symbols.';
        if (error?.message === 'INSUFFICIENT_SHARES') message = '❌ You do not own enough of that stock to sell that amount.';
        await interaction.editReply({ content: message });
      }
      return true;
    }
    await interaction.deferReply();
    try {
      const stocks = await getStocks();
      await interaction.editReply({
        flags: MessageFlags.IsComponentsV2,
        components: buildStocksComponents(stocks)
      });
    } catch (error) {
      console.error('Stock market load error:', error?.message || error);
      await interaction.editReply({
        flags: MessageFlags.IsComponentsV2,
        components: [new ContainerBuilder().addTextDisplayComponents(text('❌ The stock market database is not available yet. Run the stock section of `supabase/schema.sql` once, then try again.'))]
      });
    }
    return true;
  }

  if (interaction.commandName === 'portfolio') {
    const targetUser = interaction.options.getUser('user') || interaction.user;
    await interaction.deferReply();
    try {
      const portfolio = await getUserPortfolio(targetUser.id);
      await interaction.editReply({
        flags: MessageFlags.IsComponentsV2,
        components: buildPortfolioComponents(targetUser, portfolio)
      });
    } catch (error) {
      console.error('Portfolio load error:', error?.message || error);
      await interaction.editReply({
        flags: MessageFlags.IsComponentsV2,
        components: [new ContainerBuilder().addTextDisplayComponents(text('❌ The stock market database is not available yet. Run the stock section of `supabase/schema.sql` once, then try again.'))]
      });
    }
    return true;
  }

  return false;
}

export async function handleStocksInteraction(interaction) {
  if (interaction.isButton() && interaction.customId === 'stocks:refresh') {
    await interaction.deferUpdate();
    try {
      const stocks = await getStocks();
      await interaction.editReply({
        flags: MessageFlags.IsComponentsV2,
        components: buildStocksComponents(stocks)
      });
    } catch (error) {
      console.error('Stock refresh error:', error?.message || error);
    }
    return true;
  }

  return false;
}