import { Client, GatewayIntentBits } from 'discord.js';
import { config } from './config.js';
import { handleStocksChatInput, handleStocksInteraction, registerStockCommands } from './stocks.js';
import { getEconomyCommands, handleEconomyChatInput, handleEconomyInteraction } from './economy.js';

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

process.on('unhandledRejection', (error) => {
  console.error('Unhandled promise rejection:', error);
});

client.on('interactionCreate', async (interaction) => {
  try {
    if (await handleStocksChatInput(interaction)) return;
    if (await handleEconomyChatInput(interaction)) return;
    if (await handleStocksInteraction(interaction)) return;
    await handleEconomyInteraction(interaction);
  } catch (error) {
    console.error('Interaction handler error:', error);

    if (interaction.isRepliable?.() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '❌ Something went wrong while processing that interaction.',
        flags: 64
      }).catch(() => {});
    }
  }
});

client.once('ready', async () => {
  console.log('Logged in as ' + client.user.tag);
  try {
    await registerStockCommands(client, config.guildId, getEconomyCommands());
    console.log('Stock and Teal economy commands registered globally.');
  } catch (error) {
    console.error('Failed to register commands:', error);
  }
});

client.login(config.token).catch((error) => {
  console.error('Discord login failed:', error);
});