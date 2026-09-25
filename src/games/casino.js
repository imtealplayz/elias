import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } from 'discord.js';
import { getBalance, addBalance, removeBalance, recordGame, baseEmbed, COLORS, TEAL as R } from '../teal.js';

// ─── Active Game Tracker ──────────────────────────────────────────────────────
// Tracks which users currently have an active game running.
// Key: `${guildId}-${userId}`, Value: game name string

const activeGames = new Map();

function startGame(guildId, userId, gameName) {
  activeGames.set(`${guildId}-${userId}`, gameName);
}

function endGame(guildId, userId) {
  activeGames.delete(`${guildId}-${userId}`);
}

function getActiveGame(guildId, userId) {
  return activeGames.get(`${guildId}-${userId}`) || null;
}

// Call at the start of every game — returns true if blocked
async function checkActiveGame(interaction, guildId, userId) {
  const active = getActiveGame(guildId, userId);
  if (!active) return false;
  await interaction.reply({
    embeds: [baseEmbed("⏳ Game Already Running", COLORS.red)
      .setDescription(
        `You already have an active **${active}** game!\n\n` +
        `Finish or cash out your current game first.\n` +
        `If your game is frozen, use \`/unfreeze\` to clear it (no refund).`
      )],
    flags: MessageFlags.Ephemeral
  });
  return true;
}

// ─── /unfreeze ────────────────────────────────────────────────────────────────

async function cmdUnfreeze(interaction, userId, guildId) {
  const active = getActiveGame(guildId, userId);

  // Also check persistent game maps for dangling state
  const bjKey     = `${guildId}-${userId}`;
  const hasBj     = bjGames.has(bjKey);
  const hasMines  = mineGames.has(bjKey);
  const hasTowers = towerGames.has(bjKey);
  const hasCrash  = crashGames.has(bjKey);

  if (!active && !hasBj && !hasMines && !hasTowers && !hasCrash) {
    return interaction.reply({
      embeds: [baseEmbed("✅ No Active Game", COLORS.green)
        .setDescription("You don't have any frozen or active games to clear.")],
      flags: MessageFlags.Ephemeral
    });
  }

  // Clear everything — no refund
  endGame(guildId, userId);
  bjGames.delete(bjKey);
  mineGames.delete(bjKey);
  towerGames.delete(bjKey);
  crashGames.delete(bjKey);

  await interaction.reply({
    embeds: [baseEmbed("🔓 Game Cleared", COLORS.gold)
      .setDescription(
        `Your frozen **${active || "game"}** has been cleared.\n\n` +
        `⚠️ No refund is given for cleared games.\n` +
        `You can now start a new game.`
      )],
    flags: MessageFlags.Ephemeral
  });
}



// ─── Helpers ──────────────────────────────────────────────────────────────────

function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

// Apply 10% house fee on payouts >= 20. Returns the net payout after fee.
function applyFee(payout) {
  if (payout < 20) return payout;
  return Math.floor(payout * 0.90); // keep 90%, house takes 10%
}

// Returns a string showing gross, fee, and net: "180 R (200 R − 20 R fee)"
function feeDisplay(gross, net) {
  if (gross === net || gross < 20) return `${net.toLocaleString()} ${R}`;
  const fee = gross - net;
  return `${net.toLocaleString()} ${R} *(${gross.toLocaleString()} − ${fee.toLocaleString()} fee)*`;
}

// Promotions, deposit bonuses, cashback and wager-role rewards are intentionally
// not part of Elias. These no-op helpers preserve the casino payout flow.
function applyActiveBonusToWin(_guildId, _userId, grossPayout) {
  return { adjustedPayout: grossPayout, bonusMsg: '' };
}

function applyActiveBonusOnLoss(_guildId, _userId, _bet) {
  return { cashback: 0, bonusMsg: '' };
}

async function checkWagerRole() {
  // Intentionally disabled in Elias.
}

async function validateBet(interaction, guildId, userId, bet) {
  bet = parseInt(bet);
  if (!bet || isNaN(bet) || bet < 1) {
    await interaction.reply({ embeds: [baseEmbed("❌ Invalid Bet", COLORS.red).setDescription(`Minimum bet is **1 ${R}**.\n\nExample: \`$slots 5\``)], flags: MessageFlags.Ephemeral });
    return false;
  }
  const bal = await getBalance(guildId, userId);
  if (bal < bet) {
    await interaction.reply({ embeds: [baseEmbed("❌ Insufficient Funds", COLORS.red).setDescription(`You need **${bet.toLocaleString()} ${R}** but only have **${bal.toLocaleString()} ${R}**.`)], flags: MessageFlags.Ephemeral });
    return false;
  }
  return true;
}

// ─── SLOTS ────────────────────────────────────────────────────────────────────

const SLOT_SYMBOLS = [
  { emoji: "🍒", weight: 30, mult: 2 },
  { emoji: "🍋", weight: 25, mult: 2.5 },
  { emoji: "🍊", weight: 20, mult: 3 },
  { emoji: "🍇", weight: 15, mult: 4 },
  { emoji: "💎", weight: 7,  mult: 8 },
  { emoji: "7️⃣",  weight: 3,  mult: 20 },
];

function spinSlot() {
  const total = SLOT_SYMBOLS.reduce((s, x) => s + x.weight, 0);
  let r = Math.random() * total;
  for (const s of SLOT_SYMBOLS) { if ((r -= s.weight) <= 0) return s; }
  return SLOT_SYMBOLS[0];
}

async function cmdSlots(interaction, userId, guildId, bet) {
  if (await checkActiveGame(interaction, guildId, userId)) return;
  bet = parseInt(bet);
  if (!await validateBet(interaction, guildId, userId, bet)) return;
  startGame(guildId, userId, "Slots");
  await removeBalance(guildId, userId, bet);

  const reels = [spinSlot(), spinSlot(), spinSlot()];
  const display = reels.map(r => r.emoji).join("  ");
  let winnings = 0, resultText = "", winDisplay = "";

  if (reels[0].emoji === reels[1].emoji && reels[1].emoji === reels[2].emoji) {
    const gross = Math.floor(bet * reels[0].mult);
    const net   = applyFee(gross);
    const { adjustedPayout, bonusMsg } = applyActiveBonusToWin(guildId, userId, net);
    winnings = adjustedPayout;
    resultText = `🎉 **JACKPOT!** All three match! ×${reels[0].mult}${bonusMsg}`;
    winDisplay = feeDisplay(gross, net) + (adjustedPayout !== net ? ` → **${adjustedPayout.toLocaleString()} ${R}** (bonus)` : "");
    await addBalance(guildId, userId, winnings);
  } else if (reels[0].emoji === reels[1].emoji || reels[1].emoji === reels[2].emoji || reels[0].emoji === reels[2].emoji) {
    const gross = Math.floor(bet * 1.5);
    const net   = applyFee(gross);
    const { adjustedPayout, bonusMsg } = applyActiveBonusToWin(guildId, userId, net);
    winnings = adjustedPayout;
    resultText = `✨ **Two of a kind!** ×1.5${bonusMsg}`;
    winDisplay = feeDisplay(gross, net) + (adjustedPayout !== net ? ` → **${adjustedPayout.toLocaleString()} ${R}** (bonus)` : "");
    await addBalance(guildId, userId, winnings);
  } else {
    const { cashback, bonusMsg } = applyActiveBonusOnLoss(guildId, userId, bet);
    resultText = `😔 **No match.** Better luck next time!${bonusMsg}`;
  }

  const profit = winnings > 0 ? winnings - bet : -bet;
  const rr = await recordGame(guildId, userId, "slots", bet, profit);
  await checkWagerRole();

  const embed = baseEmbed("🎰 Slot Machine", winnings > 0 ? COLORS.green : COLORS.red)
    .setDescription(`┌─────────────────┐\n│  ${display}  │\n└─────────────────┘\n\n${resultText}`)
    .addFields(
      { name: "Bet",    value: `${bet.toLocaleString()} ${R}`,                                                          inline: true },
      { name: winnings > 0 ? "Won" : "Lost", value: winnings > 0 ? `+${winDisplay}` : `-${bet.toLocaleString()} ${R}`, inline: true },
      { name: "Balance", value: `${(await getBalance(guildId, userId)).toLocaleString()} ${R}`,                                 inline: true }
    );

  await interaction.reply({ embeds: [embed] });
  endGame(guildId, userId);
}

