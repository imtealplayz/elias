import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} from 'discord.js';
import { config } from '../config.js';
import {
  DEFAULT_BET,
  MAX_BET,
  getBalance,
  parseBet,
  hasExplicitBet,
  tryPlaceBet,
  settleBet,
  handleEconomyRequest,
  isDailyRequest,
  isBalanceRequest
} from '../economy.js';

const games = new Map();
const EMPTY = '⬜';
const X = '❌';
const O = '⭕';

function winner(board) {
  const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  for (const [a,b,c] of lines) if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  return board.every(Boolean) ? 'draw' : null;
}

function boardText(game, status) {
  const rows = [];
  for (let i = 0; i < 9; i += 3) rows.push(game.board.slice(i, i + 3).map((cell) => cell || EMPTY).join(' '));
  const wager = game.wager ? `\n💰 Wager: **${game.wager} els**` : '\n💰 **No wager**';
  return `**Tic-Tac-Toe** 🎮\n\n${rows.join('\n')}\n${wager}\n\n${status}`;
}

function buttonsFor(game, disabled = false) {
  const rows = [];
  for (let row = 0; row < 3; row++) {
    const actionRow = new ActionRowBuilder();
    for (let col = 0; col < 3; col++) {
      const index = row * 3 + col;
      actionRow.addComponents(new ButtonBuilder()
        .setCustomId(`ttt:${game.id}:${index}`)
        .setLabel(game.board[index] || '·')
        .setStyle(game.board[index] === X ? ButtonStyle.Danger : game.board[index] === O ? ButtonStyle.Primary : ButtonStyle.Secondary)
        .setDisabled(disabled || Boolean(game.board[index])));
    }
    rows.push(actionRow);
  }
  return rows;
}

function statusFor(game) {
  if (game.finished) return game.result;
  return game.turn === 'bot' ? `<@${game.botId}> **turn!**` : `<@${game.userId}> **turn!**`;
}

function evaluate(board, botMark, playerMark) {
  const result = winner(board);
  if (result === botMark) return 10;
  if (result === playerMark) return -10;
  if (result === 'draw') return 0;
  return null;
}

function minimax(board, depth, maximizing, botMark, playerMark) {
  const score = evaluate(board, botMark, playerMark);
  if (score !== null) return score === 0 ? 0 : score + (score > 0 ? -depth : depth);
  if (maximizing) {
    let best = -Infinity;
    for (let i = 0; i < 9; i++) if (!board[i]) {
      board[i] = botMark;
      best = Math.max(best, minimax(board, depth + 1, false, botMark, playerMark));
      board[i] = null;
    }
    return best;
  }
  let best = Infinity;
  for (let i = 0; i < 9; i++) if (!board[i]) {
    board[i] = playerMark;
    best = Math.min(best, minimax(board, depth + 1, true, botMark, playerMark));
    board[i] = null;
  }
  return best;
}

function chooseBotMove(game) {
  const bestMoves = [];
  let bestScore = -Infinity;
  for (let i = 0; i < 9; i++) {
    if (game.board[i]) continue;
    game.board[i] = game.botMark;
    const score = minimax(game.board, 0, false, game.botMark, game.playerMark);
    game.board[i] = null;
    if (score > bestScore) { bestScore = score; bestMoves.length = 0; bestMoves.push(i); }
    else if (score === bestScore) bestMoves.push(i);
  }
  return bestMoves[Math.floor(Math.random() * bestMoves.length)];
}

async function finishGame(game, result) {
  game.finished = true;
  if (result === 'draw') {
    game.result = '🤝 **Draw!** Nobody wins this one.';
    if (game.wager) await settleBet(config.guildId, game.userId, game.wager);
  } else if (result === game.botMark) {
    game.result = game.wager
      ? `🤖 **Elias wins!** You lost **${game.wager} els** 😭`
      : '🤖 **Elias wins!** Better luck next time 😌';
  } else {
    game.result = game.wager
      ? `<@${game.userId}> **wins!** You won **${game.wager} els**! 😭💰`
      : `<@${game.userId}> **wins!** Okay, okay... you got me. 😭`;
    if (game.wager) await settleBet(config.guildId, game.userId, game.wager * 2);
  }
}

async function render(game, message) {
  await message.edit({ content: boardText(game, statusFor(game)), components: buttonsFor(game, game.finished), allowedMentions: { users: [game.userId, game.botId] } });
}

async function makeBotMove(game, message) {
  if (game.finished || game.turn !== 'bot') return;
  const move = chooseBotMove(game);
  if (move === undefined) return;
  game.board[move] = game.botMark;
  const result = winner(game.board);
  if (result) await finishGame(game, result);
  else game.turn = 'player';
  await render(game, message);
}

function isCoinFlipRequest(content) {
  return /\b(?:coin\s*flip|flip\s+(?:a\s+)?coin|flip\s+(?:heads|tails)|heads\s+or\s+tails)\b/i.test(content);
}

