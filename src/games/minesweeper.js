import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} from 'discord.js';

const games = new Map();

const DIFFICULTIES = {
  easy: { label: 'Easy', mines: 3, emoji: '🟢' },
  medium: { label: 'Medium', mines: 5, emoji: '🟡' },
  hard: { label: 'Hard', mines: 7, emoji: '🟠' },
  expert: { label: 'Expert', mines: 9, emoji: '🔴' }
};

const SIZE = 5;
const CELL_COUNT = SIZE * SIZE;

function neighbors(index) {
  const row = Math.floor(index / SIZE);
  const col = index % SIZE;
  const result = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const r = row + dr;
      const c = col + dc;
      if (r >= 0 && r < SIZE && c >= 0 && c < SIZE) result.push(r * SIZE + c);
    }
  }
  return result;
}

function placeMines(game, firstIndex) {
  const forbidden = new Set([firstIndex, ...neighbors(firstIndex)]);
  const available = Array.from({ length: CELL_COUNT }, (_, i) => i)
    .filter((index) => !forbidden.has(index));

  // Shuffle available cells.
  for (let i = available.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [available[i], available[j]] = [available[j], available[i]];
  }

  for (let i = 0; i < game.mineCount; i++) game.mines.add(available[i]);

  for (let i = 0; i < CELL_COUNT; i++) {
    if (game.mines.has(i)) continue;
    game.counts[i] = neighbors(i).filter((cell) => game.mines.has(cell)).length;
  }

  game.started = true;
}

function reveal(game, index) {
  if (game.revealed.has(index) || game.exploded || game.mines.has(index)) return;

  game.revealed.add(index);

  if (game.counts[index] !== 0) return;
  for (const next of neighbors(index)) reveal(game, next);
}

function revealAllMines(game) {
  for (const mine of game.mines) game.revealed.add(mine);
}

function checkWin(game) {
  const safeCells = CELL_COUNT - game.mineCount;
  if (game.revealed.size >= safeCells) {
    game.finished = true;
    game.result = `🎉 **You cleared it!** ${DIFFICULTIES[game.difficulty].label} difficulty beaten.`;
  }
}

function cellLabel(game, index) {
  if (!game.revealed.has(index)) return '·';
  if (game.mines.has(index)) return '💣';
  const count = game.counts[index];
  return count === 0 ? ' ' : String(count);
}

function cellStyle(game, index) {
  if (game.exploded && game.mines.has(index)) return ButtonStyle.Danger;
  if (!game.revealed.has(index)) return ButtonStyle.Secondary;
  return ButtonStyle.Success;
}

function boardButtons(game) {
  const rows = [];
  for (let row = 0; row < SIZE; row++) {
    const actionRow = new ActionRowBuilder();
    for (let col = 0; col < SIZE; col++) {
      const index = row * SIZE + col;
      actionRow.addComponents(
        new ButtonBuilder()
          .setCustomId(`mine:${game.id}:${index}`)
          .setLabel(cellLabel(game, index))
          .setStyle(cellStyle(game, index))
          .setDisabled(game.finished || game.revealed.has(index))
      );
    }
    rows.push(actionRow);
  }
  return rows;
}

function boardText(game) {
  const difficulty = DIFFICULTIES[game.difficulty];
  if (game.finished) return `**Minesweeper** 💣\n\n${game.result}\n\n${difficulty.emoji} ${difficulty.label} • ${difficulty.mines} mines`;
  return [
    '**Minesweeper** 💣',
    '',
    `Difficulty: **${difficulty.label}** • Mines: **${difficulty.mines}**`,
    game.started ? 'Click a covered tile to reveal it.' : 'Your first click is guaranteed safe — and clears its surrounding area.',
    '',
    'Numbers tell you how many mines touch that tile.'
  ].join('\n');
}

function difficultyButtons() {
  return [new ActionRowBuilder().addComponents(
    ...Object.entries(DIFFICULTIES).map(([key, difficulty]) =>
      new ButtonBuilder()
        .setCustomId(`mine:choose:${key}`)
        .setLabel(difficulty.label)
        .setEmoji(difficulty.emoji)
        .setStyle(key === 'easy' ? ButtonStyle.Success : key === 'medium' ? ButtonStyle.Primary : key === 'hard' ? ButtonStyle.Secondary : ButtonStyle.Danger)
    )
  )];
}

export function isMinesweeperRequest(content) {
  const text = String(content || '').trim();
  return /\bminesweeper\b/i.test(text)
    && /\b(?:play|start|game|let'?s|wanna)\b/i.test(text)
    || /^\s*minesweeper\s*$/i.test(text);
}

export async function startMinesweeper(message) {
  const existing = [...games.values()].find((game) =>
    game.userId === message.author.id && game.channelId === message.channelId && !game.finished
  );
  if (existing) {
    await message.reply({
      content: 'We already have a Minesweeper game going here 😭 Finish that one first.',
      allowedMentions: { repliedUser: false }
    });
    return true;
  }

  const game = {
    id: `${message.channelId}-${message.author.id}-${Date.now()}`,
    channelId: message.channelId,
    userId: message.author.id,
    difficulty: null,
    mineCount: 0,
    mines: new Set(),
    counts: Array(CELL_COUNT).fill(0),
    revealed: new Set(),
    started: false,
    exploded: false,
    finished: false,
    result: ''
  };
  games.set(game.id, game);

  const gameMessage = await message.reply({
    content: '**Minesweeper** 💣\n\nChoose your difficulty:',
    components: difficultyButtons()
  });
  game.messageId = gameMessage.id;
  return true;
}

export async function handleMinesweeperInteraction(interaction) {
  if (!interaction.isButton() || !interaction.customId.startsWith('mine:')) return false;

  const parts = interaction.customId.split(':');

  if (parts[1] === 'choose') {
    const difficulty = parts[2];
    const game = [...games.values()].find((item) => item.id.startsWith(`${interaction.channelId}-${interaction.user.id}-`) && !item.finished);

    if (!game) {
      await interaction.reply({ content: 'That Minesweeper setup expired. Start a new game.', ephemeral: true });
      return true;
    }
    if (interaction.user.id !== game.userId) {
      await interaction.reply({ content: "This isn't your Minesweeper 😭", ephemeral: true });
      return true;
    }

    game.difficulty = difficulty;
    game.mineCount = DIFFICULTIES[difficulty].mines;
    await interaction.update({
      content: boardText(game),
      components: boardButtons(game)
    });
    return true;
  }

  const [, gameId, indexText] = parts;
  const game = games.get(gameId);
  const index = Number(indexText);

  if (!game) {
    await interaction.reply({ content: 'That Minesweeper game no longer exists.', ephemeral: true });
    return true;
  }
  if (interaction.user.id !== game.userId) {
    await interaction.reply({ content: "This isn't your Minesweeper 😭", ephemeral: true });
    return true;
  }
  if (game.finished) {
    await interaction.reply({ content: 'This game is already over.', ephemeral: true });
    return true;
  }
  if (!Number.isInteger(index) || index < 0 || index >= CELL_COUNT || game.revealed.has(index)) return true;

  await interaction.deferUpdate();

  if (!game.started) placeMines(game, index);

  if (game.mines.has(index)) {
    game.exploded = true;
    game.finished = true;
    game.result = '💥 **Boom!** You hit a mine. Better luck next time.';
    revealAllMines(game);
  } else {
    reveal(game, index);
    checkWin(game);
  }

  await interaction.message.edit({
    content: boardText(game),
    components: boardButtons(game)
  });
  return true;
}