// ─── COINFLIP ─────────────────────────────────────────────────────────────────

async function cmdCoinflip(interaction, userId, guildId, bet, choice) {
  if (await checkActiveGame(interaction, guildId, userId)) return;
  bet = parseInt(bet);
  if (!await validateBet(interaction, guildId, userId, bet)) return;
  if (!choice || !["heads", "tails"].includes(choice.toLowerCase())) {
    return interaction.reply({ embeds: [baseEmbed("❌ Invalid Choice", COLORS.red).setDescription("Choose **heads** or **tails**.")], flags: MessageFlags.Ephemeral });
  }
  startGame(guildId, userId, "Coinflip");

  const choiceFmt = choice.toLowerCase() === "heads" ? "🟡 Heads" : "⚪ Tails";
  const confirmEmbed = baseEmbed("🪙 Coinflip — Confirm", COLORS.blue)
    .setDescription(`You're betting **${bet.toLocaleString()} ${R}** on **${choiceFmt}**.\n\nAre you sure?`);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("cf_confirm").setLabel("✅ Flip it!").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("cf_cancel").setLabel("❌ Cancel").setStyle(ButtonStyle.Danger)
  );

  await interaction.reply({ embeds: [confirmEmbed], components: [row] });
  const msg = typeof interaction.fetchReply === "function" ? await interaction.fetchReply() : null;

  const collector = (msg || interaction).createMessageComponentCollector
    ? (msg || interaction).createMessageComponentCollector({ time: 30000, max: 1 })
    : null;

  if (!collector) return;

  collector.on("collect", async (btn) => {
    if (btn.user.id !== userId) return btn.reply({ content: "Not your game!", flags: MessageFlags.Ephemeral });
    await btn.deferUpdate();

    if (btn.customId === "cf_cancel") {
      endGame(guildId, userId);
      const cancelEmbed = baseEmbed("🪙 Coinflip Cancelled", COLORS.red).setDescription("Bet cancelled. No coins were deducted.");
      return btn.editReply({ embeds: [cancelEmbed], components: [] });
    }

    await removeBalance(guildId, userId, bet);
    const spinFrames = ["🪙", "🌀", "🪙", "🌀", "🪙", "🌀"];
    const spinEmbed = (frame) => baseEmbed("🪙 Coinflip", 0xF4C542)
      .setDescription(`${frame} **Flipping...**\n\nYour pick: **${choiceFmt}**`)
      .addFields({ name: "Bet", value: `${bet.toLocaleString()} ${R}`, inline: true });

    await btn.editReply({ embeds: [spinEmbed(spinFrames[0])], components: [] });

    let spinIdx = 1;
    const spinInterval = setInterval(async () => {
      if (spinIdx >= spinFrames.length) {
        clearInterval(spinInterval);
        const result = Math.random() < 0.48 ? choice.toLowerCase() : (choice.toLowerCase() === "heads" ? "tails" : "heads");
        const won = result === choice.toLowerCase();
        const gross    = won ? bet * 2 : 0;
        const cfNet    = won ? applyFee(gross) : 0;
        const { adjustedPayout: cfPayout, bonusMsg } = won
          ? applyActiveBonusToWin(guildId, userId, cfNet)
          : { adjustedPayout: 0, bonusMsg: "" };
        const { cashback, bonusMsg: lossMsg } = !won ? applyActiveBonusOnLoss(guildId, userId, bet) : { cashback: 0, bonusMsg: "" };
        if (won) await addBalance(guildId, userId, cfPayout);
        const rr = await recordGame(guildId, userId, "coinflip", bet, won ? cfPayout - bet : -bet);
        await checkWagerRole(btn, guildId, userId, rr);
        const resultFmt = result === "heads" ? "🟡 Heads" : "⚪ Tails";
        const winStr = won
          ? `+${feeDisplay(gross, cfNet)}${cfPayout !== cfNet ? ` → **${cfPayout.toLocaleString()} ${R}** (bonus)` : ""}`
          : `-${bet.toLocaleString()} ${R}`;
        const embed = baseEmbed(won ? "🪙 You Won!" : "🪙 You Lost!", won ? COLORS.green : COLORS.red)
          .setDescription(`The coin landed on **${resultFmt}**!${won ? bonusMsg : lossMsg}`)
          .addFields(
            { name: "Your Pick", value: choiceFmt, inline: true },
            { name: won ? "Won" : "Lost", value: winStr, inline: true },
            { name: "Balance", value: `${(await getBalance(guildId, userId)).toLocaleString()} ${R}`, inline: true }
          );
        await btn.editReply({ embeds: [embed], components: [] }).catch(() => {});
        endGame(guildId, userId);
        return;
      }
      await btn.editReply({ embeds: [spinEmbed(spinFrames[spinIdx])], components: [] }).catch(() => {});
      spinIdx++;
    }, 350);
  });

  collector.on("end", (_, reason) => {
    if (reason === "time") {
      endGame(guildId, userId);
      interaction.editReply({ embeds: [baseEmbed("🪙 Coinflip Expired", COLORS.red).setDescription("You didn't confirm in time.")], components: [] }).catch(() => {});
    }
  });
}

// ─── ROULETTE ─────────────────────────────────────────────────────────────────

const RED_NUMS = [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];

