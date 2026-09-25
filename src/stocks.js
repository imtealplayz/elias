import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SeparatorBuilder,
  SeparatorSpacingSize,
  SlashCommandBuilder,
  TextDisplayBuilder
} from 'discord.js';
import { config } from './config.js';
import { addBalance, formatTeal, getBalance, removeBalance, TEAL } from './teal.js';
import { buyStock, getStocks, getUserPortfolio, resetStocks, sellStock } from './db.js';

const STOCK_PASSWORD = 'zip123';
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
    .addTextDisplayComponents(text('Use **/stocks buy** to buy shares or **/stocks sell** to sell shares.'))
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
        .setDescription('View the demo stock market'))
      .addSubcommand((sub) => sub
        .setName('buy')
        .setDescription('Buy stocks')
        .addStringOption((o) => o
          .setName('symbol')
          .setDescription('Stock symbol')
          .setRequired(true)
          .addChoices(
            { name: 'ELIAS', value: 'ELIAS' },
            { name: 'NOVA', value: 'NOVA' },
            { name: 'BYTE', value: 'BYTE' }
          ))
        .addIntegerOption((o) => o.setName('amount').setDescription('Amount to buy (1-10)').setMinValue(1).setMaxValue(10).setRequired(true))
        .addStringOption((o) => o.setName('password').setDescription('Buy password').setRequired(true)))
      .addSubcommand((sub) => sub
        .setName('sell')
        .setDescription('Sell stocks')
        .addStringOption((o) => o
          .setName('symbol')
          .setDescription('Stock symbol')
          .setRequired(true)
          .addChoices(
            { name: 'ELIAS', value: 'ELIAS' },
            { name: 'NOVA', value: 'NOVA' },
            { name: 'BYTE', value: 'BYTE' }
          ))
        .addIntegerOption((o) => o.setName('amount').setDescription('Amount to sell').setMinValue(1).setRequired(true)))
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
          content: '✅ Stock market reset. All stock prices are back to **75.00 Teal**, supply is restored to **150 shares each**, and all portfolios have been cleared.'
        });
      } catch (error) {
        console.error('Stock reset error:', error?.message || error);
        await interaction.editReply({ content: '❌ I could not reset the stock market. Check the bot logs.' });
      }
      return true;
    }

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
        let charged = 0;
        try {
          const market = await getStocks();
          const stockPreview = market.find((stock) => stock.symbol === symbol);
          if (!stockPreview) throw new Error('STOCK_NOT_FOUND');

          const cost = Number((Number(stockPreview.price) * Number(quantity)).toFixed(2));
          const balance = await getBalance(config.guildId, interaction.user.id);
          if (balance < cost) {
            await interaction.editReply({
              content: '❌ You need **' + cost.toFixed(2) + ' ' + STOCK_CURRENCY_LABEL + '**, but only have **' + formatTeal(balance) + '**.'
            });
            return true;
          }

          const chargeAmount = Math.ceil(cost);
          await removeBalance(config.guildId, interaction.user.id, chargeAmount);
          charged = chargeAmount;

          const result = await buyStock(interaction.user.id, symbol, quantity);
          await interaction.editReply({
            content: '✅ Bought **' + quantity + ' ' + result.stock.symbol + '** for **' + charged.toLocaleString() + ' ' + STOCK_CURRENCY_LABEL + '**. New price: **' + Number(result.stock.price).toFixed(2) + ' ' + STOCK_CURRENCY_LABEL + '**.\nRemaining balance: **' + formatTeal(await getBalance(config.guildId, interaction.user.id)) + '**.'
          });
        } catch (error) {
          console.error('Stock purchase error:', error?.message || error);
          if (charged > 0) await addBalance(config.guildId, interaction.user.id, charged).catch(() => {});
          let message = '❌ I could not complete that purchase. Your Teal was refunded.';
          if (error?.message === 'STOCK_NOT_FOUND') message = '❌ That stock does not exist. Your Teal was not charged.';
          if (error?.message === 'INSUFFICIENT_SUPPLY') message = '❌ There are not enough shares of that stock left. Your Teal was refunded.';
          if (error?.message === 'INSUFFICIENT_FUNDS') message = '❌ You do not have enough Teal for that purchase.';
          await interaction.editReply({ content: message });
        }
        return true;
      }

      await interaction.deferReply({ ephemeral: true });
      try {
        const result = await sellStock(interaction.user.id, symbol, quantity);
        const saleValue = Math.floor(Number(result.totalValue || 0));
        const newBalance = await addBalance(config.guildId, interaction.user.id, saleValue);
        await interaction.editReply({
          content: '✅ Sold **' + quantity + ' ' + result.stock.symbol + '** for **' + saleValue.toLocaleString() + ' ' + STOCK_CURRENCY_LABEL + '**. New price: **' + Number(result.stock.price).toFixed(2) + ' ' + STOCK_CURRENCY_LABEL + '**.\nNew balance: **' + formatTeal(newBalance) + '**.'
        });
      } catch (error) {
        console.error('Stock sale error:', error?.message || error);
        let message = '❌ I could not complete that sale. Try again.';
        if (error?.message === 'STOCK_NOT_FOUND') message = '❌ That stock does not exist. Check `/stocks view` for the current symbols.';
        if (error?.message === 'INSUFFICIENT_SHARES') message = '❌ You do not own enough of that stock to sell that amount.';
        await interaction.editReply({ content: message });
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