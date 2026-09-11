import { config } from './config.js';
import { getEconomyUser, claimDailyEls, changeEls } from './db.js';

export const DAILY_MIN = 10;
export const DAILY_MAX = 50;
export const DEFAULT_BET = 10;
export const MAX_BET = 200;

export function parseBet(content) {
  const match = String(content || '').match(/(?:bet|wager|stake)\s*(?:of\s*)?(\d+)\s*(?:els?|coins?)?|(?:\b(\d+)\s*(?:els?|el)\b)/i);
  const value = Number(match?.[1] || match?.[2]);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_BET;
  return Math.min(MAX_BET, Math.floor(value));
}

export function hasExplicitBet(content) {
  return /(?:\b(?:bet|wager|stake)\s*(?:of\s*)?\d+\b|\b\d+\s*(?:els?|el)\b)/i.test(String(content || ''));
}

export async function getBalance(guildId, userId) {
  const row = await getEconomyUser(guildId, userId);
  return Number(row?.balance || 0);
}

export async function tryPlaceBet(guildId, userId, requestedBet) {
  const bet = Math.min(MAX_BET, Math.max(1, Math.floor(Number(requestedBet) || DEFAULT_BET)));
  const balance = await getBalance(guildId, userId);
  if (balance < bet) return { wager: 0, balance, requestedBet: bet };
  await changeEls(guildId, userId, -bet);
  return { wager: bet, balance: balance - bet, requestedBet: bet };
}

export async function settleBet(guildId, userId, amount) {
  if (!amount) return getBalance(guildId, userId);
  return changeEls(guildId, userId, amount);
}

export async function claimDaily(guildId, userId) {
  const amount = Math.floor(Math.random() * (DAILY_MAX - DAILY_MIN + 1)) + DAILY_MIN;
  return claimDailyEls(guildId, userId, amount);
}

export function isDailyRequest(content) {
  return /\b(?:give|claim|collect|get|earn)\b[\s\S]{0,60}\b(?:daily|els?|money|coins?|allowance)\b/i.test(content)
    || /\b(?:daily|allowance)\b[\s\S]{0,40}\b(?:els?|money|coins?)\b/i.test(content);
}

export function isBalanceRequest(content) {
  return /\b(?:how much|what(?:'s| is))\b[\s\S]{0,40}\b(?:els?|money|balance|coins?)\b/i.test(content)
    || /\b(?:my|check|show)\b[\s\S]{0,30}\b(?:els?|balance|money|coins?)\b/i.test(content);
}

export async function handleEconomyRequest(message, content) {
  if (isDailyRequest(content)) {
    const result = await claimDaily(config.guildId, message.author.id);
    if (!result.claimed) {
      const hours = Math.floor(result.remainingMs / 3600000);
      const minutes = Math.ceil((result.remainingMs % 3600000) / 60000);
      await message.reply(`💰 You already claimed your daily els. Come back in **${hours}h ${minutes}m**.`);
      return true;
    }
    await message.reply(`💰 You got **${result.amount} el${result.amount === 1 ? '' : 's'}**! Your balance is now **${result.balance} els**.`);
    return true;
  }

  if (isBalanceRequest(content)) {
    const balance = await getBalance(config.guildId, message.author.id);
    await message.reply(`💰 You have **${balance} els**.`);
    return true;
  }

  return false;
}