async function cmdRoulette(interaction, userId, guildId, bet, betType) {
  if (await checkActiveGame(interaction, guildId, userId)) return;
  bet = parseInt(bet);
  if (!await validateBet(interaction, guildId, userId, bet)) return;
  if (!betType) {
    return interaction.reply({ embeds: [baseEmbed("❌ Invalid Bet Type", COLORS.red).setDescription("Options: `red` `black` `green` `even` `odd` or a number 0–36")], flags: MessageFlags.Ephemeral });
  }
  startGame(guildId, userId, "Roulette");

  const bt = betType.toLowerCase();
  const validTypes = ["red","black","green","even","odd"];
  const isNumBet = !isNaN(parseInt(bt)) && parseInt(bt) >= 0 && parseInt(bt) <= 36;
  if (!validTypes.includes(bt) && !isNumBet) {
    return interaction.reply({ embeds: [baseEmbed("❌ Invalid Bet Type", COLORS.red).setDescription("Options: `red` `black` `green` `even` `odd` or a number 0–36")], flags: MessageFlags.Ephemeral });
  }

  const confirmEmbed = baseEmbed("🎡 Roulette — Confirm", COLORS.blue)
    .setDescription(`You're betting **${bet.toLocaleString()} ${R}** on **${betType}**.\n\nAre you sure?`);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("rl_confirm").setLabel("✅ Spin!").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("rl_cancel").setLabel("❌ Cancel").setStyle(ButtonStyle.Danger)
  );

  await interaction.reply({ embeds: [confirmEmbed], components: [row] });
  const msg = typeof interaction.fetchReply === "function" ? await interaction.fetchReply() : null;
  const collector = (msg || interaction).createMessageComponentCollector({ time: 30000, max: 1 });

  collector.on("collect", async (btn) => {
    if (btn.user.id !== userId) return btn.reply({ content: "Not your game!", flags: MessageFlags.Ephemeral });
    await btn.deferUpdate();

    if (btn.customId === "rl_cancel") {
      endGame(guildId, userId);
      return btn.editReply({ embeds: [baseEmbed("🎡 Roulette Cancelled", COLORS.red).setDescription("Bet cancelled.")], components: [] });
    }

    await removeBalance(guildId, userId, bet);

    const wheelFrames = ["🔴⚫🟢🔴⚫", "⚫🟢🔴⚫🔴", "🟢🔴⚫🔴⚫", "🔴⚫🔴🟢⚫", "⚫🔴⚫⚫🟢"];
    const spinEmbed = (frame) => baseEmbed("🎡 Roulette", 0xF4C542)
      .setDescription(`${frame}\n\n🎲 **Spinning the wheel...**\n\nYour bet: **${betType}**`)
      .addFields({ name: "Bet", value: `${bet.toLocaleString()} ${R}`, inline: true });

    await btn.editReply({ embeds: [spinEmbed(wheelFrames[0])], components: [] });

    let spinIdx = 1;
    const spinInterval = setInterval(async () => {
      if (spinIdx >= wheelFrames.length) {
        clearInterval(spinInterval);

        // Resolve
        const num = randInt(0, 36);
        const isRed = RED_NUMS.includes(num);
        const color = num === 0 ? "green" : isRed ? "red" : "black";
        const isEven = num !== 0 && num % 2 === 0;

        let won = false, mult = 1;
        if (bt === "red"   && color === "red")             { won = true; mult = 2; }
        if (bt === "black" && color === "black")           { won = true; mult = 2; }
        if (bt === "even"  && isEven)                      { won = true; mult = 2; }
        if (bt === "odd"   && !isEven && num !== 0)        { won = true; mult = 2; }
        if (bt === "green" && color === "green")           { won = true; mult = 14; }
        if (!isNaN(parseInt(bt)) && parseInt(bt) === num) { won = true; mult = 36; }

        const gross    = won ? Math.floor(bet * mult) : 0;
        const winnings = won ? applyFee(gross) : 0;
        const { adjustedPayout: rlPayout, bonusMsg } = won
          ? applyActiveBonusToWin(guildId, userId, winnings)
          : { adjustedPayout: 0, bonusMsg: "" };
        const { cashback, bonusMsg: lossMsg } = !won ? applyActiveBonusOnLoss(guildId, userId, bet) : { cashback: 0, bonusMsg: "" };
        if (won) await addBalance(guildId, userId, rlPayout);
        const rr = await recordGame(guildId, userId, "roulette", bet, won ? rlPayout - bet : -bet);
        await checkWagerRole(btn, guildId, userId, rr);

        const colorEmoji = { red: "🔴", black: "⚫", green: "🟢" };
        const winStr = won
          ? `+${feeDisplay(gross, winnings)}${rlPayout !== winnings ? ` → **${rlPayout.toLocaleString()} ${R}** (bonus)` : ""}`
          : `-${bet.toLocaleString()} ${R}`;
        const embed = baseEmbed("🎡 Roulette", won ? COLORS.green : COLORS.red)
          .setDescription(`The ball landed on **${colorEmoji[color]} ${num}**!${won ? bonusMsg : lossMsg}`)
          .addFields(
            { name: "Your Bet", value: `\`${betType}\``, inline: true },
            { name: won ? "Won" : "Lost", value: winStr, inline: true },
            { name: "Balance", value: `${(await getBalance(guildId, userId)).toLocaleString()} ${R}`, inline: true }
          );

        await btn.editReply({ embeds: [embed], components: [] }).catch(() => {});
        endGame(guildId, userId);
        return;
      }
      await btn.editReply({ embeds: [spinEmbed(wheelFrames[spinIdx])], components: [] }).catch(() => {});
      spinIdx++;
    }, 400);
  });

  collector.on("end", (_, reason) => {
    if (reason === "time") {
      endGame(guildId, userId);
      (msg || interaction).editReply?.({ embeds: [baseEmbed("🎡 Roulette Expired", COLORS.red).setDescription("You didn't confirm in time.")], components: [] }).catch(() => {});
    }
  });
}

// ─── BLACKJACK ────────────────────────────────────────────────────────────────

const SUITS = ["♠", "♥", "♦", "♣"];
const RANKS = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];

function newDeck() {
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) deck.push({ r, s });
  return deck.sort(() => Math.random() - 0.5);
}

function cardValue(card) { return ["J","Q","K"].includes(card.r) ? 10 : card.r === "A" ? 11 : parseInt(card.r); }
function handValue(hand) {
  let total = hand.reduce((s, c) => s + cardValue(c), 0);
  let aces = hand.filter(c => c.r === "A").length;
  while (total > 21 && aces-- > 0) total -= 10;
  return total;
}
function showHand(hand) { return hand.map(c => `\`${c.r}${c.s}\``).join(" "); }

const bjGames = new Map();

async function cmdBlackjack(interaction, userId, guildId, bet) {
  if (await checkActiveGame(interaction, guildId, userId)) return;
  bet = parseInt(bet);
  if (!await validateBet(interaction, guildId, userId, bet)) return;
  startGame(guildId, userId, "Blackjack");
  await removeBalance(guildId, userId, bet);

  const deck = newDeck();
  const playerHand = [deck.pop(), deck.pop()];
  const dealerHand = [deck.pop(), deck.pop()];
  const pVal = handValue(playerHand);

  if (pVal === 21) {
    const gross = Math.floor(bet * 2.5);
    const win   = applyFee(gross);
    const { adjustedPayout: bjPayout, bonusMsg } = applyActiveBonusToWin(guildId, userId, win);
    await addBalance(guildId, userId, bjPayout);
    const rr = await recordGame(guildId, userId, "blackjack", bet, bjPayout - bet);
    await checkWagerRole();
    endGame(guildId, userId);
    const embed = baseEmbed("🃏 Blackjack — Blackjack!", COLORS.gold)
      .setDescription(`**Your Hand:** ${showHand(playerHand)} = **21**\n**Dealer:** ${showHand([dealerHand[0]])} + 🂠\n\n🎉 **BLACKJACK! ×2.5!**${bonusMsg}`)
      .addFields(
        { name: "Won",     value: `+${feeDisplay(gross, win)}${bjPayout !== win ? ` → **${bjPayout.toLocaleString()} ${R}** (bonus)` : ""}`, inline: true },
        { name: "Balance", value: `${(await getBalance(guildId, userId)).toLocaleString()} ${R}`, inline: true }
      );
    return interaction.reply({ embeds: [embed] });
  }

  bjGames.set(`${guildId}-${userId}`, { deck, playerHand, dealerHand, bet, guildId, userId });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("bj_hit").setLabel("👊 Hit").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("bj_stand").setLabel("✋ Stand").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("bj_double").setLabel("💰 Double Down").setStyle(ButtonStyle.Success)
  );

  const embed = baseEmbed("🃏 Blackjack", COLORS.blue)
    .setDescription(`**Your Hand:** ${showHand(playerHand)} = **${pVal}**\n**Dealer:** ${showHand([dealerHand[0]])} + 🂠\n\nWhat will you do?`)
    .addFields(
      { name: "Bet",     value: `${bet.toLocaleString()} ${R}`,                         inline: true },
      { name: "Balance", value: `${(await getBalance(guildId, userId)).toLocaleString()} ${R}`, inline: true }
    );

  await interaction.reply({ embeds: [embed], components: [row] });
}

