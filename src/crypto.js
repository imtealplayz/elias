const COINGECKO_API = 'https://api.coingecko.com/api/v3/simple/price';
const FRANKFURTER_API = 'https://api.frankfurter.dev/v2';

const CRYPTO_ALIASES = {
  BTC: ['btc', 'bitcoin'],
  ETH: ['eth', 'ethereum'],
  SOL: ['sol', 'solana'],
  BNB: ['bnb', 'binance coin', 'bnb coin'],
  XRP: ['xrp', 'ripple'],
  ADA: ['ada', 'cardano'],
  DOGE: ['doge', 'dogecoin'],
  TRX: ['trx', 'tron'],
  TON: ['ton', 'toncoin'],
  AVAX: ['avax', 'avalanche'],
  DOT: ['dot', 'polkadot'],
  LINK: ['link', 'chainlink'],
  LTC: ['ltc', 'litecoin'],
  SHIB: ['shib', 'shiba', 'shiba inu'],
  USDT: ['usdt', 'tether'],
  USDC: ['usdc', 'usd coin']
};

const COINGECKO_IDS = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
  BNB: 'binancecoin',
  XRP: 'ripple',
  ADA: 'cardano',
  DOGE: 'dogecoin',
  TRX: 'tron',
  TON: 'the-open-network',
  AVAX: 'avalanche-2',
  DOT: 'polkadot',
  LINK: 'chainlink',
  LTC: 'litecoin',
  SHIB: 'shiba-inu',
  USDT: 'tether',
  USDC: 'usd-coin'
};

const aliasEntries = Object.entries(CRYPTO_ALIASES)
  .flatMap(([symbol, aliases]) => aliases.map((alias) => [alias, symbol]))
  .sort((a, b) => b[0].length - a[0].length);