function parseCoinSide(content) {
  const match = String(content || '').match(/\b(heads?|tails?)\b/i);
  if (!match) return 'heads';
  return match[1].toLowerCase().startsWith('tail') ? 'tails' : 'heads';
}

async function handleCoinFlip(message, content) {
  const requestedBet = parseBet(content);
  const placed = await tryPlaceBet(config.guildId, message.author.id, requestedBet);
  const wager = placed.wager;
  const side = parseCoinSide(content);
  const result = Math.random() < 0.5 ? 'heads' : 'tails';
  const won = side === result;

  if (!wager) {
    await message.reply(`🪙 **Coin flip!**\n\nYou picked **${side}**.\nIt landed on **${result}**!\n\n${placed.balance < requestedBet ? `You only have **${placed.balance} els**, so this one is for fun 😭` : ''}`);
    return true;
  }

  if (won) await settleBet(config.guildId, message.author.id, wager * 2);
  const balance = await getBalance(config.guildId, message.author.id);
  await message.reply(`🪙 **Coin flip!**\n\nYou bet **${wager} els** on **${side}**.\nIt landed on **${result}**!\n\n${won ? `🎉 **You won ${wager} els!**` : `💀 **You lost ${wager} els.**`}\n💰 Balance: **${balance} els**`);
  return true;
}

export function isTicTacToeRequest(content) {
  return /\b(?:play|start|let'?s\s+play|wanna\s+play)\b[\s\S]{0,80}\b(?:tic[ -]?tac[ -]?toe|ttt)\b/i.test(content)
    || /\b(?:tic[ -]?tac[ -]?toe|ttt)\b[\s\S]{0,30}\b(?:play|game)\b/i.test(content)
    || isCoinFlipRequest(content)
    || isDailyRequest(content)
    || isBalanceRequest(content);
}

export async function startTicTacToe(message) {
  const content = message.content.replace(new RegExp(`<@!?${message.client.user.id}>`, 'g'), '').trim();

  if (isDailyRequest(content) || isBalanceRequest(content)) return handleEconomyRequest(message, content);
  if (isCoinFlipRequest(content)) return handleCoinFlip(message, content);

  const existing = [...games.values()].find((game) => game.userId === message.author.id && game.channelId === message.channelId && !game.finished);
  if (existing) {
    await message.reply({ content: 'We already have a game going here 😭 Finish that one first.', allowedMentions: { repliedUser: false } });
    return true;
  }

  const requestedBet = parseBet(content);
  const placed = await tryPlaceBet(config.guildId, message.author.id, requestedBet);
  const wager = placed.wager;
  const botStarts = Math.random() < 0.5;
  const game = {
    id: `${message.channelId}-${message.author.id}-${Date.now()}`,
    channelId: message.channelId,
    userId: message.author.id,
    botId: message.client.user.id,
    board: Array(9).fill(null),
    playerMark: botStarts ? O : X,
    botMark: botStarts ? X : O,
    turn: botStarts ? 'bot' : 'player',
    wager,
    requestedBet,
    finished: false,
    result: ''
  };
  games.set(game.id, game);

  const betNote = wager
    ? `💰 **${wager} els** is on the line.`
    : placed.balance < requestedBet
      ? `💸 You don't have **${requestedBet} els**, so we're playing for fun.`
      : `💰 Playing with no wager.`;

  const gameMessage = await message.reply({
    content: `${boardText(game, statusFor(game))}\n${betNote}`,
    components: buttonsFor(game),
    allowedMentions: { repliedUser: false, users: [message.author.id, game.botId] }
  });

  if (botStarts) {
    await new Promise((resolve) => setTimeout(resolve, 650));
    await makeBotMove(game, gameMessage);
  }
  return true;
}

export async function handleTicTacToeInteraction(interaction) {
  if (!interaction.isButton() || !interaction.customId.startsWith('ttt:')) return false;
  const [, gameId, indexText] = interaction.customId.split(':');
  const game = games.get(gameId);
  const index = Number(indexText);
  await interaction.deferUpdate();

  if (!game || game.finished) return true;
  if (interaction.user.id !== game.userId) {
    await interaction.followUp({ content: 'This isn\'t your game 😭', ephemeral: true });
    return true;
  }
  if (game.turn !== 'player') {
    await interaction.followUp({ content: 'Hold up, it\'s my turn 😭', ephemeral: true });
    return true;
  }
  if (!Number.isInteger(index) || index < 0 || index > 8 || game.board[index]) return true;

  game.board[index] = game.playerMark;
  const result = winner(game.board);
  if (result) {
    await finishGame(game, result);
    await interaction.message.edit({ content: boardText(game, statusFor(game)), components: buttonsFor(game, true), allowedMentions: { users: [game.userId, game.botId] } });
    return true;
  }

  game.turn = 'bot';
  await interaction.message.edit({ content: boardText(game, statusFor(game)), components: buttonsFor(game), allowedMentions: { users: [game.userId, game.botId] } });
  await new Promise((resolve) => setTimeout(resolve, 650));
  await makeBotMove(game, interaction.message);
  return true;
}