async function handleBlackjack(interaction) {
  await interaction.deferUpdate();
  const { customId, user, guildId } = interaction;
  const key = `${guildId}-${user.id}`;
  const game = bjGames.get(key);

  if (!game) return interaction.followUp({ content: "No active blackjack game!", flags: MessageFlags.Ephemeral });
  if (game.userId !== user.id) return interaction.followUp({ content: "Not your game!", flags: MessageFlags.Ephemeral });

  const { deck, playerHand, dealerHand } = game;
  let { bet } = game;

  if (customId === "bj_hit" || customId === "bj_double") {
    if (customId === "bj_double") {
      if (await getBalance(guildId, user.id) < bet) return interaction.followUp({ content: "Not enough coins to double down!", flags: MessageFlags.Ephemeral });
      await removeBalance(guildId, user.id, bet);
      bet *= 2;
      game.bet = bet;
    }

    playerHand.push(deck.pop());
    const pVal = handValue(playerHand);

    if (pVal > 21) {
      bjGames.delete(key);
      await recordGame(guildId, user.id, "blackjack", bet, -bet);
      endGame(guildId, user.id);
      const embed = baseEmbed("🃏 Blackjack — Bust!", COLORS.red)
        .setDescription(`**Your Hand:** ${showHand(playerHand)} = **${pVal}** 💥 BUST!`)
        .addFields(
          { name: "Lost",    value: `-${bet.toLocaleString()} ${R}`, inline: true },
          { name: "Balance", value: `${(await getBalance(guildId, user.id)).toLocaleString()} ${R}`, inline: true }
        );
      return interaction.editReply({ embeds: [embed], components: [] });
    }

    if (customId === "bj_double") {
      bjGames.delete(key);
      return resolveBlackjack(interaction, { ...game, bet, playerHand, dealerHand, deck });
    }

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("bj_hit").setLabel("👊 Hit").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("bj_stand").setLabel("✋ Stand").setStyle(ButtonStyle.Secondary)
    );
    const embed = baseEmbed("🃏 Blackjack", COLORS.blue)
      .setDescription(`**Your Hand:** ${showHand(playerHand)} = **${pVal}**\n**Dealer:** ${showHand([dealerHand[0]])} + 🂠`)
      .addFields({ name: "Bet", value: `${bet.toLocaleString()} ${R}`, inline: true });
    return interaction.editReply({ embeds: [embed], components: [row] });
  }

  if (customId === "bj_stand") {
    bjGames.delete(key);
    return resolveBlackjack(interaction, game);
  }
}

async function resolveBlackjack(interaction, game) {
  const { deck, playerHand, dealerHand, bet, guildId, userId } = game;
  while (handValue(dealerHand) < 17) dealerHand.push(deck.pop());

  const pVal = handValue(playerHand);
  const dVal = handValue(dealerHand);
  let result, winnings = 0, color, bonusMsg = "", winFieldVal = "";

  if (dVal > 21 || pVal > dVal) {
    const gross = bet * 2;
    const net   = applyFee(gross);
    const { adjustedPayout, bonusMsg: bm } = applyActiveBonusToWin(guildId, userId, net);
    winnings = adjustedPayout; bonusMsg = bm; color = COLORS.green;
    result = "🎉 **You Win!**";
    winFieldVal = `+${feeDisplay(gross, net)}${adjustedPayout !== net ? ` → **${adjustedPayout.toLocaleString()} ${R}** (bonus)` : ""}`;
    await addBalance(guildId, userId, winnings);
  } else if (pVal === dVal) {
    winnings = bet; color = COLORS.blue; // tie — no fee
    result = "🤝 **Push! Tie.**";
    winFieldVal = `±0 ${R}`;
    await addBalance(guildId, userId, winnings);
  } else {
    color = COLORS.red;
    result = "😔 **Dealer Wins.**";
    const { bonusMsg: lm } = applyActiveBonusOnLoss(guildId, userId, bet);
    bonusMsg = lm;
    winFieldVal = `-${bet.toLocaleString()} ${R}`;
  }

  const profit = winnings > bet ? winnings - bet : winnings === bet ? 0 : -bet;
  const rr = await recordGame(guildId, userId, "blackjack", bet, profit);
  await checkWagerRole();
  endGame(guildId, userId);

  const embed = baseEmbed("🃏 Blackjack — Result", color)
    .setDescription(`**Your Hand:** ${showHand(playerHand)} = **${pVal}**\n**Dealer Hand:** ${showHand(dealerHand)} = **${dVal}**\n\n${result}${bonusMsg}`)
    .addFields(
      { name: "Bet",     value: `${bet.toLocaleString()} ${R}`, inline: true },
      { name: "Result",  value: winFieldVal,                    inline: true },
      { name: "Balance", value: `${(await getBalance(guildId, userId)).toLocaleString()} ${R}`, inline: true }
    );

  await interaction.editReply({ embeds: [embed], components: [] });
}

// ─── CRASH ────────────────────────────────────────────────────────────────────

const crashGames = new Map();

async function cmdCrash(interaction, userId, guildId, bet) {
  if (await checkActiveGame(interaction, guildId, userId)) return;
  bet = parseInt(bet);
  if (!await validateBet(interaction, guildId, userId, bet)) return;
  startGame(guildId, userId, "Crash");
  await removeBalance(guildId, userId, bet);

  // Casino-grade crash distribution (8% house edge):
  // Formula: crashPoint = 0.92 / rand, but heavily weighted toward low values
  // ~10% instant crash at 1.00x
  // ~55% crash below 1.3x  (players almost made it — keeps them hooked)
  // ~70% crash below 1.5x
  // ~82% crash below 2x
  // ~92% crash below 5x
  // ~97% crash below 10x
  // 3% chance of going higher — the carrot that keeps players coming back
  function generateCrashPoint() {
    const r = Math.random();
    // 10% instant bust — devastating and common
    if (r < 0.10) return 1.00;
    // Remaining 90%: exponential weighted heavily toward low values
    // We use a power curve: most mass near 1.0-1.5x
    const normalized = (r - 0.10) / 0.90; // rescale to 0-1
    const raw = 0.92 / Math.pow(normalized, 1.8);
    return Math.min(parseFloat(raw.toFixed(2)), 25.00);
  }

  const crashPoint = generateCrashPoint();
  const game = { crashPoint, bet, guildId, userId, cashed: false };
  crashGames.set(`${guildId}-${userId}`, game);

  // Instant crash — show result immediately without animation
  if (crashPoint <= 1.00) {
    crashGames.delete(`${guildId}-${userId}`);
    await recordGame(guildId, userId, "crash", bet, -bet);
    endGame(guildId, userId);
    const instantEmbed = baseEmbed("📈 Crash — 💥 INSTANT CRASH!", COLORS.red)
      .setDescription(`The game crashed at **1.00×** before it even started! 💀`)
      .addFields(
        { name: "Lost",    value: `-${bet.toLocaleString()} ${R}`, inline: true },
        { name: "Balance", value: `${(await getBalance(guildId, userId)).toLocaleString()} ${R}`, inline: true }
      );
    return interaction.reply({ embeds: [instantEmbed] });
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("crash_cashout").setLabel("💸 Cash Out").setStyle(ButtonStyle.Success)
  );

  const embed = baseEmbed("📈 Crash", COLORS.gold)
    .setDescription(`The multiplier is rising! Cash out before it crashes!\n\n🚀 **Multiplier: 1.00×**`)
    .addFields({ name: "Bet", value: `${bet.toLocaleString()} ${R}`, inline: true });

  let msg;
  if (typeof interaction.fetchReply === "function") {
    await interaction.reply({ embeds: [embed], components: [row] });
    msg = await interaction.fetchReply();
  } else {
    msg = await interaction.reply({ embeds: [embed], components: [row] });
  }

  let current = 1.0;
  const interval = setInterval(async () => {
    if (game.cashed) return clearInterval(interval);
    // Small steady increments — gives players time to react
    const growth = parseFloat((0.04 + Math.random() * 0.05).toFixed(2));
    current = parseFloat((current + growth).toFixed(2));

    if (current >= crashPoint) {
      clearInterval(interval);
      crashGames.delete(`${guildId}-${userId}`);
      await recordGame(guildId, userId, "crash", bet, -bet);
      const { bonusMsg: lossMsg } = applyActiveBonusOnLoss(guildId, userId, bet);
      endGame(guildId, userId);
      const embed = baseEmbed("📈 Crash — 💥 CRASHED!", COLORS.red)
        .setDescription(`Crashed at **${crashPoint}×**! You lost your bet.${lossMsg}`)
        .addFields(
          { name: "Lost",    value: `-${bet.toLocaleString()} ${R}`, inline: true },
          { name: "Balance", value: `${(await getBalance(guildId, userId)).toLocaleString()} ${R}`, inline: true }
        );
      return msg.edit({ embeds: [embed], components: [] }).catch(() => {});
    }

    const updEmbed = baseEmbed("📈 Crash", COLORS.gold)
      .setDescription(`🚀 **Multiplier: ${current}×**\n\nCash out before it crashes!`)
      .addFields(
        { name: "Bet",         value: `${bet.toLocaleString()} ${R}`,                  inline: true },
        { name: "Current Win", value: `${Math.floor(bet * current).toLocaleString()} ${R}`, inline: true }
      );
    await msg.edit({ embeds: [updEmbed], components: [row] }).catch(() => {});
  }, 1200);

  const collector = msg.createMessageComponentCollector({ time: 60000 });
  collector.on("collect", async (btn) => {
    if (btn.user.id !== userId) return btn.reply({ content: "Not your game!", flags: MessageFlags.Ephemeral });
    if (game.cashed) return;

    // Defer immediately — must happen within 3 seconds of click
    await btn.deferUpdate().catch(() => {});

    game.cashed = true;
    clearInterval(interval);
    crashGames.delete(`${guildId}-${userId}`);

    const gross  = Math.floor(bet * current);
    const net    = applyFee(gross);
    const { adjustedPayout: payout, bonusMsg } = applyActiveBonusToWin(guildId, userId, net);
    await addBalance(guildId, userId, payout);
    const rr = await recordGame(guildId, userId, "crash", bet, payout - bet);
    await checkWagerRole(btn, guildId, userId, rr);
    endGame(guildId, userId);

    const embed = baseEmbed("📈 Crash — Cashed Out!", COLORS.green)
      .setDescription(`You cashed out at **${current}×**!${bonusMsg}`)
      .addFields(
        { name: "Won",     value: `+${feeDisplay(gross, net)}${payout !== net ? ` → **${payout.toLocaleString()} ${R}** (bonus)` : ""}`, inline: true },
        { name: "Balance", value: `${(await getBalance(guildId, userId)).toLocaleString()} ${R}`, inline: true }
      );
    await msg.edit({ embeds: [embed], components: [] }).catch(() => {});
    collector.stop();
  });
}

