import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} from 'discord.js';
import { buyStock, getStocks, getUserPortfolio, sellStock } from './db.js';

const STOCK_PASSWORD = 'zip123';
const MAX_BUY_QUANTITY = 10;
const STOCK_CURRENCY_LABEL = 'Robux';

function buildStocksEmbed(stocks) {
  const lines = stocks.length
    ? stocks.map((stock) => '**' + stock.symbol + '** — ' + Number(stock.price).toFixed(2) + ' ' + STOCK_CURRENCY_LABEL)
    : ['No stocks are configured yet.'];

  return new EmbedBuilder()
    .setColor(0x00C2B8)
    .setTitle('📈 Stock Market')
    .setDescription([
      '------------',
      '**Available Stocks:** ' + stocks.length,
      '',
      ...lines,
      '',
      '------------',
      'Use the buttons below to buy or sell stocks.'
    ].join('\n'))
    .setFooter({ text: 'Demo market • Prices currently start at 75 Robux' });
}

function buildButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('stocks:buy').setLabel('Buy Stocks').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('stocks:sell').setLabel('Sell Stocks').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('stocks:refresh').setLabel('Refresh').setStyle(ButtonStyle.Secondary)
  );
}

function buildBuyModal() {
  return new ModalBuilder()
    .setCustomId('stocks:buy-modal')
    .setTitle('Buy Stocks')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('stock-symbol').setLabel('Stock symbol').setPlaceholder('e.g. ELIAS').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(12)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('stock-quantity').setLabel('Amount (1-10)').setPlaceholder('1').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(2)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('stock-password').setLabel('Password').setPlaceholder('Enter the buy password').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(64)
      )
    );
}

function buildSellModal() {
  return new ModalBuilder()
    .setCustomId('stocks:sell-modal')
    .setTitle('Sell Stocks')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('stock-symbol').setLabel('Stock symbol').setPlaceholder('e.g. ELIAS').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(12)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('stock-quantity').setLabel('Amount').setPlaceholder('1').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(6)
      )
    );
}

function parseQuantity(value, max = Number.MAX_SAFE_INTEGER) {
  const quantity = Number.parseInt(String(value || '').trim(), 10);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > max) return null;
  return quantity;
}

function normalizeSymbol(value) {
  return String(value || '').trim().toUpperCase();
}

export async function registerStockCommands(guild) {
  const existingCommands = await guild.commands.fetch();
  const commands = [
    { name: 'stocks', description: 'View the demo stock market' },
    { name: 'portfolio', description: 'View your stock portfolio' }
  ];

  for (const commandData of commands) {
    const existing = existingCommands.find((command) => command.name === commandData.name);
    if (existing) await existing.edit(commandData);
    else await guild.commands.create(commandData);
  }
}

export async function handleStocksChatInput(interaction) {
  if (!interaction.isChatInputCommand()) return false;

  if (interaction.commandName === 'stocks') {
    await interaction.deferReply();
    try {
      const stocks = await getStocks();
      await interaction.editReply({ embeds: [buildStocksEmbed(stocks)], components: [buildButtons()] });
    } catch (error) {
      console.error('Stock market load error:', error?.message || error);
      await interaction.editReply({
        content: '❌ The stock market database is not available yet. Run the stock section of supabase/schema.sql once, then try again.',
        embeds: [],
        components: []
      });
    }
    return true;
  }

  if (interaction.commandName === 'portfolio') {
    await interaction.deferReply({ ephemeral: true });
    let portfolio;
    try {
      portfolio = await getUserPortfolio(interaction.user.id);
    } catch (error) {
      console.error('Portfolio load error:', error?.message || error);
      await interaction.editReply({
        content: '❌ The stock market database is not available yet. Run the stock section of supabase/schema.sql once, then try again.'
      });
      return true;
    }
    const lines = portfolio.map((item) => {
      const value = Number(item.quantity) * Number(item.price);
      return '**' + item.symbol + '** — ' + item.quantity + ' owned • ' +
        Number(item.price).toFixed(2) + ' ' + STOCK_CURRENCY_LABEL + ' each • ' +
        value.toFixed(2) + ' ' + STOCK_CURRENCY_LABEL + ' total';
    });
    const totalValue = portfolio.reduce((sum, item) => sum + Number(item.quantity) * Number(item.price), 0);
    const embed = new EmbedBuilder()
      .setColor(0x00C2B8)
      .setTitle('💼 Portfolio')
      .setDescription(['------------', portfolio.length ? lines.join('\n') : 'You do not own any stocks yet.', '------------'].join('\n'))
      .setFooter({ text: portfolio.length + ' stock type(s) owned • Total value: ' + totalValue.toFixed(2) + ' ' + STOCK_CURRENCY_LABEL });
    await interaction.editReply({ embeds: [embed] });
    return true;
  }

  return false;
}

