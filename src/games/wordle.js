import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} from 'discord.js';

const games = new Map();

// A compact built-in dictionary keeps the game deterministic and avoids API calls.
const WORDS = [
  'about','above','abuse','actor','acute','admit','adopt','adore','after','again',
  'agent','agree','ahead','alarm','album','alert','alien','alive','allow','alone',
  'angel','anger','angle','anime','apart','apple','arena','argue','arise','array',
  'aside','asset','audio','avoid','award','aware','baker','basic','beach','begin',
  'being','below','bench','berry','birth','black','blade','blame','blank','blast',
  'blend','blind','block','blood','board','brain','brave','bread','break','brick',
  'bring','broad','brown','build','cable','carry','catch','cause','chain','chair',
  'charm','chase','cheap','check','chess','chief','child','claim','class','clean',
  'clear','click','clock','close','cloud','coach','coast','color','comic','coral',
  'count','court','cover','crash','crazy','cream','crime','cross','crowd','crown',
  'daily','dance','death','debug','delay','depth','devil','dream','drink','drive',
  'early','earth','eight','elite','empty','enemy','enjoy','enter','equal','error',
  'event','every','exact','extra','faith','false','fever','field','fight','final',
  'first','flame','flash','fleet','floor','focus','force','forest','frame','fresh',
  'front','fruit','funny','ghost','giant','given','glass','globe','glory','grace',
  'grade','grain','grand','grant','grape','graph','green','group','guard','guess',
  'guest','guide','happy','heart','heavy','hello','horse','house','human','ideal',
  'image','imply','index','input','issue','joker','judge','known','label','laser',
  'later','laugh','layer','learn','leave','level','light','limit','local','logic',
  'magic','major','maker','match','maybe','metal','model','money','month','mouse',
  'music','never','night','noble','noise','north','novel','nurse','ocean','offer',
  'often','order','other','outer','paint','panel','paper','party','peace','phone',
  'photo','piece','pilot','place','plain','plane','plant','plate','point','power',
  'press','price','pride','prime','print','prize','quick','quiet','radio','raise',
  'range','reach','react','ready','realm','reply','right','river','robot','rough',
  'round','route','royal','ruler','scale','scene','score','sense','serve','seven',
  'shade','shake','share','sharp','sheep','shift','shine','short','shown','sight',
  'since','skill','sleep','small','smart','smile','sound','space','spare','speak',
  'speed','spell','spend','spice','spike','split','sport','stack','stage','stand',
  'start','state','steam','steel','stick','still','stone','store','storm','story',
  'study','style','sugar','table','teach','thank','their','theme','there','thing',
  'think','third','three','throw','tight','timer','title','today','token','tower',
  'trace','track','trade','train','trash','treat','trend','trial','trick','truck',
  'trust','truth','under','union','unity','until','upper','value','video','visit',
  'voice','waste','watch','water','wheel','where','which','while','white','whole',
  'woman','world','worry','write','wrong','young','zebra'
];

const WORD_SET = new Set(WORDS);

function pickWord() {
  return WORDS[Math.floor(Math.random() * WORDS.length)];
}

function normalizeGuess(value) {
  return String(value || '').trim().toLowerCase();
}

function evaluateGuess(guess, target) {
  const result = Array(5).fill('absent');
  const remaining = {};

  for (let i = 0; i < 5; i++) {
    if (guess[i] === target[i]) result[i] = 'correct';
    else remaining[target[i]] = (remaining[target[i]] || 0) + 1;
  }

  for (let i = 0; i < 5; i++) {
    if (result[i] === 'correct') continue;
    const letter = guess[i];
    if (remaining[letter] > 0) {
      result[i] = 'present';
      remaining[letter]--;
    }
  }

  return result;
}

function tile(status, letter) {
  const square = status === 'correct' ? '🟩' : status === 'present' ? '🟨' : '⬛';
  return `${square} **${letter.toUpperCase()}**`;
}

function boardText(game) {
  const rows = game.guesses.map(({ guess, result }) =>
    result.map((status, i) => tile(status, guess[i])).join(' ')
  );
  while (rows.length < 5) rows.push('⬜ ⬜ ⬜ ⬜ ⬜');

  return [
    '**Wordle** 🟩🟨⬛',
    '',
    ...rows,
    '',
    '🟩 Correct position  •  🟨 Wrong position  •  ⬛ Not in word',
    game.finished ? game.result : `Attempt **${game.guesses.length + 1}/5** — use **Enter Guess** below.`
  ].join('\n');
}