// ─── MINES ────────────────────────────────────────────────────────────────────

const mineGames = new Map();
const MINES_TOTAL = 25;

async function cmdMines(interaction, userId, guildId, bet, mineCount) {
  if (await checkActiveGame(interaction, guildId, userId)) return;
  bet = parseInt(bet);
  mineCount = parseInt(mineCount);
  if (!await validateBet(interaction, guildId, userId, bet)) return;
  if (!mineCount || isNaN(mineCount) || mineCount < 1 || mineCount > 20) {
    return interaction.reply({ embeds: [baseEmbed("❌ Invalid Mines", COLORS.red).setDescription(`Choose between **1 and 20** mines.`)], flags: MessageFlags.Ephemeral });
  }
  startGame(guildId, userId, "Mines");
  await removeBalance(guildId, userId, bet);

  const mines = new Set();
  while (mines.size < mineCount) mines.add(randInt(0, MINES_TOTAL - 1));

  mineGames.set(`${guildId}-${userId}`, { mines, revealed: new Set(), bet, mineCount, guildId, userId, cashoutMsg: null });
  await sendMinesBoard(interaction, userId, guildId, true);
}

function getMinesMultiplier(revealedCount, mineCount) {
  const safe = MINES_TOTAL - mineCount;
  if (revealedCount === 0) return 1;
  let mult = 1;
  for (let i = 0; i < revealedCount; i++) mult *= (safe - i) / (MINES_TOTAL - i);
  return parseFloat((1 / mult * 0.97).toFixed(2));
}

function buildMinesRows(game, gameOver = false) {
  const rows = [];
  for (let r = 0; r < 5; r++) {
    const row = new ActionRowBuilder();
    for (let c = 0; c < 5; c++) {
      const idx = r * 5 + c;
      const isMine = game.mines.has(idx);
      const isRevealed = game.revealed.has(idx);
      let style, label, disabled;
      if (gameOver) {
        if (isMine && isRevealed) { style = ButtonStyle.Danger;    label = "💥"; }
        else if (isMine)          { style = ButtonStyle.Danger;    label = "💣"; }
        else if (isRevealed)      { style = ButtonStyle.Success;   label = "💎"; }
        else                      { style = ButtonStyle.Secondary; label = "▪️"; }
        disabled = true;
      } else {
        style = isRevealed ? ButtonStyle.Success : ButtonStyle.Secondary;
        label = isRevealed ? "💎" : "▪️";
        disabled = isRevealed;
      }
      row.addComponents(new ButtonBuilder().setCustomId(`mines_${idx}`).setStyle(style).setLabel(label).setDisabled(disabled));
    }
    rows.push(row);
  }
  return rows;
}

async function sendMinesBoard(interaction, userId, guildId, isNew = false) {
  const key = `${guildId}-${userId}`;
  const game = mineGames.get(key);
  const mult = getMinesMultiplier(game.revealed.size, game.mineCount);
  const potential = Math.floor(game.bet * mult);
  const rows = buildMinesRows(game, false);

  const embed = baseEmbed("💣 Mines", COLORS.purple)
    .setDescription(`Uncover gems, avoid mines!\n\n💣 Mines hidden: **${game.mineCount}**\n💎 Gems found: **${game.revealed.size} / ${MINES_TOTAL - game.mineCount}**`)
    .addFields(
      { name: "Bet",        value: `${game.bet.toLocaleString()} ${R}`,  inline: true },
      { name: "Multiplier", value: `\`${mult}×\``,                       inline: true },
      { name: "Cash Out",   value: `${potential.toLocaleString()} ${R}`, inline: true }
    );

  const cashoutPayload = (disabled) => ({
    embeds: [baseEmbed("💣 Mines — Cash Out", COLORS.purple)
      .setDescription(disabled ? "Find a gem first to enable cash out." : `Cash out **${Math.floor(game.bet * getMinesMultiplier(game.revealed.size, game.mineCount)).toLocaleString()} ${R}** now!`)],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("mines_cashout")
        .setLabel(disabled ? "💸 Cash Out" : `💸 Cash Out`)
        .setStyle(ButtonStyle.Success).setDisabled(disabled)
    )]
  });

  if (isNew) {
    await interaction.reply({ embeds: [embed], components: rows });
    let cashoutMsg;
    if (typeof interaction.followUp === "function") {
      cashoutMsg = await interaction.followUp(cashoutPayload(true));
    } else {
      cashoutMsg = await interaction.channel?.send(cashoutPayload(true)).catch(() => null);
    }
    game.cashoutMsg = cashoutMsg;
  } else {
    await interaction.editReply({ embeds: [embed], components: rows });
    if (game.cashoutMsg) {
      await game.cashoutMsg.edit(cashoutPayload(game.revealed.size === 0)).catch(() => {});
    }
  }
}

