import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
  PermissionFlagsBits,
  SeparatorBuilder,
  SeparatorSpacingSize,
  SlashCommandBuilder,
  TextDisplayBuilder
} from 'discord.js';
import { config } from './config.js';
import { addBalance, formatTokens, getBalance, removeBalance, TEAL } from './teal.js';
import { buyStock, getStocks, getUserPortfolio, resetStocks, sellStock } from './db.js';

const MAX_BUY_QUANTITY = 10;
const STOCK_CURRENCY_LABEL = TEAL;
const STOCK_OWNER_ID = '926063716057894953';

function divider() {
  return new SeparatorBuilder()
    .setDivider(true)
    .setSpacing(SeparatorSpacingSize.Small);
}

function text(content) {
  return new TextDisplayBuilder().setContent(content);
}

const stockPanels = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function refreshStockPanel(channelId) {
  const panel = stockPanels.get(channelId);
  if (!panel) return;

  try {
    const stocks = await getStocks();
    await panel.message.edit({
      flags: MessageFlags.IsComponentsV2,
      components: buildStocksComponents(stocks)
    });
  } catch (error) {
    console.warn('Stock panel refresh failed:', error?.message || error);
  }
}

function startStockPanelRefresh(message) {
  const channelId = message.channelId;

  const existing = stockPanels.get(channelId);
  if (existing?.timer) clearInterval(existing.timer);

  const timer = setInterval(() => {
    refreshStockPanel(channelId);
  }, 60_000);

  stockPanels.set(channelId, { message, timer });
}

function buildStockModal(mode) {
  const verb = mode === 'buy' ? 'Buy' : 'Sell';
  return new ModalBuilder()
    .setCustomId(`stocks:${mode}_modal`)
    .setTitle(`${verb} Stock`)
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('symbol')
          .setLabel('Stock symbol')
          .setPlaceholder('ELIAS, NOVA, or BYTE')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(5)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('amount')
          .setLabel('Number of shares')
          .setPlaceholder('1-10')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(2)
      )
    );
}

async function processStockTrade(interaction, mode) {
  const symbol = normalizeSymbol(interaction.fields.getTextInputValue('symbol'));
  const quantity = parseQuantity(interaction.fields.getTextInputValue('amount'), MAX_BUY_QUANTITY);

  if (!['ELIAS', 'NOVA', 'BYTE'].includes(symbol)) {
    return interaction.editReply({ content: '❌ Invalid stock. Choose **ELIAS**, **NOVA**, or **BYTE**.' });
  }
  if (!quantity) {
    return interaction.editReply({ content: `❌ Share amount must be between **1 and ${MAX_BUY_QUANTITY}**.` });
  }

  if (mode === 'buy') {
    let charged = 0;

    try {
      const market = await getStocks();
      const stockPreview = market.find((stock) => stock.symbol === symbol);
      if (!stockPreview) throw new Error('STOCK_NOT_FOUND');

      const cost = Number((Number(stockPreview.price) * quantity).toFixed(2));
      const balance = await getBalance(config.guildId, interaction.user.id);

      if (balance < cost) {
        return interaction.editReply({
          content: '❌ You need **' + cost.toFixed(2) + ' ' + STOCK_CURRENCY_LABEL + '**, but only have **' + formatTokens(balance) + '**.'
        });
      }

      charged = Math.ceil(cost);
      await removeBalance(config.guildId, interaction.user.id, charged);

      const result = await buyStock(interaction.user.id, symbol, quantity);

      await interaction.editReply({
        content: '✅ Bought **' + quantity + ' ' + result.stock.symbol + '** for **' + charged.toLocaleString() + ' ' + STOCK_CURRENCY_LABEL + '**.\n' +
          'New price: **' + Number(result.stock.price).toFixed(2) + ' ' + STOCK_CURRENCY_LABEL + '**.\n' +
          'These shares are locked from external withdrawal for **7 days**.\n' +
          'Remaining balance: **' + formatTokens(await getBalance(config.guildId, interaction.user.id)) + '**.'
      });
    } catch (error) {
      console.error('Stock purchase error:', error?.message || error);

      if (charged > 0) {
        await addBalance(config.guildId, interaction.user.id, charged).catch(() => {});
      }

      let message = '❌ I could not complete that purchase. Your Tokens were refunded.';
      if (error?.message === 'STOCK_NOT_FOUND') message = '❌ That stock does not exist. Your Tokens were not charged.';
      if (error?.message === 'INSUFFICIENT_SUPPLY') message = '❌ There are not enough shares of that stock left. Your Tokens were refunded.';
      if (error?.message === 'INSUFFICIENT_FUNDS') message = '❌ You do not have enough Tokens for that purchase.';
      await interaction.editReply({ content: message });
    }

    await refreshStockPanel(interaction.channelId);
    return;
  }

  try {
    const result = await sellStock(interaction.user.id, symbol, quantity);
    const saleValue = Math.floor(Number(result.totalValue || 0));
    const newBalance = await addBalance(config.guildId, interaction.user.id, saleValue);

    await interaction.editReply({
      content: '✅ Sold **' + quantity + ' ' + result.stock.symbol + '** for **' + saleValue.toLocaleString() + ' ' + STOCK_CURRENCY_LABEL + '**.\n' +
        'New price: **' + Number(result.stock.price).toFixed(2) + ' ' + STOCK_CURRENCY_LABEL + '**.\n' +
        'New balance: **' + formatTokens(newBalance) + '**.'
    });
  } catch (error) {
    console.error('Stock sale error:', error?.message || error);
    let message = '❌ I could not complete that sale. Try again.';
    if (error?.message === 'STOCK_NOT_FOUND') message = '❌ That stock does not exist.';
    if (error?.message === 'INSUFFICIENT_SHARES') message = '❌ You do not own enough of that stock to sell that amount.';
    if (error?.message === 'SHARES_RESERVED') message = '❌ Some of those shares are reserved for a pending withdrawal.';
    await interaction.editReply({ content: message });
  }

  await refreshStockPanel(interaction.channelId);
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
    .addTextDisplayComponents(text('Buy and sell directly from this market panel. Stocks bought here are locked from external withdrawal for **7 days**.'))
    .addSeparatorComponents(divider())
    .addActionRowComponents(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('stocks:buy').setLabel('Buy Stock').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('stocks:sell').setLabel('Sell Stock').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('stocks:refresh').setLabel('Refresh').setStyle(ButtonStyle.Secondary)
    ));

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

  const container = new ContainerBuilder()
    .setAccentColor(0x00C2B8)
    .addTextDisplayComponents(text('## 💼 Stock Portfolio'))
    .addTextDisplayComponents(text('**Holder:** <@' + user.id + '>'))
    .addSeparatorComponents(divider());

  if (portfolio.length) {
    portfolio.forEach((item, index) => {
      if (index > 0) container.addSeparatorComponents(divider());
      container.addTextDisplayComponents(text(lines[index]));
    });
  } else {
    container.addTextDisplayComponents(text('No stocks owned.'));
  }

  container
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(text('**Total stock value:** ' + totalValue.toFixed(2) + ' ' + STOCK_CURRENCY_LABEL));

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

