const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.PORT) || 3000;
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '';
const contentTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };

class ApiError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.status = status;
  }
}

function requireSupabase() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new ApiError('Backend Supabase belum dikonfigurasi. Atur SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY di environment server.', 503);
  }
}

async function supabase(pathname, options = {}) {
  requireSupabase();
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${pathname}`, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) {
    const message = body?.message || body?.hint || body?.details || (typeof body === 'string' ? body : 'Permintaan Supabase gagal.');
    throw new ApiError(message, response.status);
  }
  return body;
}

async function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) reject(new ApiError('Ukuran permintaan terlalu besar.', 413));
    });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new ApiError('Format JSON tidak valid.', 400)); }
    });
    req.on('error', reject);
  });
}

function number(value, label, { min = 0, allowZero = true } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || (!allowZero && parsed === 0)) {
    throw new ApiError(`${label} tidak valid.`, 400);
  }
  return parsed;
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
}

function addPaymentSummary(sales, payments, items) {
  return sales.map((sale) => {
    const paid = payments.filter((payment) => Number(payment.sale_id) === Number(sale.id)).reduce((sum, payment) => sum + Number(payment.amount), 0);
    return {
      ...sale,
      paid,
      remaining: Math.max(0, Number(sale.total) - paid),
      status: paid >= Number(sale.total) ? 'Lunas' : paid > 0 ? 'DP' : 'Belum bayar',
      item_count: items.filter((item) => Number(item.sale_id) === Number(sale.id)).length,
    };
  });
}

async function getBaseData() {
  const [products, sales, payments, items] = await Promise.all([
    supabase('products?select=*&order=kind.asc,category.asc,name.asc'),
    supabase('sales?select=*&order=sold_at.desc&limit=1000'),
    supabase('payments?select=sale_id,amount'),
    supabase('sale_items?select=sale_id'),
  ]);
  return { products, sales, payments, items };
}

function buildOverview({ products, sales, payments, items }) {
  const month = new Date().toISOString().slice(0, 7);
  const currentSales = sales.filter((sale) => String(sale.sold_at).slice(0, 7) === month);
  const currentPayments = payments;
  const summaries = addPaymentSummary(sales, currentPayments, items);
  const revenue = currentSales.reduce((sum, sale) => sum + Number(sale.total), 0);
  const cogs = currentSales.reduce((sum, sale) => sum + Number(sale.cogs), 0);
  return {
    month,
    revenue,
    cogs,
    profit: revenue - cogs,
    orders: currentSales.length,
    receivables: summaries.reduce((sum, sale) => sum + sale.remaining, 0),
    inventoryValue: products.reduce((sum, product) => sum + Number(product.stock) * Number(product.cost_price), 0),
    productCount: products.length,
    lowStockCount: products.filter((product) => Number(product.stock) <= Number(product.min_stock)).length,
    recentSales: summaries.sort((a, b) => String(b.sold_at).localeCompare(String(a.sold_at))).slice(0, 5),
  };
}

function buildReports({ sales, payments, items }) {
  const summaries = addPaymentSummary(sales, payments, items);
  const months = new Map();
  for (const sale of sales) {
    const month = String(sale.sold_at).slice(0, 7);
    const report = months.get(month) || { month, revenue: 0, cogs: 0, profit: 0, orders: 0 };
    report.revenue += Number(sale.total);
    report.cogs += Number(sale.cogs);
    report.profit += Number(sale.total) - Number(sale.cogs);
    report.orders += 1;
    months.set(month, report);
  }
  const revenue = sales.reduce((sum, sale) => sum + Number(sale.total), 0);
  const cogs = sales.reduce((sum, sale) => sum + Number(sale.cogs), 0);
  return {
    revenue,
    cogs,
    profit: revenue - cogs,
    orders: sales.length,
    months: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)).slice(-6),
    outstanding: summaries.filter((sale) => sale.remaining > 0),
  };
}

async function handleApi(req, res, url) {
  const route = url.pathname;
  if (req.method === 'GET' && route === '/api/health') {
    return sendJson(res, 200, { ok: true, database: SUPABASE_URL && SUPABASE_KEY ? 'supabase' : 'not-configured' });
  }
  if (req.method === 'GET' && route === '/api/overview') {
    return sendJson(res, 200, buildOverview(await getBaseData()));
  }
  if (req.method === 'GET' && route === '/api/products') {
    const products = await supabase('products?select=*&order=kind.asc,category.asc,name.asc');
    return sendJson(res, 200, products.map((product) => ({ ...product, is_low_stock: Number(product.stock) <= Number(product.min_stock) ? 1 : 0 })));
  }
  if (req.method === 'GET' && route === '/api/sales') {
    const { sales, payments, items } = await getBaseData();
    return sendJson(res, 200, addPaymentSummary(sales, payments, items).slice(0, 100));
  }
  if (req.method === 'GET' && route === '/api/reports') {
    const { sales, payments, items } = await getBaseData();
    return sendJson(res, 200, buildReports({ sales, payments, items }));
  }
  if (req.method === 'GET' && route.startsWith('/api/sales/')) {
    const id = Number(route.split('/')[3]);
    const [sales, items, payments] = await Promise.all([
      supabase(`sales?select=*&id=eq.${id}&limit=1`),
      supabase(`sale_items?select=*&sale_id=eq.${id}&order=id.asc`),
      supabase(`payments?select=*&sale_id=eq.${id}&order=paid_at.asc`),
    ]);
    if (!sales.length) return sendJson(res, 404, { error: 'Transaksi tidak ditemukan.' });
    const sale = sales[0];
    const paid = payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
    return sendJson(res, 200, { ...sale, items, payments, paid, remaining: Math.max(0, Number(sale.total) - paid), status: paid >= Number(sale.total) ? 'Lunas' : paid > 0 ? 'DP' : 'Belum bayar' });
  }
  if (req.method === 'POST' && route === '/api/products') {
    const data = await readJson(req);
    if (!String(data.name || '').trim() || !['material', 'finished'].includes(data.kind)) {
      throw new ApiError('Nama barang dan jenis persediaan wajib diisi.', 400);
    }
    for (const [field, label] of [['stock', 'Stok'], ['min_stock', 'Batas minimum'], ['cost_price', 'HPP per unit'], ['sale_price', 'Harga jual']]) {
      number(data[field] ?? 0, label);
    }
    const product = await supabase('rpc/stockita_create_product', {
      method: 'POST', body: JSON.stringify({ p_product: data }),
    });
    return sendJson(res, 201, product);
  }
  if (req.method === 'POST' && route === '/api/stock-adjustments') {
    const data = await readJson(req);
    const productId = number(data.product_id, 'Barang', { min: 1, allowZero: false });
    const delta = Number(data.quantity_delta);
    if (!Number.isFinite(delta) || delta === 0) throw new ApiError('Jumlah perubahan stok harus bukan nol.', 400);
    const product = await supabase('rpc/stockita_adjust_stock', {
      method: 'POST', body: JSON.stringify({ p_product_id: productId, p_quantity_delta: delta, p_note: String(data.note || 'Penyesuaian stok').trim() }),
    });
    return sendJson(res, 200, { ...product, is_low_stock: Number(product.stock) <= Number(product.min_stock) ? 1 : 0 });
  }
  if (req.method === 'POST' && route === '/api/sales') {
    const data = await readJson(req);
    const customer = String(data.customer || '').trim();
    const lines = Array.isArray(data.items) ? data.items : [];
    if (!customer || lines.length === 0) throw new ApiError('Nama pelanggan dan minimal satu barang wajib diisi.', 400);
    const items = lines.map((line) => ({
      product_id: number(line.product_id, 'Barang', { min: 1, allowZero: false }),
      quantity: number(line.quantity, 'Kuantitas', { min: 0, allowZero: false }),
      unit_price: number(line.unit_price, 'Harga jual'),
    }));
    const initialPayment = number(data.initial_payment ?? 0, 'Pembayaran awal');
    const sale = await supabase('rpc/stockita_create_sale', {
      method: 'POST',
      body: JSON.stringify({ p_customer: customer, p_note: String(data.note || '').trim(), p_items: items, p_initial_payment: initialPayment, p_payment_method: String(data.payment_method || 'Transfer') }),
    });
    return sendJson(res, 201, sale);
  }
  const paymentMatch = route.match(/^\/api\/sales\/(\d+)\/payments$/);
  if (req.method === 'POST' && paymentMatch) {
    const data = await readJson(req);
    const amount = number(data.amount, 'Nominal pembayaran', { min: 0, allowZero: false });
    const result = await supabase('rpc/stockita_add_payment', {
      method: 'POST', body: JSON.stringify({ p_sale_id: Number(paymentMatch[1]), p_amount: amount, p_method: String(data.method || 'Transfer') }),
    });
    return sendJson(res, 201, result);
  }
  return sendJson(res, 404, { error: 'Endpoint tidak ditemukan.' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'Metode tidak didukung.' });
    const requestedPath = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    const filePath = path.resolve(FRONTEND_DIR, requestedPath);
    if (!filePath.startsWith(FRONTEND_DIR + path.sep)) return sendJson(res, 403, { error: 'Akses ditolak.' });
    const body = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': contentTypes[path.extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (error) {
    if (error.code === 'ENOENT') return sendJson(res, 404, { error: 'Halaman tidak ditemukan.' });
    if (res.headersSent) return res.destroy();
    const status = error instanceof ApiError ? error.status : 500;
    sendJson(res, status, { error: error.message || 'Terjadi kesalahan pada server.' });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Stockita untuk Aster Konveksi berjalan di http://localhost:${PORT}`);
  if (SUPABASE_URL && SUPABASE_KEY) console.log(`Database Supabase: ${SUPABASE_URL}`);
  else console.log('Supabase belum dikonfigurasi. Atur SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY sebelum memakai API.');
});