async function endMinesGame(interaction, game, hitMine, clearedBoard) {
  const key = `${game.guildId}-${game.userId}`;
  mineGames.delete(key);

  const mult      = getMinesMultiplier(game.revealed.size, game.mineCount);
  const gross     = Math.floor(game.bet * mult);
  const net       = hitMine ? 0 : applyFee(gross);
  const { adjustedPayout: payout, bonusMsg } = (!hitMine && net > 0)
    ? applyActiveBonusToWin(game.guildId, game.userId, net)
    : { adjustedPayout: 0, bonusMsg: "" };
  const { bonusMsg: lossMsg } = hitMine ? applyActiveBonusOnLoss(game.guildId, game.userId, game.bet) : { bonusMsg: "" };

  if (payout > 0) await addBalance(game.guildId, game.userId, payout);
  const rr = await recordGame(game.guildId, game.userId, "mines", game.bet, payout > 0 ? payout - game.bet : -game.bet);
  await checkWagerRole(interaction, game.guildId, game.userId, rr);
  endGame(game.guildId, game.userId);

  const color = hitMine ? COLORS.red : clearedBoard ? COLORS.gold : COLORS.green;
  const title = hitMine ? "💣 Mines — BOOM! 💥" : clearedBoard ? "💣 Mines — Board Cleared! 🏆" : "💣 Mines — Cashed Out!";
  const desc  = hitMine
    ? `You hit a mine after finding **${game.revealed.size}** gem(s)!${lossMsg}`
    : clearedBoard
      ? `You found every single gem!${bonusMsg}`
      : `You cashed out with **${game.revealed.size}** gem(s)!${bonusMsg}`;

  const winStr = hitMine
    ? `-${game.bet.toLocaleString()} ${R}`
    : `+${feeDisplay(gross, net)}${payout !== net ? ` → **${payout.toLocaleString()} ${R}** (bonus)` : ""}`;

  const resultEmbed = baseEmbed(title, color).setDescription(desc).addFields(
    { name: "Multiplier", value: `\`${mult}×\``,                                              inline: true },
    { name: hitMine ? "Lost" : "Won", value: winStr,                                           inline: true },
    { name: "Balance",    value: `${(await getBalance(game.guildId, game.userId)).toLocaleString()} ${R}`, inline: true }
  );

  const revealedRows = buildMinesRows(game, true);
  await interaction.editReply({ embeds: [resultEmbed], components: revealedRows });

  if (game.cashoutMsg) {
    await game.cashoutMsg.edit({
      embeds: [resultEmbed],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("mines_cashout").setLabel("Game Over").setStyle(ButtonStyle.Secondary).setDisabled(true)
      )]
    }).catch(() => {});
  }
}

async function handleMines(interaction) {
  await interaction.deferUpdate();
  const { customId, user, guildId } = interaction;
  const key = `${guildId}-${user.id}`;
  const game = mineGames.get(key);

  if (!game) return interaction.followUp({ content: "No active mines game!", flags: MessageFlags.Ephemeral });
  if (game.userId !== user.id) return interaction.followUp({ content: "Not your game!", flags: MessageFlags.Ephemeral });

  if (customId === "mines_cashout") {
    if (game.revealed.size === 0) return interaction.followUp({ content: "Find at least one gem first!", flags: MessageFlags.Ephemeral });
    return endMinesGame(interaction, game, false, false);
  }

  const idx = parseInt(customId.replace("mines_", ""));
  if (game.mines.has(idx)) {
    game.revealed.add(idx);
    return endMinesGame(interaction, game, true, false);
  }

  game.revealed.add(idx);
  if (game.revealed.size === MINES_TOTAL - game.mineCount) return endMinesGame(interaction, game, false, true);

  await sendMinesBoard(interaction, user.id, guildId, false);
}

// ─── TOWERS ───────────────────────────────────────────────────────────────────
// Easy:   1 bomb out of 3 tiles. Mult: ×1.3 per floor
// Medium: 1-2 bombs out of 3 (avg ~1.5). Mult: ×1.6 per floor
// Hard:   2 bombs out of 3 tiles. Mult: ×2.0 per floor

const towerGames = new Map();
const TOWER_FLOORS = 8;

const TOWER_DIFFICULTIES = {
  easy:   { bombs: 1, tiles: 3, multPerFloor: 1.3, label: "🟢 Easy"   }, // 3 tiles, 1 bomb
  medium: { bombs: 1, tiles: 2, multPerFloor: 1.8, label: "🟡 Medium" }, // 2 tiles, 1 bomb (50/50)
  hard:   { bombs: 2, tiles: 3, multPerFloor: 2.2, label: "🔴 Hard"   }, // 3 tiles, 2 bombs
};

function getTowerMult(floor, difficulty) {
  const cfg = TOWER_DIFFICULTIES[difficulty];
  return parseFloat(Math.pow(cfg.multPerFloor, floor).toFixed(2));
}

function buildTowerGrid(game, gameOver = false, hitFloor = -1) {
  const cfg   = TOWER_DIFFICULTIES[game.difficulty];
  const tileCount = cfg.tiles;
  const lines = [];

  for (let f = TOWER_FLOORS - 1; f >= 0; f--) {
    const bombs    = game.bombsPerFloor[f];
    const isActive   = f === game.currentFloor && !gameOver;
    const isPast     = f < game.currentFloor;
    const isHit      = gameOver && f === hitFloor;
    const isAboveHit = gameOver && hitFloor >= 0 && f > hitFloor;

    let tiles = Array(tileCount).fill("❓");

    if (isPast) {
      const picked = game.history[f];
      for (const b of bombs) tiles[b] = "💣";
      tiles[picked] = "✅";
    } else if (isHit) {
      for (const b of bombs) tiles[b] = "💥";
    } else if (isAboveHit) {
      for (const b of bombs) tiles[b] = "💣";
    }

    lines.push(`${tiles.join(" ")}  Floor ${f + 1}${isActive ? " ◄" : ""}`);
  }
  return lines.join("\n");
}

async function cmdTowers(interaction, userId, guildId, bet, difficulty) {
  if (await checkActiveGame(interaction, guildId, userId)) return;
  bet = parseInt(bet);
  if (!await validateBet(interaction, guildId, userId, bet)) return;

  const diff = (difficulty || "easy").toLowerCase();
  if (!TOWER_DIFFICULTIES[diff]) {
    return interaction.reply({ embeds: [baseEmbed("❌ Invalid Difficulty", COLORS.red).setDescription("Choose: `easy` `medium` or `hard`")], flags: MessageFlags.Ephemeral });
  }
  startGame(guildId, userId, "Towers");
  await removeBalance(guildId, userId, bet);

  const cfg = TOWER_DIFFICULTIES[diff];
  const bombsPerFloor = [];
  for (let i = 0; i < TOWER_FLOORS; i++) {
    const positions = Array.from({ length: cfg.tiles }, (_, idx) => idx)
      .sort(() => Math.random() - 0.5);
    bombsPerFloor.push(positions.slice(0, cfg.bombs));
  }

  towerGames.set(`${guildId}-${userId}`, {
    bombsPerFloor, bet, guildId, userId,
    currentFloor: 0, history: [], difficulty: diff
  });
  await sendTowerEmbed(interaction, userId, guildId, true);
}

function getTowerComponents(floor, difficulty) {
  const cfg = TOWER_DIFFICULTIES[difficulty] || TOWER_DIFFICULTIES.easy;
  const pickRow = new ActionRowBuilder();

  if (cfg.tiles === 2) {
    pickRow.addComponents(
      new ButtonBuilder().setCustomId("tower_pick_0").setLabel("⬅️ Left").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("tower_pick_1").setLabel("➡️ Right").setStyle(ButtonStyle.Primary)
    );
  } else {
    pickRow.addComponents(
      new ButtonBuilder().setCustomId("tower_pick_0").setLabel("⬅️ Left").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("tower_pick_1").setLabel("⬆️ Middle").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("tower_pick_2").setLabel("➡️ Right").setStyle(ButtonStyle.Primary)
    );
  }

  return [
    pickRow,
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("tower_cashout").setLabel("💸 Cash Out").setStyle(ButtonStyle.Success).setDisabled(floor === 0)
    )
  ];
}

