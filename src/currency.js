const API_BASE = 'https://api.frankfurter.dev/v2';

const CURRENCY_ALIASES = {
  USD: ['usd', 'us dollar', 'us dollars', 'u.s. dollar', 'u.s. dollars', 'american dollar', 'american dollars', 'dollar', 'dollars', 'bucks', 'buck'],
  EUR: ['eur', 'euro', 'euros'],
  GBP: ['gbp', 'pound', 'pounds', 'pound sterling', 'pounds sterling', 'quid'],
  INR: ['inr', 'rupee', 'rupees', 'indian rupee', 'indian rupees'],
  JPY: ['jpy', 'yen', 'japanese yen'],
  CNY: ['cny', 'yuan', 'renminbi', 'rmb', 'chinese yuan'],
  KRW: ['krw', 'won', 'korean won', 'south korean won'],
  CAD: ['cad', 'canadian dollar', 'canadian dollars'],
  AUD: ['aud', 'australian dollar', 'australian dollars'],
  NZD: ['nzd', 'new zealand dollar', 'new zealand dollars'],
  SGD: ['sgd', 'singapore dollar', 'singapore dollars'],
  HKD: ['hkd', 'hong kong dollar', 'hong kong dollars'],
  AED: ['aed', 'dirham', 'dirhams', 'uae dirham', 'emirati dirham'],
  SAR: ['sar', 'saudi riyal', 'saudi riyals', 'riyal', 'riyals'],
  QAR: ['qar', 'qatari riyal', 'qatari riyals'],
  BDT: ['bdt', 'taka', 'bangladeshi taka'],
  PKR: ['pkr', 'pakistani rupee', 'pakistani rupees'],
  NPR: ['npr', 'nepalese rupee', 'nepalese rupees'],
  LKR: ['lkr', 'sri lankan rupee', 'sri lankan rupees'],
  CHF: ['chf', 'swiss franc', 'swiss francs'],
  SEK: ['sek', 'swedish krona', 'swedish kronor'],
  NOK: ['nok', 'norwegian krone', 'norwegian kroner'],
  DKK: ['dkk', 'danish krone', 'danish kroner'],
  PLN: ['pln', 'polish zloty', 'polish zlotys', 'zloty', 'zlotys'],
  TRY: ['try', 'turkish lira', 'turkish liras', 'lira', 'liras'],
  THB: ['thb', 'thai baht', 'baht'],
  MYR: ['myr', 'malaysian ringgit', 'ringgit'],
  IDR: ['idr', 'indonesian rupiah', 'rupiah'],
  PHP: ['php', 'philippine peso', 'philippine pesos', 'peso', 'pesos'],
  ZAR: ['zar', 'south african rand', 'rand'],
  BRL: ['brl', 'brazilian real', 'brazilian reals', 'real', 'reais'],
  MXN: ['mxn', 'mexican peso', 'mexican pesos'],
  RUB: ['rub', 'ruble', 'rubles', 'russian ruble', 'russian rubles'],
  VND: ['vnd', 'vietnamese dong', 'dong']
};

const SYMBOL_ALIASES = {
  '$': 'USD',
  '€': 'EUR',
  '£': 'GBP',
  '₹': 'INR',
  '¥': 'JPY'
};

const aliasEntries = Object.entries(CURRENCY_ALIASES)
  .flatMap(([code, aliases]) => aliases.map((alias) => [alias, code]))
  .sort((a, b) => b[0].length - a[0].length);

const aliasPattern = aliasEntries
  .map(([alias]) => alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|');

const currencyPattern = new RegExp(`(?:${aliasPattern}|\\$|€|£|₹|¥)`, 'gi');

function normalizeCurrencyAlias(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (SYMBOL_ALIASES[normalized]) return SYMBOL_ALIASES[normalized];

  const match = aliasEntries.find(([alias]) => alias === normalized);
  return match?.[1] || null;
}

function findCurrencies(text) {
  return [...String(text || '').matchAll(currencyPattern)].map((match) => ({
    code: normalizeCurrencyAlias(match[0]),
    index: match.index ?? 0,
    length: match[0].length
  }));
}

function parseAmount(text, firstCurrency, secondCurrency) {
  const numberPattern = /(?<![\w.])(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?![\w.])/g;
  const numbers = [...String(text || '').matchAll(numberPattern)].map((match) => ({
    value: Number(match[0].replace(/,/g, '')),
    index: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length
  })).filter((item) => Number.isFinite(item.value) && item.value >= 0);

  const between = numbers.find((number) => number.index >= firstCurrency.index && number.end <= secondCurrency.index);
  if (between) return between.value;

  const beforeFirst = numbers.filter((number) => number.end <= firstCurrency.index).at(-1);
  if (beforeFirst) return beforeFirst.value;

  const afterSecond = numbers.find((number) => number.index >= secondCurrency.index + secondCurrency.length);
  return afterSecond?.value ?? null;
}

function looksLikeCurrencyRequest(text, firstCurrency, secondCurrency) {
  const connector = String(text || '').match(/\b(?:to|into|in)\b/i);
  const intent = /\b(?:convert|conversion|exchange|rate|rates|worth|how much|currency|forex|fx)\b/i.test(text);

  if (intent) return true;
  return Boolean(connector && connector.index > firstCurrency.index && connector.index < secondCurrency.index);
}

export function parseCurrencyRequest(content) {
  const text = String(content || '').trim();
  if (!text) return null;

  const currencies = findCurrencies(text);
  if (currencies.length < 2) return null;

  const first = currencies[0];
  const second = currencies[1];
  if (!first.code || !second.code) return null;
  if (first.code === second.code) {
    if (!looksLikeCurrencyRequest(text, first, second)) return null;
    return { amount: parseAmount(text, first, second) ?? 1, from: first.code, to: second.code };
  }

  if (!looksLikeCurrencyRequest(text, first, second)) return null;

  return {
    amount: parseAmount(text, first, second) ?? 1,
    from: first.code,
    to: second.code
  };
}

async function fetchRate(from, to) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(`${API_BASE}/rate/${from.toLowerCase()}/${to.toLowerCase()}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' }
    });

    const data = await response.json().catch(() => null);
    if (!response.ok || !data || typeof data.rate !== 'number') {
      throw new Error(`Currency API returned ${response.status}.`);
    }

    return {
      rate: data.rate,
      date: data.date,
      base: data.base,
      quote: data.quote
    };
  } finally {
    clearTimeout(timeout);
  }
}

function formatNumber(value, maximumFractionDigits = 2) {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits }).format(value);
}

export async function getCurrencyConversion(content) {
  const request = parseCurrencyRequest(content);
  if (!request) return null;

  if (request.from === request.to) {
    return {
      ...request,
      rate: 1,
      converted: request.amount,
      date: new Date().toISOString().slice(0, 10)
    };
  }

  const data = await fetchRate(request.from, request.to);
  return {
    ...request,
    rate: data.rate,
    converted: request.amount * data.rate,
    date: data.date
  };
}

export function formatCurrencyReply(result) {
  const amountText = formatNumber(result.amount, 2);
  const convertedText = formatNumber(result.converted, 2);
  const rateText = formatNumber(result.rate, 6);

  return `💱 **${amountText} ${result.from} = ${convertedText} ${result.to}**\n1 ${result.from} = ${rateText} ${result.to}\n\n*Latest available rate: ${result.date} · Source: Frankfurter*`;
}