function buttons(game, disabled = false) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`wordle:${game.id}:guess`)
      .setLabel('Enter Guess')
      .setEmoji('⌨️')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled)
  )];
}

export function isWordleRequest(content) {
  const text = String(content || '').trim();
  return /\bwordle\b/i.test(text)
    && /\b(?:play|start|game|let'?s|wanna)\b/i.test(text)
    || /^\s*wordle\s*$/i.test(text);
}

export async function startWordle(message) {
  const existing = [...games.values()].find((game) =>
    game.userId === message.author.id && game.channelId === message.channelId && !game.finished
  );
  if (existing) {
    await message.reply({
      content: 'We already have a Wordle game going here 😭 Finish that one first.',
      allowedMentions: { repliedUser: false }
    });
    return true;
  }

  const game = {
    id: `${message.channelId}-${message.author.id}-${Date.now()}`,
    channelId: message.channelId,
    userId: message.author.id,
    target: pickWord(),
    guesses: [],
    finished: false,
    result: ''
  };
  games.set(game.id, game);

  const gameMessage = await message.reply({
    content: boardText(game),
    components: buttons(game)
  });
  game.messageId = gameMessage.id;
  return true;
}

export async function handleWordleInteraction(interaction) {
  if (!interaction.isButton() && !interaction.isModalSubmit()) return false;

  if (interaction.isButton()) {
    if (!interaction.customId.startsWith('wordle:')) return false;
    const [, gameId, action] = interaction.customId.split(':');
    if (action !== 'guess') return false;

    const game = games.get(gameId);
    if (!game || game.finished) {
      await interaction.reply({ content: 'That Wordle game is already over.', ephemeral: true });
      return true;
    }
    if (interaction.user.id !== game.userId) {
      await interaction.reply({ content: "This isn't your Wordle 😭", ephemeral: true });
      return true;
    }

    const modal = new ModalBuilder()
      .setCustomId(`wordle:${game.id}:submit`)
      .setTitle('Enter your Wordle guess');

    const input = new TextInputBuilder()
      .setCustomId('guess')
      .setLabel('Your 5-letter guess')
      .setPlaceholder('e.g. CRANE')
      .setMinLength(5)
      .setMaxLength(5)
      .setRequired(true)
      .setStyle(TextInputStyle.Short);

    modal.addComponents(new ActionRowBuilder().addComponents(input));
    await interaction.showModal(modal);
    return true;
  }

  if (!interaction.customId.startsWith('wordle:') || !interaction.customId.endsWith(':submit')) return false;

  const [, gameId] = interaction.customId.split(':');
  const game = games.get(gameId);
  if (!game || game.finished) {
    await interaction.reply({ content: 'That Wordle game is already over.', ephemeral: true });
    return true;
  }
  if (interaction.user.id !== game.userId) {
    await interaction.reply({ content: "This isn't your Wordle 😭", ephemeral: true });
    return true;
  }

  const guess = normalizeGuess(interaction.fields.getTextInputValue('guess'));
  if (!/^[a-z]{5}$/.test(guess)) {
    await interaction.reply({ content: 'Enter exactly 5 letters.', ephemeral: true });
    return true;
  }
  if (!WORD_SET.has(guess)) {
    await interaction.reply({ content: `**${guess.toUpperCase()}** isn't in my word list. Try another word.`, ephemeral: true });
    return true;
  }

  const result = evaluateGuess(guess, game.target);
  game.guesses.push({ guess, result });

  if (guess === game.target) {
    game.finished = true;
    game.result = `🎉 **You got it!** The word was **${game.target.toUpperCase()}**. You solved it in **${game.guesses.length}/5** guesses.`;
  } else if (game.guesses.length >= 5) {
    game.finished = true;
    game.result = `💀 **Out of guesses!** The word was **${game.target.toUpperCase()}**.`;
  }

  await interaction.reply({
    content: 'Guess submitted! 👀',
    ephemeral: true
  });
  await interaction.message.edit({
    content: boardText(game),
    components: buttons(game, game.finished)
  });
  return true;
}
