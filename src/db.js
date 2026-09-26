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
  await request('stock_withdrawals', { method: 'DELETE', query: '?id=gt.0', prefer: 'return=minimal' }).catch(() => {});
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
    query: '?select=stock_id,quantity,reserved_quantity,locked_until,stocks(symbol,name,price,total_supply)&discord_id=eq.' + encode(discordId) + '&order=stock_id.asc'
  }).then((rows) => (rows || []).map((row) => ({
    stockId: row.stock_id,
    quantity: Number(row.quantity || 0),
    reservedQuantity: Number(row.reserved_quantity || 0),
    lockedUntil: row.locked_until || null,
    symbol: row.stocks?.symbol || 'UNKNOWN',
    name: row.stocks?.name || 'Unknown Stock',
    price: Number(row.stocks?.price || 0),
    totalSupply: Number(row.stocks?.total_supply || 150)
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
  const existing = await request('stock_holdings', {
    query: '?select=stock_id,quantity,reserved_quantity,locked_until&discord_id=eq.' + encode(discordId) + '&stock_id=eq.' + encode(stock.id) + '&limit=1'
  });
  const currentQuantity = Number(existing?.[0]?.quantity || 0);
  const reservedQuantity = Number(existing?.[0]?.reserved_quantity || 0);
  const newQuantity = currentQuantity + Number(quantity);
  const lockedUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  if (existing?.[0]) {
    await request('stock_holdings', {
      method: 'PATCH',
      query: '?discord_id=eq.' + encode(discordId) + '&stock_id=eq.' + encode(stock.id),
      body: { quantity: newQuantity, reserved_quantity: reservedQuantity, locked_until: lockedUntil },
      prefer: 'return=minimal'
    });
  } else {
    await request('stock_holdings', {
      method: 'POST',
      body: [{
        discord_id: discordId,
        stock_id: stock.id,
        quantity: Number(quantity),
        reserved_quantity: 0,
        locked_until: lockedUntil
      }],
      prefer: 'return=minimal'
    });
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
  const existing = await request('stock_holdings', {
    query: '?select=stock_id,quantity,reserved_quantity,locked_until&discord_id=eq.' + encode(discordId) + '&stock_id=eq.' + encode(stock.id) + '&limit=1'
  });
  const currentQuantity = Number(existing?.[0]?.quantity || 0);
  const reservedQuantity = Number(existing?.[0]?.reserved_quantity || 0);
  const sellableQuantity = currentQuantity - reservedQuantity;

  if (sellableQuantity < Number(quantity)) {
    if (currentQuantity < Number(quantity)) throw new Error('INSUFFICIENT_SHARES');
    throw new Error('SHARES_RESERVED');
  }

  const newQuantity = currentQuantity - Number(quantity);
  if (newQuantity === 0) {
    await request('stock_holdings', {
      method: 'DELETE',
      query: '?discord_id=eq.' + encode(discordId) + '&stock_id=eq.' + encode(stock.id)
    });
  } else {
    await request('stock_holdings', {
      method: 'PATCH',
      query: '?discord_id=eq.' + encode(discordId) + '&stock_id=eq.' + encode(stock.id),
      body: { quantity: newQuantity, reserved_quantity: reservedQuantity },
      prefer: 'return=minimal'
    });
  }
  const oldPrice = Number(stock.price);
  const priceDecrease = Number((oldPrice * (Number(quantity) / Number(stock.total_supply)) * 0.5).toFixed(2));
  const newPrice = Math.max(0.01, Number((oldPrice - priceDecrease).toFixed(2)));
  await request('stocks', { method: 'PATCH', query: '?id=eq.' + encode(stock.id), body: { price: newPrice }, prefer: 'return=minimal' });
  return { stock: { ...stock, price: newPrice }, quantity: Number(quantity), totalValue: Number(quantity) * newPrice };
}

export async function createStockWithdrawal(guildId, discordId, symbol, quantity) {
  const stocks = await request('stocks', {
    query: '?select=id,symbol,name,price,total_supply&symbol=eq.' + encode(symbol) + '&limit=1'
  });
  const stock = stocks?.[0];
  if (!stock) throw new Error('STOCK_NOT_FOUND');

  const holdings = await request('stock_holdings', {
    query: '?select=stock_id,quantity,reserved_quantity,locked_until&discord_id=eq.' + encode(discordId) + '&stock_id=eq.' + encode(stock.id) + '&limit=1'
  });
  const holding = holdings?.[0];
  if (!holding) throw new Error('INSUFFICIENT_SHARES');

  const totalQuantity = Number(holding.quantity || 0);
  const reservedQuantity = Number(holding.reserved_quantity || 0);
  const availableQuantity = totalQuantity - reservedQuantity;
  const requestedQuantity = Number(quantity);

  if (availableQuantity < requestedQuantity) {
    if (totalQuantity < requestedQuantity) throw new Error('INSUFFICIENT_SHARES');
    throw new Error('SHARES_RESERVED');
  }

  if (holding.locked_until && new Date(holding.locked_until).getTime() > Date.now()) {
    const error = new Error('STOCK_LOCKED');
    error.lockedUntil = holding.locked_until;
    throw error;
  }

  const payoutValue = Number((Number(stock.price) * requestedQuantity).toFixed(2));

  await request('stock_holdings', {
    method: 'PATCH',
    query: '?discord_id=eq.' + encode(discordId) + '&stock_id=eq.' + encode(stock.id),
    body: { reserved_quantity: reservedQuantity + requestedQuantity },
    prefer: 'return=minimal'
  });

  try {
    const rows = await request('stock_withdrawals', {
      method: 'POST',
      body: [{
        guild_id: guildId,
        discord_id: discordId,
        stock_id: stock.id,
        quantity: requestedQuantity,
        price_at_request: Number(stock.price),
        payout_value: payoutValue,
        status: 'pending',
        requested_at: new Date().toISOString()
      }],
      prefer: 'return=representation'
    });

    return rows?.[0] || null;
  } catch (error) {
    await request('stock_holdings', {
      method: 'PATCH',
      query: '?discord_id=eq.' + encode(discordId) + '&stock_id=eq.' + encode(stock.id),
      body: { reserved_quantity: reservedQuantity },
      prefer: 'return=minimal'
    }).catch(() => {});
    throw error;
  }
}

export async function reviewStockWithdrawal(withdrawalId, reviewerId, approve, payoutAmount = null, payoutMethod = null, note = null) {
  const rows = await request('stock_withdrawals', {
    query: '?select=id,guild_id,discord_id,stock_id,quantity,price_at_request,payout_value,status,requested_at&status=eq.pending&id=eq.' + encode(withdrawalId) + '&limit=1'
  });
  const withdrawal = rows?.[0];
  if (!withdrawal) throw new Error('WITHDRAWAL_NOT_PENDING');

  const quantity = Number(withdrawal.quantity);
  const holdings = await request('stock_holdings', {
    query: '?select=quantity,reserved_quantity,locked_until&discord_id=eq.' + encode(withdrawal.discord_id) + '&stock_id=eq.' + encode(withdrawal.stock_id) + '&limit=1'
  });
  const holding = holdings?.[0];
  if (!holding || Number(holding.reserved_quantity || 0) < quantity) {
    throw new Error('WITHDRAWAL_RESERVATION_MISSING');
  }

  const totalQuantity = Number(holding.quantity || 0);
  const reservedQuantity = Number(holding.reserved_quantity || 0);
  const remainingReserved = reservedQuantity - quantity;

  if (approve) {
    const remainingQuantity = totalQuantity - quantity;
    if (remainingQuantity <= 0) {
      await request('stock_holdings', {
        method: 'DELETE',
        query: '?discord_id=eq.' + encode(withdrawal.discord_id) + '&stock_id=eq.' + encode(withdrawal.stock_id)
      });
    } else {
      await request('stock_holdings', {
        method: 'PATCH',
        query: '?discord_id=eq.' + encode(withdrawal.discord_id) + '&stock_id=eq.' + encode(withdrawal.stock_id),
        body: { quantity: remainingQuantity, reserved_quantity: remainingReserved },
        prefer: 'return=minimal'
      });
    }

    const reviewed = await request('stock_withdrawals', {
      method: 'PATCH',
      query: '?id=eq.' + encode(withdrawalId),
      body: {
        status: 'approved',
        reviewer_id: reviewerId,
        reviewed_at: new Date().toISOString(),
        payout_amount: payoutAmount,
        payout_method: payoutMethod,
        note
      },
      prefer: 'return=representation'
    });
    return reviewed?.[0] || { ...withdrawal, status: 'approved', payout_amount: payoutAmount, payout_method: payoutMethod, note };
  }

  const reviewed = await request('stock_holdings', {
    method: 'PATCH',
    query: '?discord_id=eq.' + encode(withdrawal.discord_id) + '&stock_id=eq.' + encode(withdrawal.stock_id),
    body: { reserved_quantity: remainingReserved },
    prefer: 'return=minimal'
  });

  const rejected = await request('stock_withdrawals', {
    method: 'PATCH',
    query: '?id=eq.' + encode(withdrawalId),
    body: {
      status: 'rejected',
      reviewer_id: reviewerId,
      reviewed_at: new Date().toISOString(),
      note
    },
    prefer: 'return=representation'
  });
  return rejected?.[0] || { ...withdrawal, status: 'rejected', note };
}