const aliasPattern = aliasEntries
  .map(([alias]) => alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|');

const cryptoPattern = new RegExp(`(?<![A-Za-z0-9_])(?:${aliasPattern})(?![A-Za-z0-9_])`, 'gi');
const FIAT_CODES = new Set(['USD', 'EUR', 'GBP', 'INR', 'JPY', 'CNY', 'KRW', 'CAD', 'AUD', 'NZD', 'SGD', 'HKD', 'AED', 'SAR', 'QAR', 'BDT', 'PKR', 'NPR', 'LKR', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'TRY', 'THB', 'MYR', 'IDR', 'PHP', 'ZAR', 'BRL', 'MXN']);
const FIAT_ALIASES = {
  usd: 'USD', dollar: 'USD', dollars: 'USD', bucks: 'USD',
  eur: 'EUR', euro: 'EUR', euros: 'EUR',
  gbp: 'GBP', pound: 'GBP', pounds: 'GBP', quid: 'GBP',
  inr: 'INR', rupee: 'INR', rupees: 'INR',
  jpy: 'JPY', yen: 'JPY',
  cny: 'CNY', yuan: 'CNY', renminbi: 'CNY', rmb: 'CNY',
  krw: 'KRW', won: 'KRW',
  cad: 'CAD', aud: 'AUD', nzd: 'NZD', sgd: 'SGD', hkd: 'HKD',
  aed: 'AED', dirham: 'AED', dirhams: 'AED',
  sar: 'SAR', riyal: 'SAR', riyals: 'SAR',
  qar: 'QAR', taka: 'BDT', bdt: 'BDT', pkr: 'PKR',
  npr: 'NPR', lkr: 'LKR', chf: 'CHF', sek: 'SEK', nok: 'NOK',
  dkk: 'DKK', pln: 'PLN', try: 'TRY', lira: 'TRY', liras: 'TRY',
  thb: 'THB', baht: 'THB', myr: 'MYR', ringgit: 'MYR',
  idr: 'IDR', rupiah: 'IDR', php: 'PHP', peso: 'PHP', pesos: 'PHP',
  zar: 'ZAR', rand: 'ZAR', brl: 'BRL', real: 'BRL', reais: 'BRL',
  mxn: 'MXN'
};

function normalizeCrypto(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return aliasEntries.find(([alias]) => alias === normalized)?.[1] || null;
}

function normalizeFiat(value) {
  const normalized = String(value || '').trim().toLowerCase();
  const symbolMap = { '$': 'USD', '€': 'EUR', '£': 'GBP', '₹': 'INR', '¥': 'JPY' };
  return symbolMap[normalized] || FIAT_ALIASES[normalized] || (FIAT_CODES.has(normalized.toUpperCase()) ? normalized.toUpperCase() : null);
}

function findAssets(text) {
  const assets = [];
  for (const match of String(text || '').matchAll(cryptoPattern)) {
    assets.push({ type: 'crypto', symbol: normalizeCrypto(match[0]), index: match.index ?? 0, length: match[0].length });
  }

  const fiatPattern = /(?<![A-Za-z0-9_])(?:USD|EUR|GBP|INR|JPY|CNY|KRW|CAD|AUD|NZD|SGD|HKD|AED|SAR|QAR|BDT|PKR|NPR|LKR|CHF|SEK|NOK|DKK|PLN|TRY|THB|MYR|IDR|PHP|ZAR|BRL|MXN|dollars?|bucks?|euros?|pounds?|quid|rupees?|yen|yuan|renminbi|rmb|won|dirhams?|riyal|riyals|taka|liras?|baht|ringgit|rupiah|peso(?:s)?|rand|reais?)(?![A-Za-z0-9_])|[$€£₹¥]/gi;
  for (const match of String(text || '').matchAll(fiatPattern)) {
    const code = normalizeFiat(match[0]);
    if (code) assets.push({ type: 'fiat', symbol: code, index: match.index ?? 0, length: match[0].length });
  }

  return assets.sort((a, b) => a.index - b.index);
}

function parseAmount(text, firstAsset, secondAsset) {
  const numberPattern = /(?<![\w.])(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?![\w.])/g;
  const numbers = [...String(text || '').matchAll(numberPattern)]
    .map((match) => ({
      value: Number(match[0].replace(/,/g, '')),
      index: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length
    }))
    .filter((item) => Number.isFinite(item.value) && item.value >= 0);

  const between = numbers.find((number) => number.index >= firstAsset.index && number.end <= secondAsset.index);
  if (between) return between.value;

  const beforeFirst = numbers.filter((number) => number.end <= firstAsset.index).at(-1);
  if (beforeFirst) return beforeFirst.value;

  const afterSecond = numbers.find((number) => number.index >= secondAsset.index + secondAsset.length);
  return afterSecond?.value ?? null;
}

function isCryptoIntent(text) {
  return /\b(?:crypto|cryptocurrency|price|worth|convert|conversion|exchange|how much|value|rate|rates|market|trading)\b/i.test(text);
}

export function parseCryptoRequest(content) {
  const text = String(content || '').trim();
  if (!text || !isCryptoIntent(text)) return null;

  const assets = findAssets(text);
  const crypto = assets.find((asset) => asset.type === 'crypto');
  if (!crypto) return null;

  const second = assets.find((asset) => asset.index > crypto.index && asset.type !== 'crypto') || assets.find((asset) => asset !== crypto && asset.type === 'crypto');
  const amount = second ? (parseAmount(text, crypto, second) ?? parseAmount(text, crypto, crypto) ?? 1) : (parseAmount(text, crypto, crypto) ?? 1);

  if (!second) return { amount, from: crypto.symbol, to: 'USD', toType: 'fiat', cryptoSymbol: crypto.symbol };
  if (second.type === 'crypto') return { amount, from: crypto.symbol, to: second.symbol, toType: 'crypto', cryptoSymbol: crypto.symbol };
  return { amount, from: crypto.symbol, to: second.symbol, toType: 'fiat', cryptoSymbol: crypto.symbol };
}

async function getJson(url, signal) {
  const response = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(`API returned ${response.status}.`);
  return data;
}

async function fetchCryptoUsdPrices(symbols) {
  const ids = symbols.map((symbol) => COINGECKO_IDS[symbol]).filter(Boolean);
  if (!ids.length) throw new Error('No supported crypto assets were requested.');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const query = encodeURIComponent(ids.join(','));
    const data = await getJson(`${COINGECKO_API}?ids=${query}&vs_currencies=usd`, controller.signal);
    const prices = {};
    for (const symbol of symbols) {
      const id = COINGECKO_IDS[symbol];
      const price = Number(data?.[id]?.usd);
      if (!Number.isFinite(price)) throw new Error(`No current USD price was returned for ${symbol}.`);
      prices[symbol] = price;
    }
    return prices;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchUsdFiatRate(to) {
  if (to === 'USD') return { rate: 1, date: new Date().toISOString().slice(0, 10) };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const data = await getJson(`${FRANKFURTER_API}/rate/usd/${to.toLowerCase()}`, controller.signal);
    const rate = Number(data?.rate);
    if (!Number.isFinite(rate)) throw new Error(`No USD/${to} rate was returned.`);
    return { rate, date: data.date };
  } finally {
    clearTimeout(timeout);
  }
}

function formatNumber(value) {
  if (Math.abs(value) >= 1) return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(value);
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 8 }).format(value);
}

export async function getCryptoConversion(content) {
  const request = parseCryptoRequest(content);
  if (!request) return null;

  const priceSymbols = request.toType === 'crypto' ? [request.from, request.to] : [request.from];
  const prices = await fetchCryptoUsdPrices(priceSymbols);
  const fromUsd = prices[request.from];

  if (request.toType === 'crypto') {
    const converted = request.amount * fromUsd / prices[request.to];
    return { ...request, converted, rate: fromUsd / prices[request.to], rateLabel: `1 ${request.from} = ${formatNumber(fromUsd / prices[request.to])} ${request.to}`, source: 'CoinGecko', date: new Date().toISOString().slice(0, 10) };
  }

  const fiat = await fetchUsdFiatRate(request.to);
  const usdRate = request.amount * fromUsd;
  return { ...request, converted: usdRate * fiat.rate, rate: fromUsd * fiat.rate, rateLabel: `1 ${request.from} = ${formatNumber(fromUsd * fiat.rate)} ${request.to}`, source: `CoinGecko + Frankfurter`, date: fiat.date };
}

export function formatCryptoReply(result) {
  return `🪙 **${formatNumber(result.amount)} ${result.from} = ${formatNumber(result.converted)} ${result.to}**\n${result.rateLabel}\n\n*Latest available market data: ${result.date} · Source: ${result.source}*`;
}
