import { config } from './config.js';

const baseUrl = config.supabaseUrl.replace(/\/$/, '') + '/rest/v1';

export async function request(table, { method = 'GET', query = '', body, prefer } = {}) {
  const response = await fetch(baseUrl + '/' + table + query, {
    method,
    headers: {
      apikey: config.supabaseSecretKey,
      Authorization: 'Bearer ' + config.supabaseSecretKey,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {})
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) {
    const detail = typeof data === 'string' ? data : JSON.stringify(data);
    throw new Error('Supabase ' + method + ' ' + table + ' failed (' + response.status + '): ' + detail);
  }
  return data;
}

function encode(value) { return encodeURIComponent(value); }

export async function resetStocks() {
  await request('stock_holdings', { method: 'DELETE', query: '?stock_id=not.is.null', prefer: 'return=minimal' });
  await request('stocks', { method: 'PATCH', query: '?id=gt.0', body: { price: 75, total_supply: 150 }, prefer: 'return=minimal' });
  return true;
}

export async function getStocks() {
  const stocks = await request('stocks', { query: '?select=id,symbol,name,price,total_supply&order=id.asc' });
  const holdings = await request('stock_holdings', { query: '?select=stock_id,quantity' });
  const totals = new Map();
  for (const row of holdings || []) totals.set(row.stock_id, (totals.get(row.stock_id) || 0) + Number(row.quantity || 0));
  return (stocks || []).map((stock) => ({
    ...stock,
    price: Number(stock.price),
    totalSupply: Number(stock.total_supply),
    owned: totals.get(stock.id) || 0,
    available: Math.max(0, Number(stock.total_supply) - (totals.get(stock.id) || 0))
  }));
}

export async function getUserPortfolio(discordId) {
  return request('stock_holdings', {
    query: '?select=stock_id,quantity,stocks(symbol,name,price,total_supply)&discord_id=eq.' + encode(discordId) + '&order=stock_id.asc'
  }).then((rows) => (rows || []).map((row) => ({
    stockId: row.stock_id, quantity: Number(row.quantity),
    symbol: row.stocks?.symbol || 'UNKNOWN', name: row.stocks?.name || 'Unknown Stock',
    price: Number(row.stocks?.price || 0), totalSupply: Number(row.stocks?.total_supply || 150)
  })));
}

export async function buyStock(discordId, symbol, quantity) {
  const stocks = await request('stocks', { query: '?select=id,symbol,name,price,total_supply&symbol=eq.' + encode(symbol) + '&limit=1' });
  const stock = stocks?.[0];
  if (!stock) throw new Error('STOCK_NOT_FOUND');
  const holdings = await request('stock_holdings', { query: '?select=quantity&stock_id=eq.' + encode(stock.id) });
  const marketOwned = (holdings || []).reduce((sum, row) => sum + Number(row.quantity || 0), 0);
  const available = Number(stock.total_supply) - marketOwned;
  if (Number(quantity) > available) throw new Error('INSUFFICIENT_SUPPLY');
  const existing = await request('stock_holdings', { query: '?select=stock_id,quantity&discord_id=eq.' + encode(discordId) + '&stock_id=eq.' + encode(stock.id) + '&limit=1' });
  const currentQuantity = Number(existing?.[0]?.quantity || 0);
  const newQuantity = currentQuantity + Number(quantity);
  if (existing?.[0]) {
    await request('stock_holdings', { method: 'PATCH', query: '?discord_id=eq.' + encode(discordId) + '&stock_id=eq.' + encode(stock.id), body: { quantity: newQuantity }, prefer: 'return=minimal' });
  } else {
    await request('stock_holdings', { method: 'POST', body: [{ discord_id: discordId, stock_id: stock.id, quantity: Number(quantity) }], prefer: 'return=minimal' });
  }
  const oldPrice = Number(stock.price);
  const priceIncrease = Number((oldPrice * (Number(quantity) / Number(stock.total_supply)) * 0.5).toFixed(2));
  const newPrice = Math.max(0.01, Number((oldPrice + priceIncrease).toFixed(2)));
  await request('stocks', { method: 'PATCH', query: '?id=eq.' + encode(stock.id), body: { price: newPrice }, prefer: 'return=minimal' });
  return { stock: { ...stock, price: newPrice }, quantity: newQuantity, totalValue: newQuantity * newPrice, available: available - Number(quantity) };
}

export async function sellStock(discordId, symbol, quantity) {
  const stocks = await request('stocks', { query: '?select=id,symbol,name,price,total_supply&symbol=eq.' + encode(symbol) + '&limit=1' });
  const stock = stocks?.[0];
  if (!stock) throw new Error('STOCK_NOT_FOUND');
  const existing = await request('stock_holdings', { query: '?select=stock_id,quantity&discord_id=eq.' + encode(discordId) + '&stock_id=eq.' + encode(stock.id) + '&limit=1' });
  const currentQuantity = Number(existing?.[0]?.quantity || 0);
  if (currentQuantity < Number(quantity)) throw new Error('INSUFFICIENT_SHARES');
  const newQuantity = currentQuantity - Number(quantity);
  if (newQuantity === 0) await request('stock_holdings', { method: 'DELETE', query: '?discord_id=eq.' + encode(discordId) + '&stock_id=eq.' + encode(stock.id) });
  else await request('stock_holdings', { method: 'PATCH', query: '?discord_id=eq.' + encode(discordId) + '&stock_id=eq.' + encode(stock.id), body: { quantity: newQuantity }, prefer: 'return=minimal' });
  const oldPrice = Number(stock.price);
  const priceDecrease = Number((oldPrice * (Number(quantity) / Number(stock.total_supply)) * 0.5).toFixed(2));
  const newPrice = Math.max(0.01, Number((oldPrice - priceDecrease).toFixed(2)));
  await request('stocks', { method: 'PATCH', query: '?id=eq.' + encode(stock.id), body: { price: newPrice }, prefer: 'return=minimal' });
  return { stock: { ...stock, price: newPrice }, quantity: Number(quantity), totalValue: Number(quantity) * newPrice };
}