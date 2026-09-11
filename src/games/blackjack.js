import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} from 'discord.js';

const games = new Map();

function cardLabel(card) {
  return `${card.rank}${card.suit}`;
}

function handValue(hand) {
  let total = 0;
  let aces = 0;
  for (const card of hand) {
    total += card.value;
    if (card.rank === 'A') aces++;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return total;
}

function makeDeck() {
  const suits = ['♠', '♥', '♦', '♣'];
  const ranks = [
    ['A', 11], ['2', 2], ['3', 3], ['4', 4], ['5', 5], ['6', 6],
    ['7', 7], ['8', 8], ['9', 9], ['10', 10], ['J', 10], ['Q', 10], ['K', 10]
  ];
  const deck = [];
  for (const suit of suits) {
    for (const [rank, value] of ranks) deck.push({ rank, suit, value });
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function draw(game) {
  return game.deck.pop();
}

function handText(hand) {
  return hand.map(cardLabel).join(' ');
}

function buttons(game, disabled = false) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`bj:${game.id}:hit`)
      .setLabel('Hit')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`bj:${game.id}:stand`)
      .setLabel('Stand')
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled)
  )];
}

function render(game, finished = false) {
  const playerValue = handValue(game.player);
  const dealerValue = finished ? handValue(game.dealer) : handValue(game.dealer.slice(1));
  const dealerCards = finished
    ? handText(game.dealer)
    : `🂠 ${cardLabel(game.dealer[1])}`;

  return `**Blackjack** 🃏\n\n` +
    `**Your hand:** ${handText(game.player)}  — **${playerValue}**\n` +
    `**Elias:** ${dealerCards}${finished ? `  — **${dealerValue}**` : ''}\n\n` +
    (finished ? game.result : 'Your move — **Hit** or **Stand**.');
}

async function finish(game, result, message) {
  game.finished = true;
  game.result = result;
  await message.edit({
    content: render(game, true),
    components: buttons(game, true)
  });
}

async function dealerTurn(game) {
  while (handValue(game.dealer) < 17) game.dealer.push(draw(game));
}

export function isBlackjackRequest(content) {
  return /\bblackjack\b/i.test(String(content || ''))
    && /\b(?:play|start|game|deal|deal me|let'?s|wanna)\b/i.test(String(content || ''))
    || /^\s*blackjack\s*$/i.test(String(content || ''));
}

export async function startBlackjack(message) {
  const existing = [...games.values()].find((game) =>
    game.userId === message.author.id && game.channelId === message.channelId && !game.finished
  );
  if (existing) {
    await message.reply({
      content: 'We already have a blackjack game going here 😭 Finish that one first.',
      allowedMentions: { repliedUser: false }
    });
    return true;
  }

  const deck = makeDeck();
  const game = {
    id: `${message.channelId}-${message.author.id}-${Date.now()}`,
    channelId: message.channelId,
    userId: message.author.id,
    deck,
    player: [draw({ deck }), draw({ deck })],
    dealer: [draw({ deck }), draw({ deck })],
    finished: false,
    result: ''
  };
  games.set(game.id, game);

  const playerValue = handValue(game.player);
  const dealerValue = handValue(game.dealer);

  if (playerValue === 21 || dealerValue === 21) {
    game.finished = true;
    if (playerValue === 21 && dealerValue === 21) game.result = '🤝 **Push!** You both have blackjack.';
    else if (playerValue === 21) game.result = '🎉 **Blackjack!** You win.';
    else game.result = '🤖 **Elias has blackjack!** You lose.';
    await message.reply({ content: render(game, true), components: buttons(game, true) });
    return true;
  }

  const gameMessage = await message.reply({
    content: render(game),
    components: buttons(game)
  });
  game.messageId = gameMessage.id;
  return true;
}

export async function handleBlackjackInteraction(interaction) {
  if (!interaction.isButton() || !interaction.customId.startsWith('bj:')) return false;

  const [, gameId, action] = interaction.customId.split(':');
  const game = games.get(gameId);
  await interaction.deferUpdate();

  if (!game || game.finished) return true;
  if (interaction.user.id !== game.userId) {
    await interaction.followUp({ content: 'This isn\'t your game 😭', ephemeral: true });
    return true;
  }

  if (action === 'hit') {
    game.player.push(draw(game));
    const value = handValue(game.player);
    if (value > 21) {
      await finish(game, `💀 **Bust!** You went over 21. Elias wins.`, interaction.message);
      return true;
    }
    if (value === 21) {
      await dealerTurn(game);
      const dealerValue = handValue(game.dealer);
      if (dealerValue > 21 || value > dealerValue) game.result = '🎉 **21! You win.**';
      else if (value === dealerValue) game.result = '🤝 **Push!** Same score.';
      else game.result = '🤖 **Elias wins.**';
      game.finished = true;
      await interaction.message.edit({ content: render(game, true), components: buttons(game, true) });
      return true;
    }

    await interaction.message.edit({ content: render(game), components: buttons(game) });
    return true;
  }

  if (action === 'stand') {
    await dealerTurn(game);
    const playerValue = handValue(game.player);
    const dealerValue = handValue(game.dealer);

    if (dealerValue > 21 || playerValue > dealerValue) game.result = '🎉 **You win!**';
    else if (playerValue === dealerValue) game.result = '🤝 **Push!** Nobody wins.';
    else game.result = '🤖 **Elias wins!**';
    game.finished = true;

    await interaction.message.edit({ content: render(game, true), components: buttons(game, true) });
    return true;
  }

  return true;
}