export async function handleStocksInteraction(interaction) {
  if (interaction.isButton()) {
    if (interaction.customId === 'stocks:buy') {
      await interaction.showModal(buildBuyModal());
      return true;
    }
    if (interaction.customId === 'stocks:sell') {
      await interaction.showModal(buildSellModal());
      return true;
    }
    if (interaction.customId === 'stocks:refresh') {
      await interaction.deferUpdate();
      try {
        const stocks = await getStocks();
        await interaction.editReply({ embeds: [buildStocksEmbed(stocks)], components: [buildButtons()] });
      } catch (error) {
        console.error('Stock refresh error:', error?.message || error);
      }
      return true;
    }
  }

  if (!interaction.isModalSubmit()) return false;

  const symbol = normalizeSymbol(interaction.fields.getTextInputValue('stock-symbol'));
  const quantity = parseQuantity(interaction.fields.getTextInputValue('stock-quantity'));

  if (interaction.customId === 'stocks:buy-modal') {
    const password = interaction.fields.getTextInputValue('stock-password').trim();
    if (password !== STOCK_PASSWORD) {
      await interaction.reply({ content: '❌ Incorrect password.', ephemeral: true });
      return true;
    }
    if (!parseQuantity(interaction.fields.getTextInputValue('stock-quantity'), MAX_BUY_QUANTITY)) {
      await interaction.reply({ content: '❌ You can buy between 1 and 10 stocks per purchase.', ephemeral: true });
      return true;
    }

    await interaction.deferReply({ ephemeral: true });
    try {
      const result = await buyStock(interaction.user.id, symbol, quantity);
      await interaction.editReply({
        content: '✅ Bought **' + quantity + ' ' + result.stock.symbol + '** at **' + Number(result.stock.price).toFixed(2) + ' ' + STOCK_CURRENCY_LABEL + '** each. Total value: **' + Number(result.totalValue).toFixed(2) + ' ' + STOCK_CURRENCY_LABEL + '**.'
      });
    } catch (error) {
      console.error('Stock purchase error:', error?.message || error);
      const message = error?.message === 'STOCK_NOT_FOUND'
        ? '❌ That stock does not exist. Check `/stocks` for the current symbols.'
        : '❌ I could not complete that purchase. Try again.';
      await interaction.editReply({ content: message });
    }
    return true;
  }

  if (interaction.customId === 'stocks:sell-modal') {
    if (!quantity) {
      await interaction.reply({ content: '❌ Enter a valid amount greater than 0.', ephemeral: true });
      return true;
    }

    await interaction.deferReply({ ephemeral: true });
    try {
      const result = await sellStock(interaction.user.id, symbol, quantity);
      await interaction.editReply({
        content: '✅ Sold **' + quantity + ' ' + result.stock.symbol + '** at **' + Number(result.stock.price).toFixed(2) + ' ' + STOCK_CURRENCY_LABEL + '** each. Total value: **' + Number(result.totalValue).toFixed(2) + ' ' + STOCK_CURRENCY_LABEL + '**.'
      });
    } catch (error) {
      console.error('Stock sale error:', error?.message || error);
      let message = '❌ I could not complete that sale. Try again.';
      if (error?.message === 'STOCK_NOT_FOUND') message = '❌ That stock does not exist. Check `/stocks` for the current symbols.';
      if (error?.message === 'INSUFFICIENT_SHARES') message = '❌ You do not own enough of that stock to sell that amount.';
      await interaction.reply({ content: message, ephemeral: true });
    }
    return true;
  }

  return false;
}