async function sendTowerEmbed(interaction, userId, guildId, isNew, gameOver = false, hitFloor = -1) {
  const key = `${guildId}-${userId}`;
  const game = towerGames.get(key);
  const mult = getTowerMult(game.currentFloor, game.difficulty);
  const cfg = TOWER_DIFFICULTIES[game.difficulty];

  const desc = cfg.tiles === 2
    ? `Pick **Left** or **Right** — one is a 💣! (50/50)\n\n${buildTowerGrid(game, gameOver, hitFloor)}`
    : `Pick **Left**, **Middle**, or **Right** — ${cfg.bombs === 2 ? "2 tiles hide" : "1 tile hides"} a 💣!\n\n${buildTowerGrid(game, gameOver, hitFloor)}`;

  const embed = baseEmbed(`🗼 Towers — ${cfg.label}`, COLORS.purple)
    .setDescription(desc)
    .addFields(
      { name: "Floor",      value: `\`${game.currentFloor + 1} / ${TOWER_FLOORS}\``,      inline: true },
      { name: "Multiplier", value: `\`${mult}×\``,                                         inline: true },
      { name: "Cash Out",   value: `${Math.floor(game.bet * mult).toLocaleString()} ${R}`, inline: true }
    );

  if (isNew) await interaction.reply({ embeds: [embed], components: getTowerComponents(game.currentFloor, game.difficulty) });
  else await interaction.editReply({ embeds: [embed], components: getTowerComponents(game.currentFloor, game.difficulty) });
}

async function handleTowers(interaction) {
  await interaction.deferUpdate();
  const { customId, user, guildId } = interaction;
  const key = `${guildId}-${user.id}`;
  const game = towerGames.get(key);

  if (!game) return interaction.followUp({ content: "No active towers game!", flags: MessageFlags.Ephemeral });
  if (game.userId !== user.id) return interaction.followUp({ content: "Not your game!", flags: MessageFlags.Ephemeral });

  if (customId === "tower_cashout") {
    towerGames.delete(key);
    const mult   = getTowerMult(game.currentFloor, game.difficulty);
    const gross  = Math.floor(game.bet * mult);
    const net    = applyFee(gross);
    const { adjustedPayout: payout, bonusMsg } = applyActiveBonusToWin(guildId, user.id, net);
    await addBalance(guildId, user.id, payout);
    const rr = await recordGame(guildId, user.id, "towers", game.bet, payout - game.bet);
    await checkWagerRole(interaction, guildId, user.id, rr);
    endGame(guildId, user.id);
    const cfg = TOWER_DIFFICULTIES[game.difficulty];
    const embed = baseEmbed(`🗼 Towers — Cashed Out! 💸`, COLORS.green)
      .setDescription(`You walked away after **${game.currentFloor}** floor(s)! (${cfg.label})${bonusMsg}\n\n${buildTowerGrid(game)}`)
      .addFields(
        { name: "Multiplier", value: `\`${mult}×\``, inline: true },
        { name: "Won",        value: `+${feeDisplay(gross, net)}${payout !== net ? ` → **${payout.toLocaleString()} ${R}** (bonus)` : ""}`, inline: true },
        { name: "Balance",    value: `${(await getBalance(guildId, user.id)).toLocaleString()} ${R}`, inline: true }
      );
    return interaction.editReply({ embeds: [embed], components: [] });
  }

  const col = parseInt(customId.replace("tower_pick_", ""));
  const floor = game.currentFloor;
  const bombs = game.bombsPerFloor[floor];
  game.history.push(col);

  if (bombs.includes(col)) {
    towerGames.delete(key);
    const rr2 = await recordGame(guildId, user.id, "towers", game.bet, -game.bet);
    await checkWagerRole(interaction, guildId, user.id, rr2);
    endGame(guildId, user.id);
    const { bonusMsg: lossMsg } = applyActiveBonusOnLoss(guildId, user.id, game.bet);
    const embed = baseEmbed("🗼 Towers — BOOM! 💥", COLORS.red)
      .setDescription(`You hit a bomb on **Floor ${floor + 1}**!${lossMsg}\n\n${buildTowerGrid(game, true, floor)}`)
      .addFields(
        { name: "Floors Climbed", value: `\`${floor}\``,                                          inline: true },
        { name: "Lost",           value: `-${game.bet.toLocaleString()} ${R}`,                    inline: true },
        { name: "Balance",        value: `${(await getBalance(guildId, user.id)).toLocaleString()} ${R}`, inline: true }
      );
    return interaction.editReply({ embeds: [embed], components: [] });
  }

  game.currentFloor++;

  if (game.currentFloor === TOWER_FLOORS) {
    towerGames.delete(key);
    const mult   = getTowerMult(game.currentFloor, game.difficulty);
    const gross  = Math.floor(game.bet * mult);
    const net    = applyFee(gross);
    const { adjustedPayout: payout, bonusMsg } = applyActiveBonusToWin(guildId, user.id, net);
    await addBalance(guildId, user.id, payout);
    const rr3 = await recordGame(guildId, user.id, "towers", game.bet, payout - game.bet);
    await checkWagerRole(interaction, guildId, user.id, rr3);
    endGame(guildId, user.id);
    const embed = baseEmbed("🗼 Towers — TOP REACHED! 🏆", COLORS.gold)
      .setDescription(`You conquered the entire tower!${bonusMsg}\n\n${buildTowerGrid(game)}`)
      .addFields(
        { name: "Multiplier", value: `\`${mult}×\``, inline: true },
        { name: "Won",        value: `+${feeDisplay(gross, net)}${payout !== net ? ` → **${payout.toLocaleString()} ${R}** (bonus)` : ""}`, inline: true },
        { name: "Balance",    value: `${(await getBalance(guildId, user.id)).toLocaleString()} ${R}`, inline: true }
      );
    return interaction.editReply({ embeds: [embed], components: [] });
  }

  await sendTowerEmbed(interaction, user.id, guildId, false);
}

// ─── KENO ─────────────────────────────────────────────────────────────────────
// 15 draws from 80 numbers — much harder to hit
// Payout table per pick count, indexed by hits

const KENO_PAYOUTS = {
  2:  [0, 0, 9],
  3:  [0, 0, 2, 16],
  4:  [0, 0, 1, 4, 50],
  5:  [0, 0, 0, 3, 12, 100],
  6:  [0, 0, 0, 2, 6,  35, 250],
  7:  [0, 0, 0, 1, 4,  15, 80,  500],
  8:  [0, 0, 0, 1, 2,  8,  30,  150, 1000],
  9:  [0, 0, 0, 0, 2,  5,  18,  75,  400, 2500],
  10: [0, 0, 0, 0, 1,  3,  10,  40,  200, 1000, 5000],
};