export async function registerStockCommands(client, legacyGuildId, additionalCommands = []) {
  const commands = [
    new SlashCommandBuilder()
      .setName('stocks')
      .setDescription('Stock market commands')
      .addSubcommand((sub) => sub
        .setName('view')
        .setDescription('Open the stock market panel'))
      .addSubcommand((sub) => sub
        .setName('reset')
        .setDescription('Reset the entire stock market and all portfolios'))
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
  const managedCommands = [...additionalCommands, ...commands];
  const managedNames = new Set(managedCommands.map((command) => command.name));
  const globalCommands = await client.application.commands.set(managedCommands);

  // Remove only the old guild-local stock commands so there is one global
  // command instead of duplicate guild + global versions. All other Elias
  // guild commands are left untouched.
  let guildsCleaned = 0;
  let guildsFailed = 0;

  for (const guild of client.guilds.cache.values()) {
    try {
      await guild.commands.set([]);

      guildsCleaned++;
    } catch (error) {
      guildsFailed++;
      console.warn(`Could not remove old stock guild commands from guild ${guild.id}:`, error?.message || error);
    }
  }

  console.log(
    `Registered global Elias economy/stock commands: ${globalCommands
      .filter((command) => managedNames.has(command.name))
      .map((command) => command.name)
      .join(', ')}. Old guild-local managed commands removed from ${guildsCleaned} guild(s), failed: ${guildsFailed}.`
  );
}

export async function handleStocksChatInput(interaction) {
  if (!interaction.isChatInputCommand()) return false;

  if (interaction.commandName === 'stocks') {
    const subcommand = interaction.options.getSubcommand(false);

    if (subcommand === 'reset') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        await interaction.reply({ content: '❌ Only server administrators can use this command.', ephemeral: true });
        return true;
      }

      if (interaction.user.id !== STOCK_OWNER_ID) {
        await interaction.reply({ content: '❌ Only the stock market owner can reset the stock market.', ephemeral: true });
        return true;
      }

      await interaction.deferReply({ ephemeral: true });
      try {
        await resetStocks();
        await interaction.editReply({
          content: '✅ Stock market reset. All stock prices are back to **75.00 Tokens**, supply is restored to **150 shares each**, and all portfolios have been cleared.'
        });
      } catch (error) {
        console.error('Stock reset error:', error?.message || error);
        await interaction.editReply({ content: '❌ I could not reset the stock market. Check the bot logs.' });
      }
      return true;
    }

    if (subcommand === 'view') {
      await interaction.deferReply();
      try {
        const stocks = await getStocks();
        await interaction.editReply({
          flags: MessageFlags.IsComponentsV2,
          components: buildStocksComponents(stocks)
        });
        const panelMessage = await interaction.fetchReply();
        startStockPanelRefresh(panelMessage);
      } catch (error) {
        console.error('Stock market load error:', error?.message || error);
        await interaction.editReply({
          flags: MessageFlags.IsComponentsV2,
          components: [new ContainerBuilder().addTextDisplayComponents(text('❌ The stock market database is not available yet. Run the stock section of `supabase/schema.sql` once, then try again.'))]
        });
      }
      return true;
    }

    await interaction.reply({
      content: '❌ Use `/stocks view`, `/stocks buy`, `/stocks sell`, or `/stocks reset`.',
      ephemeral: true
    });
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
  if (interaction.isButton()) {
    if (interaction.customId === 'stocks:buy') {
      await interaction.showModal(buildStockModal('buy'));
      return true;
    }

    if (interaction.customId === 'stocks:sell') {
      await interaction.showModal(buildStockModal('sell'));
      return true;
    }

    if (interaction.customId === 'stocks:refresh') {
      await interaction.deferUpdate();
      await refreshStockPanel(interaction.channelId);
      return true;
    }
  }

  if (interaction.isModalSubmit()) {
    if (interaction.customId === 'stocks:buy_modal' || interaction.customId === 'stocks:sell_modal') {
      const mode = interaction.customId === 'stocks:buy_modal' ? 'buy' : 'sell';
      await interaction.deferReply({ ephemeral: true });
      await processStockTrade(interaction, mode);
      return true;
    }
  }

  return false;
}