async function cmdKeno(interaction, userId, guildId, bet, picks) {
  if (await checkActiveGame(interaction, guildId, userId)) return;
  bet = parseInt(bet);
  if (!await validateBet(interaction, guildId, userId, bet)) return;
  if (!picks) {
    return interaction.reply({ embeds: [baseEmbed("❌ No Picks", COLORS.red).setDescription(`Provide 2–10 numbers (1–80).`)], flags: MessageFlags.Ephemeral });
  }
  startGame(guildId, userId, "Keno");

  const chosen = [...new Set(picks.split(",").map(n => parseInt(n.trim())).filter(n => !isNaN(n) && n >= 1 && n <= 80))];
  if (chosen.length < 2 || chosen.length > 10) {
    return interaction.reply({ embeds: [baseEmbed("❌ Invalid Picks", COLORS.red).setDescription("Pick between **2 and 10** unique numbers between 1–80.")], flags: MessageFlags.Ephemeral });
  }

  await removeBalance(guildId, userId, bet);

  // Draw 15 numbers from 1–80
  const drawn = new Set();
  while (drawn.size < 15) drawn.add(randInt(1, 80));

  const hits = chosen.filter(n => drawn.has(n)).length;
  const payoutTable = KENO_PAYOUTS[chosen.length];
  const mult = payoutTable[hits] ?? 0;
  const gross  = Math.floor(bet * mult);
  const net    = applyFee(gross);
  const { adjustedPayout: payout, bonusMsg } = (net > 0)
    ? applyActiveBonusToWin(guildId, userId, net)
    : { adjustedPayout: 0, bonusMsg: "" };
  const { bonusMsg: lossMsg } = net === 0 ? applyActiveBonusOnLoss(guildId, userId, bet) : { bonusMsg: "" };
  if (payout > 0) await addBalance(guildId, userId, payout);
  const rr = await recordGame(guildId, userId, "keno", bet, payout > 0 ? payout - bet : -bet);
  await checkWagerRole();

  const drawnArr = [...drawn].sort((a, b) => a - b);
  const drawnDisplay = drawnArr.map(n => chosen.includes(n) ? `**${n}**` : `${n}`).join(", ");

  // Show payout table
  const payoutPreview = payoutTable.map((m, i) => {
    if (i === 0 || m === 0) return null;
    return `${i}hit→×${m}`;
  }).filter(Boolean).join("  ");

  const embed = baseEmbed("🎱 Keno", payout > 0 ? COLORS.green : COLORS.red)
    .setDescription(
      `**Your picks (${chosen.length}):** ${chosen.join(", ")}\n` +
      `**Drawn (15/80):** ${drawnDisplay}\n\n` +
      `🎯 **Hits: ${hits} / ${chosen.length}**${payout > 0 ? bonusMsg : lossMsg}`
    )
    .addFields(
      { name: "Multiplier",   value: `\`${mult}×\``, inline: true },
      { name: payout > 0 ? "Won" : "Lost",
        value: payout > 0
          ? `+${feeDisplay(gross, net)}${payout !== net ? ` → **${payout.toLocaleString()} ${R}** (bonus)` : ""}`
          : `-${bet.toLocaleString()} ${R}`,
        inline: true },
      { name: "Balance",      value: `${(await getBalance(guildId, userId)).toLocaleString()} ${R}`, inline: true },
      { name: `Payouts (${chosen.length} picks)`, value: `\`${payoutPreview}\``, inline: false }
    );

  await interaction.reply({ embeds: [embed] });
  endGame(guildId, userId);
}

// ─── LIMBO ────────────────────────────────────────────────────────────────────
// Player sets a target multiplier (1.01–100x).
// House edge: 5%. Win probability = 95 / target (%)
// At 2x → 47.5% win. At 10x → 9.5%. At 100x → 0.95%.
// Animation counts up, stops the moment it crosses the target.

function generateLimboResult() {
  const r = Math.random();
  if (r < 0.03) return 1.00; // 3% instant bust
  const raw = 0.92 / r;      // 8% house edge — harder to win
  return Math.min(parseFloat(raw.toFixed(2)), 50.00);
}

async function cmdLimbo(interaction, userId, guildId, bet, target) {
  if (await checkActiveGame(interaction, guildId, userId)) return;
  bet = parseInt(bet);
  target = parseFloat(parseFloat(target).toFixed(2));
  if (!await validateBet(interaction, guildId, userId, bet)) return;
  if (!target || isNaN(target) || target < 1.01 || target > 100) {
    return interaction.reply({ embeds: [baseEmbed("❌ Invalid Target", COLORS.red).setDescription("Target multiplier must be between **1.01× and 100×**.")], flags: MessageFlags.Ephemeral });
  }
  startGame(guildId, userId, "Limbo");
  await removeBalance(guildId, userId, bet);

  const result = generateLimboResult();
  const finalResult = parseFloat(result.toFixed(2));
  const won     = finalResult >= target;
  const gross   = won ? Math.floor(bet * target) : 0;
  const net     = won ? applyFee(gross) : 0;
  const { adjustedPayout: payout, bonusMsg } = won
    ? applyActiveBonusToWin(guildId, userId, net)
    : { adjustedPayout: 0, bonusMsg: "" };
  const { bonusMsg: lossMsg } = !won ? applyActiveBonusOnLoss(guildId, userId, bet) : { bonusMsg: "" };
  if (payout > 0) await addBalance(guildId, userId, payout);
  const rr = await recordGame(guildId, userId, "limbo", bet, won ? payout - bet : -bet);
  await checkWagerRole();

  // Build animation frames:
  // - If lost: animate up to finalResult (never reaches target), red at end
  // - If won: animate past the target then stop — green the moment it crosses
  // We only show ~6 keyframes to avoid spamming edits
  const animTarget = won ? target : finalResult;
  const FRAMES = 6;
  const frames = [];

  for (let i = 0; i < FRAMES; i++) {
    const t = i / (FRAMES - 1);
    // Ease-in so it starts slow and accelerates (more dramatic)
    const eased = Math.pow(t, 1.5);
    const val = parseFloat((1.00 + (animTarget - 1.00) * eased).toFixed(2));
    frames.push(val);
  }

  const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴"];

  const rollingEmbed = (val, spinIdx) => new EmbedBuilder()
    .setColor(0xF4C542)
    .setTitle("🎰 Limbo")
    .setDescription(
      `🎯 Target: **${target}×**\n\n` +
      `${spinnerFrames[spinIdx % spinnerFrames.length]} **${val.toFixed(2)}×**\n\n` +
      `*Rolling...*`
    )
    .addFields(
      { name: "Bet",    value: `${bet.toLocaleString()} ${R}`, inline: true },
      { name: "Status", value: "🟡 In Progress",               inline: true }
    )
    .setTimestamp()
    .setFooter({ text: "🎰 Casino Bot" });

  const resultEmbed = (val, didWin) => new EmbedBuilder()
    .setColor(didWin ? 0x2ECC71 : 0xE74C3C)
    .setTitle(didWin ? "🎰 Limbo — You Won! 🎉" : "🎰 Limbo — You Lost!")
    .setDescription(
      `🎯 Target: **${target}×**\n\n` +
      `${didWin ? "✅" : "❌"} **${val.toFixed(2)}×** — ${didWin ? "Hit!" : "Missed!"}` +
      (didWin ? bonusMsg : lossMsg)
    )
    .addFields(
      { name: "Bet",     value: `${bet.toLocaleString()} ${R}`, inline: true },
      { name: didWin ? "Won" : "Lost",
        value: didWin
          ? `+${feeDisplay(gross, net)}${payout !== net ? ` → **${payout.toLocaleString()} ${R}** (bonus)` : ""}`
          : `-${bet.toLocaleString()} ${R}`,
        inline: true },
      { name: "Balance", value: `${(await getBalance(guildId, userId)).toLocaleString()} ${R}`, inline: true }
    )
    .setTimestamp()
    .setFooter({ text: "🎰 Casino Bot" });

  // Send initial embed
  let msg;
  if (typeof interaction.fetchReply === "function") {
    await interaction.reply({ embeds: [rollingEmbed(1.00, 0)] });
    msg = await interaction.fetchReply();
  } else {
    msg = await interaction.reply({ embeds: [rollingEmbed(1.00, 0)] });
  }

  // Animate frames, then show result
  let frameIdx = 0;
  let spinIdx = 0;
  const interval = setInterval(async () => {
    frameIdx++;
    spinIdx++;
    if (frameIdx >= frames.length) {
      clearInterval(interval);
      await msg.edit({ embeds: [resultEmbed(finalResult, won)] }).catch(() => {});
      endGame(guildId, userId);
      return;
    }
    await msg.edit({ embeds: [rollingEmbed(frames[frameIdx], spinIdx)] }).catch(() => {});
  }, 400);
}

export {
  cmdSlots, cmdCoinflip, cmdRoulette, cmdBlackjack,
  cmdCrash, cmdMines, cmdTowers, cmdKeno, cmdLimbo,
  handleBlackjack, handleMines, handleTowers,
  cmdUnfreeze,
};