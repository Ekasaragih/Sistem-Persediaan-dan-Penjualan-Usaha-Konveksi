const state = {
  view: 'dashboard',
  filter: 'all',
  search: '',
  products: [],
  sales: [],
  overview: null,
  reports: null,
};

const content = document.getElementById('page-content');
const dialog = document.getElementById('app-dialog');
const toastRegion = document.getElementById('toast-region');
const navNames = { dashboard: 'Ringkasan', inventory: 'Persediaan', sales: 'Penjualan', reports: 'Laporan' };
const icon = (name) => `<svg aria-hidden="true"><use href="#icon-${name}"></use></svg>`;
const money = (amount) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(amount) || 0);
const quantity = (amount) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(Number(amount) || 0);
const dateTime = (value) => new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value));
const monthName = (value) => new Intl.DateTimeFormat('id-ID', { month: 'short', year: '2-digit' }).format(new Date(`${value}-15T12:00:00`));
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const browserStorageMode = location.protocol === 'file:' || location.hostname === 'github.io' || location.hostname.endsWith('.github.io');

async function api(path, options = {}) {
  if (browserStorageMode) return localApi(path, options);
  const response = await fetch(path, {
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Permintaan tidak dapat diproses.');
  return data;
}

const localStorageKey = 'stockita-aster-data-v1';
const sampleProducts = [
  ['MAT-001', 'Kaos polos cotton combed 24s', 'Kaos', 'material', 'pcs', 58, 20, 28000, 0],
  ['MAT-002', 'Tote bag kanvas polos', 'Tas', 'material', 'pcs', 32, 10, 12500, 0],
  ['MAT-003', 'Akrilik bening 4 x 4 cm', 'Akrilik', 'material', 'lembar', 145, 40, 2500, 0],
  ['MAT-004', 'Kertas transfer DTF', 'Sablon', 'material', 'meter', 18, 5, 55000, 0],
  ['FIN-001', 'Kaos sablon custom Aster', 'Kaos', 'finished', 'pcs', 16, 5, 55000, 95000],
  ['FIN-002', 'Tote bag sablon custom', 'Tas', 'finished', 'pcs', 10, 4, 27000, 55000],
  ['FIN-003', 'Gantungan kunci akrilik custom', 'Aksesori', 'finished', 'pcs', 24, 8, 8000, 18000],
  ['FIN-004', 'Hoodie bordir custom', 'Pakaian', 'finished', 'pcs', 6, 3, 130000, 220000],
];

function createLocalDatabase() {
  const now = new Date().toISOString();
  return {
    products: sampleProducts.map(([sku, name, category, kind, unit, stock, min_stock, cost_price, sale_price], index) => ({
      id: index + 1, sku, name, category, kind, unit, stock, min_stock, cost_price, sale_price, created_at: now,
    })),
    sales: [], payments: [], items: [], movements: [], nextProductId: sampleProducts.length + 1,
    nextSaleId: 1, nextPaymentId: 1, nextItemId: 1, nextMovementId: 1,
  };
}

function readLocalDatabase() {
  try {
    const stored = localStorage.getItem(localStorageKey);
    if (stored) return JSON.parse(stored);
    const database = createLocalDatabase();
    localStorage.setItem(localStorageKey, JSON.stringify(database));
    return database;
  } catch {
    throw new Error('Penyimpanan browser tidak tersedia. Coba buka index.html dengan browser lain atau gunakan backend Supabase.');
  }
}

function saveLocalDatabase(database) {
  try {
    localStorage.setItem(localStorageKey, JSON.stringify(database));
  } catch {
    throw new Error('Data tidak dapat disimpan di penyimpanan browser. Periksa ruang penyimpanan atau gunakan backend Supabase.');
  }
}

function localSaleSummary(database, sale) {
  const paid = database.payments.filter((payment) => payment.sale_id === sale.id).reduce((sum, payment) => sum + payment.amount, 0);
  return {
    ...sale,
    paid,
    remaining: Math.max(0, sale.total - paid),
    status: paid >= sale.total ? 'Lunas' : paid > 0 ? 'DP' : 'Belum bayar',
    item_count: database.items.filter((item) => item.sale_id === sale.id).length,
  };
}

function localOverview(database) {
  const month = new Date().toISOString().slice(0, 7);
  const sales = database.sales.filter((sale) => sale.sold_at.slice(0, 7) === month);
  const summaries = database.sales.map((sale) => localSaleSummary(database, sale));
  return {
    month,
    revenue: sales.reduce((sum, sale) => sum + sale.total, 0),
    cogs: sales.reduce((sum, sale) => sum + sale.cogs, 0),
    profit: sales.reduce((sum, sale) => sum + sale.total - sale.cogs, 0),
    orders: sales.length,
    receivables: summaries.reduce((sum, sale) => sum + sale.remaining, 0),
    inventoryValue: database.products.reduce((sum, product) => sum + product.stock * product.cost_price, 0),
    productCount: database.products.length,
    lowStockCount: database.products.filter((product) => product.stock <= product.min_stock).length,
    recentSales: summaries.sort((a, b) => b.sold_at.localeCompare(a.sold_at)).slice(0, 5),
  };
}

function localReports(database) {
  const totals = database.sales.reduce((result, sale) => {
    result.revenue += sale.total;
    result.cogs += sale.cogs;
    result.profit += sale.total - sale.cogs;
    result.orders += 1;
    return result;
  }, { revenue: 0, cogs: 0, profit: 0, orders: 0 });
  const grouped = new Map();
  for (const sale of database.sales) {
    const month = sale.sold_at.slice(0, 7);
    const entry = grouped.get(month) || { month, revenue: 0, cogs: 0, profit: 0, orders: 0 };
    entry.revenue += sale.total;
    entry.cogs += sale.cogs;
    entry.profit += sale.total - sale.cogs;
    entry.orders += 1;
    grouped.set(month, entry);
  }
  const outstanding = database.sales.map((sale) => ({ ...localSaleSummary(database, sale) }))
    .filter((sale) => sale.remaining > 0).sort((a, b) => b.sold_at.localeCompare(a.sold_at));
  return { ...totals, months: [...grouped.values()].sort((a, b) => a.month.localeCompare(b.month)).slice(-6), outstanding };
}

function localNumber(value, label, { min = 0, allowZero = true } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || (!allowZero && parsed === 0)) throw new Error(`${label} tidak valid.`);
  return parsed;
}

async function localApi(path, options = {}) {
  const route = String(path).split('?')[0];
  const method = options.method || 'GET';
  const data = options.body ? JSON.parse(options.body) : {};
  const database = readLocalDatabase();
  const productWithStatus = (product) => ({ ...product, is_low_stock: product.stock <= product.min_stock ? 1 : 0 });

  if (method === 'GET' && route === '/api/health') return { ok: true, database: 'browser' };
  if (method === 'GET' && route === '/api/overview') return localOverview(database);
  if (method === 'GET' && route === '/api/products') return database.products.map(productWithStatus).sort((a, b) => a.kind.localeCompare(b.kind) || a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  if (method === 'GET' && route === '/api/sales') return database.sales.map((sale) => localSaleSummary(database, sale)).sort((a, b) => b.sold_at.localeCompare(a.sold_at)).slice(0, 100);
  if (method === 'GET' && route === '/api/reports') return localReports(database);

  const detailMatch = route.match(/^\/api\/sales\/(\d+)$/);
  if (method === 'GET' && detailMatch) {
    const id = Number(detailMatch[1]);
    const sale = database.sales.find((entry) => entry.id === id);
    if (!sale) throw new Error('Transaksi tidak ditemukan.');
    return {
      ...localSaleSummary(database, sale),
      items: database.items.filter((item) => item.sale_id === id),
      payments: database.payments.filter((payment) => payment.sale_id === id),
    };
  }

  if (method === 'POST' && route === '/api/products') {
    const name = String(data.name || '').trim();
    if (!name || !['material', 'finished'].includes(data.kind)) throw new Error('Nama barang dan jenis persediaan wajib diisi.');
    const sku = String(data.sku || `AST-${Date.now().toString().slice(-7)}`).trim();
    if (database.products.some((product) => product.sku.toLocaleLowerCase('id') === sku.toLocaleLowerCase('id'))) throw new Error('Kode SKU sudah digunakan.');
    const product = {
      id: database.nextProductId++, sku, name, category: String(data.category || 'Lainnya').trim(),
      kind: data.kind, unit: String(data.unit || 'pcs').trim(),
      stock: localNumber(data.stock ?? 0, 'Stok'), min_stock: localNumber(data.min_stock ?? 0, 'Batas minimum'),
      cost_price: localNumber(data.cost_price ?? 0, 'HPP per unit'), sale_price: localNumber(data.sale_price ?? 0, 'Harga jual'),
      created_at: new Date().toISOString(),
    };
    database.products.push(product);
    if (product.stock > 0) database.movements.push({ id: database.nextMovementId++, product_id: product.id, movement_type: 'initial', quantity_delta: product.stock, unit_cost: product.cost_price, note: 'Saldo awal', created_at: product.created_at });
    saveLocalDatabase(database);
    return productWithStatus(product);
  }

  if (method === 'POST' && route === '/api/stock-adjustments') {
    const product = database.products.find((entry) => entry.id === Number(data.product_id));
    if (!product) throw new Error('Barang tidak ditemukan.');
    const delta = Number(data.quantity_delta);
    if (!Number.isFinite(delta) || delta === 0) throw new Error('Jumlah perubahan stok harus bukan nol.');
    if (product.stock + delta < 0) throw new Error(`Stok ${product.name} tidak mencukupi.`);
    product.stock += delta;
    database.movements.push({ id: database.nextMovementId++, product_id: product.id, movement_type: 'adjustment', quantity_delta: delta, unit_cost: product.cost_price, note: String(data.note || 'Penyesuaian stok').trim(), created_at: new Date().toISOString() });
    saveLocalDatabase(database);
    return productWithStatus(product);
  }

  if (method === 'POST' && route === '/api/sales') {
    const customer = String(data.customer || '').trim();
    if (!customer || !Array.isArray(data.items) || data.items.length === 0) throw new Error('Nama pelanggan dan minimal satu barang wajib diisi.');
    const prepared = data.items.map((line) => {
      const product = database.products.find((entry) => entry.id === Number(line.product_id));
      if (!product) throw new Error('Salah satu barang tidak ditemukan.');
      const amount = localNumber(line.quantity, 'Kuantitas', { min: 0, allowZero: false });
      const unitPrice = localNumber(line.unit_price ?? product.sale_price, 'Harga jual');
      return { product, quantity: amount, unitPrice, subtotal: amount * unitPrice, lineCogs: amount * product.cost_price };
    });
    const requested = new Map();
    for (const item of prepared) requested.set(item.product.id, (requested.get(item.product.id) || 0) + item.quantity);
    for (const [productId, amount] of requested) {
      const product = database.products.find((entry) => entry.id === productId);
      if (amount > product.stock) throw new Error(`Stok ${product.name} tidak mencukupi (tersedia ${product.stock} ${product.unit}).`);
    }
    const total = prepared.reduce((sum, item) => sum + item.subtotal, 0);
    const cogs = prepared.reduce((sum, item) => sum + item.lineCogs, 0);
    const initialPayment = localNumber(data.initial_payment ?? 0, 'Pembayaran awal');
    if (initialPayment > total) throw new Error('Pembayaran awal melebihi total transaksi.');
    const now = new Date().toISOString();
    const id = database.nextSaleId++;
    const sale = { id, invoice: `AST-${now.slice(0, 10).replaceAll('-', '')}-${String(id).padStart(5, '0')}`, customer, note: String(data.note || '').trim(), sold_at: now, total, cogs };
    database.sales.push(sale);
    for (const item of prepared) {
      database.items.push({ id: database.nextItemId++, sale_id: id, product_id: item.product.id, product_name: item.product.name, quantity: item.quantity, unit_price: item.unitPrice, unit_cost: item.product.cost_price, subtotal: item.subtotal, line_cogs: item.lineCogs });
      item.product.stock -= item.quantity;
      database.movements.push({ id: database.nextMovementId++, product_id: item.product.id, movement_type: 'sale', quantity_delta: -item.quantity, unit_cost: item.product.cost_price, note: `Penjualan ${sale.invoice}`, created_at: now });
    }
    if (initialPayment > 0) database.payments.push({ id: database.nextPaymentId++, sale_id: id, amount: initialPayment, method: String(data.payment_method || 'Transfer'), paid_at: now });
    saveLocalDatabase(database);
    return sale;
  }

  const paymentMatch = route.match(/^\/api\/sales\/(\d+)\/payments$/);
  if (method === 'POST' && paymentMatch) {
    const saleId = Number(paymentMatch[1]);
    const sale = database.sales.find((entry) => entry.id === saleId);
    if (!sale) throw new Error('Transaksi tidak ditemukan.');
    const amount = localNumber(data.amount, 'Nominal pembayaran', { min: 0, allowZero: false });
    const paid = database.payments.filter((payment) => payment.sale_id === saleId).reduce((sum, payment) => sum + payment.amount, 0);
    if (amount > sale.total - paid) throw new Error('Nominal pembayaran melebihi sisa tagihan.');
    database.payments.push({ id: database.nextPaymentId++, sale_id: saleId, amount, method: String(data.method || 'Transfer'), paid_at: new Date().toISOString() });
    saveLocalDatabase(database);
    return { ok: true, remaining: sale.total - paid - amount };
  }

  throw new Error('Endpoint tidak ditemukan.');
}

function setView(view) {
  state.view = view;
  document.querySelectorAll('.nav-link').forEach((button) => button.classList.toggle('is-active', button.dataset.view === view));
  document.getElementById('crumb-current').textContent = navNames[view];
  render();
}

async function refreshData() {
  const storageStatus = document.querySelector('.sidebar-bottom span:nth-child(2)');
  if (browserStorageMode) {
    if (storageStatus) storageStatus.textContent = 'Penyimpanan browser aktif';
  } else {
    const backend = await api('/api/health');
    if (storageStatus) storageStatus.textContent = backend.database === 'supabase' ? 'Database Supabase aktif' : 'Supabase belum dikonfigurasi';
  }
  const [overview, products, sales, reports] = await Promise.all([
    api('/api/overview'), api('/api/products'), api('/api/sales'), api('/api/reports'),
  ]);
  state.overview = overview;
  state.products = products;
  state.sales = sales;
  state.reports = reports;
  render();
}

function pageHeading(eyebrow, title, subtitle, action = '') {
  return `<div class="page-heading"><div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p class="page-subtitle">${subtitle}</p></div>${action}</div>`;
}

function metric(label, value, note, symbol, accent = false) {
  return `<article class="metric${accent ? ' metric-accent' : ''}"><span class="metric-label">${icon(symbol)}${label}</span><strong class="metric-value">${value}</strong><span class="metric-foot">${note}</span></article>`;
}

function statusBadge(status) {
  const className = status === 'Lunas' ? 'status-paid' : status === 'DP' ? 'status-partial' : 'status-unpaid';
  return `<span class="status ${className}">${escapeHtml(status)}</span>`;
}

function render() {
  if (!state.overview) return;
  const pages = {
    dashboard: renderDashboard,
    inventory: renderInventory,
    sales: renderSales,
    reports: renderReports,
  };
  content.innerHTML = pages[state.view]();
}

function renderDashboard() {
  const overview = state.overview;
  const lowStock = state.products.filter((product) => product.stock <= product.min_stock).slice(0, 5);
  const recent = overview.recentSales || [];
  const revenue = `<span class="numeric">${money(overview.revenue)}</span>`;
  return `${pageHeading(`ASTER KONVEKSI · ${monthName(overview.month)}`, 'Ringkasan', 'Pantau pergerakan usaha dan kondisi persediaan.', `<button class="button button-primary" data-action="create-sale">${icon('plus')} Catat penjualan</button>`)}
    <section class="metric-grid" aria-label="Ringkasan bulan ini">
      ${metric('Omzet bulan ini', revenue, `${overview.orders} transaksi tercatat`, 'arrow-up', true)}
      ${metric('Laba kotor', money(overview.profit), `Setelah HPP ${money(overview.cogs)}`, 'chart')}
      ${metric('Piutang berjalan', money(overview.receivables), 'Sisa tagihan pelanggan', 'wallet')}
      ${metric('Nilai persediaan', money(overview.inventoryValue), `${overview.productCount} jenis barang · ${overview.lowStockCount} perlu restok`, 'box')}
    </section>
    <section class="dashboard-grid">
      <article class="panel">
        <header class="panel-header"><h2>Penjualan terbaru</h2><button class="panel-link" data-action="view-sales">Semua transaksi <span aria-hidden="true">→</span></button></header>
        ${recent.length ? `<div class="table-wrap"><table><thead><tr><th>Transaksi</th><th>Pelanggan</th><th>Total</th><th>Status</th></tr></thead><tbody>${recent.map((sale) => `<tr><td><button class="panel-link" data-action="sale-detail" data-id="${sale.id}">${escapeHtml(sale.invoice)}</button><span class="secondary-line">${dateTime(sale.sold_at)}</span></td><td>${escapeHtml(sale.customer)}</td><td class="numeric">${money(sale.total)}</td><td>${statusBadge(sale.status)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-state">Belum ada transaksi. Penjualan pertama akan muncul di sini.</div>'}
      </article>
      <article class="panel">
        <header class="panel-header"><h2>Perlu perhatian</h2><button class="panel-link" data-action="view-inventory">Persediaan <span aria-hidden="true">→</span></button></header>
        ${lowStock.length ? `<div class="stock-list">${lowStock.map((product) => `<div class="stock-item"><div><span class="stock-item-name">${escapeHtml(product.name)}</span><span class="stock-item-meta">Batas minimum ${quantity(product.min_stock)} ${escapeHtml(product.unit)}</span></div><div class="stock-count">${quantity(product.stock)} ${escapeHtml(product.unit)}<span class="secondary-line">tersisa</span></div></div>`).join('')}</div>` : '<div class="empty-state">Semua barang berada di atas batas minimum.</div>'}
      </article>
    </section>`;
}

function renderInventory() {
  const query = state.search.trim().toLocaleLowerCase('id');
  const products = state.products.filter((product) => (state.filter === 'all' || product.kind === state.filter)
    && `${product.name} ${product.sku} ${product.category}`.toLocaleLowerCase('id').includes(query));
  const filters = [['all', 'Semua'], ['material', 'Bahan baku'], ['finished', 'Barang jadi']];
  const rows = products.map((product) => `<tr>
    <td><span class="item-title">${escapeHtml(product.name)}</span><span class="secondary-line sku">${escapeHtml(product.sku)} · ${escapeHtml(product.category)}</span></td>
    <td><span class="kind-label">${product.kind === 'material' ? 'Bahan baku' : 'Barang jadi'}</span></td>
    <td class="numeric"><strong>${quantity(product.stock)}</strong> ${escapeHtml(product.unit)}<span class="secondary-line">Min. ${quantity(product.min_stock)} ${escapeHtml(product.unit)}</span></td>
    <td class="numeric">${money(product.cost_price)}</td><td class="numeric">${product.sale_price ? money(product.sale_price) : '<span class="muted">Belum diatur</span>'}</td>
    <td>${product.is_low_stock ? '<span class="status status-low">Stok menipis</span>' : '<span class="status status-stock">Tersedia</span>'}</td>
    <td><div class="row-actions"><button class="button button-quiet" data-action="update-stock" data-id="${product.id}" aria-label="Sesuaikan stok ${escapeHtml(product.name)}">Sesuaikan stok</button></div></td>
  </tr>`).join('');
  return `${pageHeading('BAHAN BAKU & PRODUK', 'Persediaan', 'Bahan produksi dan barang jadi dalam satu catatan stok.', `<button class="button button-primary" data-action="create-product">${icon('plus')} Tambah barang</button>`)}
    <div class="toolbar"><div class="toolbar-left"><label class="search-field">${icon('search')}<input id="product-search" type="search" placeholder="Cari nama atau SKU" value="${escapeHtml(state.search)}" aria-label="Cari persediaan"></label>
      <div class="segmented" aria-label="Filter jenis persediaan">${filters.map(([value, label]) => `<button class="segment${state.filter === value ? ' is-active' : ''}" data-filter="${value}">${label}</button>`).join('')}</div></div>
      <div class="toolbar-right"><span class="muted" style="font-size:10px">${products.length} dari ${state.products.length} barang</span></div></div>
    <section class="panel table-panel"><div class="table-wrap"><table><thead><tr><th>Barang</th><th>Jenis</th><th>Stok tersedia</th><th>HPP / unit</th><th>Harga jual</th><th>Kondisi</th><th></th></tr></thead>
    <tbody>${rows || `<tr><td colspan="7"><div class="empty-state">${state.products.length ? 'Barang tidak ditemukan.' : 'Belum ada barang terdaftar.'}</div></td></tr>`}</tbody></table></div></section>`;
}

function renderSales() {
  const open = state.sales.filter((sale) => sale.remaining > 0);
  const rows = state.sales.map((sale) => `<tr>
    <td><button class="panel-link" data-action="sale-detail" data-id="${sale.id}">${escapeHtml(sale.invoice)}</button><span class="secondary-line">${dateTime(sale.sold_at)}</span></td>
    <td>${escapeHtml(sale.customer)}<span class="secondary-line">${sale.item_count} jenis barang</span></td>
    <td class="numeric">${money(sale.total)}</td><td class="numeric">${money(sale.paid)}</td><td class="numeric">${money(sale.remaining)}</td><td>${statusBadge(sale.status)}</td>
    <td><button class="button button-quiet" data-action="sale-detail" data-id="${sale.id}">Detail</button></td></tr>`).join('');
  return `${pageHeading('PESANAN & PEMBAYARAN', 'Penjualan', 'Catat pesanan pelanggan, DP, dan pelunasan dalam satu alur.', `<button class="button button-primary" data-action="create-sale">${icon('plus')} Catat penjualan</button>`)}
    <section class="panel table-panel"><div class="sales-summary"><span>Transaksi <strong>${state.sales.length}</strong></span><span>Belum lunas <strong>${open.length}</strong></span><span>Sisa piutang <strong>${money(state.sales.reduce((sum, sale) => sum + sale.remaining, 0))}</strong></span></div>
    <div class="table-wrap"><table><thead><tr><th>Invoice</th><th>Pelanggan</th><th>Total</th><th>Dibayar</th><th>Sisa</th><th>Status</th><th></th></tr></thead>
    <tbody>${rows || '<tr><td colspan="7"><div class="empty-state">Belum ada penjualan. Transaksi baru akan tersimpan bersama HPP dan perubahan stok.</div></td></tr>'}</tbody></table></div></section>`;
}

function renderReports() {
  const report = state.reports;
  const months = report.months || [];
  const highest = Math.max(1, ...months.map((entry) => entry.revenue));
  const outstanding = report.outstanding || [];
  return `${pageHeading('AKUNTANSI & ARUS TRANSAKSI', 'Laporan', 'Ringkasan omzet, HPP barang terjual, laba kotor, dan piutang.', '')}
    <section class="report-hero"><div><p class="eyebrow">TOTAL TEREKAM</p><p class="report-main-value">${money(report.profit)}</p><small>Laba kotor · omzet dikurangi HPP</small></div>
      <div class="report-stat"><span>Omzet</span><strong>${money(report.revenue)}</strong></div><div class="report-stat"><span>HPP terjual</span><strong>${money(report.cogs)}</strong></div><div class="report-stat"><span>Transaksi</span><strong>${report.orders}</strong></div></section>
    <section class="report-grid"><article class="panel"><header class="panel-header"><h2>Performa bulanan</h2><span class="muted" style="font-size:9px">Omzet · 6 bulan terakhir</span></header>
      ${months.length ? `<div class="chart-list">${months.map((entry) => `<div class="chart-row"><span class="chart-month">${monthName(entry.month)}</span><div class="chart-track"><div class="chart-bar" style="width:${Math.max(2, entry.revenue / highest * 100)}%"></div></div><strong class="chart-value">${money(entry.revenue)}</strong></div>`).join('')}</div>` : '<div class="empty-state">Grafik akan terbentuk setelah transaksi penjualan tercatat.</div>'}
      <p class="report-note" style="padding:0 19px 17px">Laba yang ditampilkan adalah laba kotor dan belum mengurangi biaya operasional usaha.</p></article>
    <article class="panel"><header class="panel-header"><h2>Piutang pelanggan</h2><span class="receivable-total">${money(outstanding.reduce((sum, sale) => sum + sale.remaining, 0))}</span></header>
      ${outstanding.length ? `<div class="table-wrap"><table><thead><tr><th>Pelanggan</th><th>Invoice</th><th>Sisa</th></tr></thead><tbody>${outstanding.map((sale) => `<tr><td>${escapeHtml(sale.customer)}<span class="secondary-line">${dateTime(sale.sold_at)}</span></td><td><button class="panel-link" data-action="sale-detail" data-id="${sale.id}">${escapeHtml(sale.invoice)}</button></td><td class="numeric">${money(sale.remaining)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-state">Tidak ada piutang yang berjalan.</div>'}</article></section>`;
}

function modal(title, subtitle, body) {
  dialog.innerHTML = `<header class="dialog-header"><div><h2>${title}</h2><p>${subtitle}</p></div><button class="icon-button" data-action="close-dialog" aria-label="Tutup">${icon('close')}</button></header>${body}`;
  dialog.showModal();
}

function openProductForm() {
  modal('Tambah barang', 'Daftarkan bahan produksi atau produk jadi Aster.', `<form id="product-form" class="dialog-body">
    <div class="form-grid"><div class="field field-full"><label for="product-name">Nama barang</label><input id="product-name" name="name" required maxlength="100" placeholder="Contoh: Kaos polos cotton combed"></div>
    <div class="field"><label for="product-sku">Kode SKU</label><input id="product-sku" name="sku" maxlength="32" placeholder="Otomatis bila dikosongkan"></div>
    <div class="field"><label for="product-category">Kategori</label><input id="product-category" name="category" required maxlength="50" placeholder="Kaos, tas, sablon..."></div>
    <div class="field"><label for="product-kind">Jenis persediaan</label><select id="product-kind" name="kind"><option value="material">Bahan baku</option><option value="finished">Barang jadi</option></select></div>
    <div class="field"><label for="product-unit">Satuan</label><input id="product-unit" name="unit" required maxlength="20" value="pcs"></div>
    <div class="field"><label for="product-stock">Stok awal</label><input id="product-stock" name="stock" type="number" min="0" step="0.01" value="0" required></div>
    <div class="field"><label for="product-min">Batas minimum stok</label><input id="product-min" name="min_stock" type="number" min="0" step="0.01" value="0" required></div>
    <div class="field"><label for="product-cost">HPP per unit (Rp)</label><input id="product-cost" name="cost_price" type="number" min="0" step="500" value="0" required></div>
    <div class="field"><label for="product-price">Harga jual (Rp)</label><input id="product-price" name="sale_price" type="number" min="0" step="500" value="0" required></div></div>
    <div class="dialog-actions"><button type="button" class="button button-secondary" data-action="close-dialog">Batal</button><button class="button button-primary" type="submit">Simpan barang</button></div></form>`);
}

function openStockForm(id) {
  const product = state.products.find((item) => item.id === id);
  if (!product) return;
  modal('Sesuaikan stok', `${escapeHtml(product.name)} · saat ini ${quantity(product.stock)} ${escapeHtml(product.unit)}`, `<form id="stock-form" class="dialog-body" data-product-id="${product.id}">
    <div class="form-grid"><div class="field"><label for="stock-direction">Arah perubahan</label><select id="stock-direction" name="direction"><option value="add">Tambah stok</option><option value="subtract">Kurangi stok</option></select></div>
    <div class="field"><label for="stock-quantity">Jumlah (${escapeHtml(product.unit)})</label><input id="stock-quantity" name="quantity" type="number" min="0.01" step="0.01" required placeholder="0"></div>
    <div class="field field-full"><label for="stock-note">Catatan</label><input id="stock-note" name="note" required maxlength="120" placeholder="Contoh: Pembelian bahan, barang rusak"></div></div>
    <div class="dialog-actions"><button type="button" class="button button-secondary" data-action="close-dialog">Batal</button><button class="button button-primary" type="submit">Simpan perubahan</button></div></form>`);
}

function saleLineMarkup() {
  const available = state.products.filter((product) => product.stock > 0);
  const options = available.map((product) => `<option value="${product.id}" data-price="${product.sale_price}" data-stock="${product.stock}" data-unit="${escapeHtml(product.unit)}">${escapeHtml(product.name)} · sisa ${quantity(product.stock)} ${escapeHtml(product.unit)}</option>`).join('');
  return `<div class="sale-line"><div class="field"><label>Barang</label><select name="product_id" required ${available.length ? '' : 'disabled'}>${options || '<option value="">Stok kosong</option>'}</select></div>
    <div class="field"><label>Jumlah</label><input name="quantity" type="number" min="0.01" step="0.01" value="1" required></div>
    <div class="field"><label>Harga / unit</label><input name="unit_price" type="number" min="0" step="500" value="${available[0]?.sale_price || 0}" required></div>
    <button class="remove-line" type="button" data-action="remove-sale-line" aria-label="Hapus barang">${icon('close')}</button></div>`;
}

function openSaleForm() {
  const hasStock = state.products.some((product) => product.stock > 0);
  modal('Catat penjualan', 'Stok akan berkurang dan HPP tercatat otomatis saat disimpan.', `<form id="sale-form" class="dialog-body">
    <div class="form-grid"><div class="field"><label for="sale-customer">Nama pelanggan</label><input id="sale-customer" name="customer" required maxlength="100" placeholder="Nama pelanggan / usaha"></div>
    <div class="field"><label for="sale-method">Metode pembayaran</label><select id="sale-method" name="payment_method"><option>Transfer</option><option>Tunai</option><option>QRIS</option><option>Lainnya</option></select></div>
    <div class="field field-full"><label for="sale-note">Catatan pesanan</label><input id="sale-note" name="note" maxlength="200" placeholder="Contoh: pesanan sablon desain khusus"></div></div>
    <div><div class="panel-header" style="padding:0 0 9px"><h2>Barang dipesan</h2><button class="panel-link" type="button" data-action="add-sale-line">${icon('plus')} Tambah barang</button></div><div id="sale-lines" class="sale-lines">${hasStock ? saleLineMarkup() : '<div class="empty-state">Belum ada stok yang dapat dijual. Tambahkan stok terlebih dahulu.</div>'}</div></div>
    <div class="sale-total"><span>Total pesanan</span><strong id="sale-total">${money(0)}</strong></div>
    <div class="form-grid"><div class="field field-full"><label for="sale-payment">Pembayaran diterima (Rp)</label><input id="sale-payment" name="initial_payment" type="number" min="0" step="1" value="0" required><small>Isi nominal DP atau pembayaran penuh. Kosongkan sebagai 0 untuk mencatat piutang.</small></div></div>
    <div class="dialog-actions"><button type="button" class="button button-secondary" data-action="close-dialog">Batal</button><button class="button button-primary" type="submit" ${hasStock ? '' : 'disabled'}>Simpan penjualan</button></div></form>`);
  updateSaleTotal();
}

function updateSaleTotal() {
  const lines = dialog.querySelectorAll('.sale-line');
  const total = [...lines].reduce((sum, line) => sum + (Number(line.querySelector('[name="quantity"]').value) || 0) * (Number(line.querySelector('[name="unit_price"]').value) || 0), 0);
  const target = dialog.querySelector('#sale-total');
  if (target) target.textContent = money(total);
}

async function openSaleDetail(idOrInvoice) {
  const sale = await api(`/api/sales/${encodeURIComponent(idOrInvoice)}`);
  const items = sale.items.map((item) => `<tr><td>${escapeHtml(item.product_name)}<span class="secondary-line">${quantity(item.quantity)} x ${money(item.unit_price)}</span></td><td class="numeric">${money(item.subtotal)}</td></tr>`).join('');
  const paymentHistory = sale.payments.length ? sale.payments.map((payment) => `<div class="stock-item"><span>${escapeHtml(payment.method)}<span class="secondary-line">${dateTime(payment.paid_at)}</span></span><strong class="numeric">${money(payment.amount)}</strong></div>`).join('') : '<div class="empty-state">Belum ada pembayaran tercatat.</div>';
  const paymentForm = sale.remaining > 0 ? `<form id="payment-form" class="dialog-body" data-sale-id="${sale.id}"><div class="form-grid"><div class="field"><label for="payment-amount">Pembayaran berikutnya (Rp)</label><input id="payment-amount" name="amount" type="number" min="1" max="${sale.remaining}" step="1" required value="${sale.remaining}"></div><div class="field"><label for="payment-method">Metode</label><select id="payment-method" name="method"><option>Transfer</option><option>Tunai</option><option>QRIS</option><option>Lainnya</option></select></div></div><div class="dialog-actions"><button class="button button-primary" type="submit">Catat pembayaran</button></div></form>` : '';
  modal(escapeHtml(sale.invoice), `${escapeHtml(sale.customer)} · ${dateTime(sale.sold_at)}`, `<div class="dialog-body"><div class="detail-facts"><div class="detail-fact"><span>Total pesanan</span><strong>${money(sale.total)}</strong></div><div class="detail-fact"><span>Status</span>${statusBadge(sale.status)}</div><div class="detail-fact"><span>Sudah dibayar</span><strong>${money(sale.paid)}</strong></div><div class="detail-fact"><span>Sisa tagihan</span><strong>${money(sale.remaining)}</strong></div></div>
    ${sale.note ? `<p class="muted" style="margin:0;font-size:10px">${escapeHtml(sale.note)}</p>` : ''}<section><div class="panel-header" style="padding:0 0 8px"><h2>Rincian barang</h2></div><div class="table-wrap"><table><tbody>${items}<tr><td><strong>HPP tercatat</strong><span class="secondary-line">Biaya barang saat penjualan</span></td><td class="numeric"><strong>${money(sale.cogs)}</strong></td></tr></tbody></table></div></section>
    <section><div class="panel-header" style="padding:0 0 8px"><h2>Riwayat pembayaran</h2></div><div class="panel">${paymentHistory}</div></section></div>${paymentForm}`);
}

function notify(message, isError = false) {
  const toast = document.createElement('div');
  toast.className = `toast${isError ? ' is-error' : ''}`;
  toast.textContent = message;
  toastRegion.append(toast);
  window.setTimeout(() => toast.remove(), 3600);
}

async function submitForm(form) {
  const submitButton = form.querySelector('[type="submit"]');
  submitButton.disabled = true;
  try {
    if (form.id === 'product-form') {
      const values = Object.fromEntries(new FormData(form));
      for (const key of ['stock', 'min_stock', 'cost_price', 'sale_price']) values[key] = Number(values[key]);
      await api('/api/products', { method: 'POST', body: JSON.stringify(values) });
      notify('Barang berhasil ditambahkan.');
      state.view = 'inventory';
      state.search = '';
    } else if (form.id === 'stock-form') {
      const values = Object.fromEntries(new FormData(form));
      const adjustment = Number(values.quantity) * (values.direction === 'subtract' ? -1 : 1);
      await api('/api/stock-adjustments', { method: 'POST', body: JSON.stringify({ product_id: Number(form.dataset.productId), quantity_delta: adjustment, note: values.note }) });
      notify('Perubahan stok berhasil dicatat.');
      state.view = 'inventory';
    } else if (form.id === 'sale-form') {
      const lines = [...form.querySelectorAll('.sale-line')].map((line) => ({
        product_id: Number(line.querySelector('[name="product_id"]').value),
        quantity: Number(line.querySelector('[name="quantity"]').value),
        unit_price: Number(line.querySelector('[name="unit_price"]').value),
      }));
      const values = Object.fromEntries(new FormData(form));
      await api('/api/sales', { method: 'POST', body: JSON.stringify({ customer: values.customer, note: values.note, items: lines, initial_payment: Number(values.initial_payment), payment_method: values.payment_method }) });
      notify('Penjualan tersimpan; stok dan HPP telah diperbarui.');
      state.view = 'sales';
    } else if (form.id === 'payment-form') {
      const values = Object.fromEntries(new FormData(form));
      await api(`/api/sales/${form.dataset.saleId}/payments`, { method: 'POST', body: JSON.stringify({ amount: Number(values.amount), method: values.method }) });
      notify('Pembayaran berhasil dicatat.');
      await refreshData();
      await openSaleDetail(form.dataset.saleId);
      return;
    }
    dialog.close();
    await refreshData();
  } catch (error) {
    notify(error.message, true);
    submitButton.disabled = false;
  }
}

document.addEventListener('click', async (event) => {
  const nav = event.target.closest('[data-view]');
  if (nav) return setView(nav.dataset.view);
  const filter = event.target.closest('[data-filter]');
  if (filter) {
    state.filter = filter.dataset.filter;
    return render();
  }
  const action = event.target.closest('[data-action]');
  if (!action) return;
  try {
    switch (action.dataset.action) {
      case 'create-product': openProductForm(); break;
      case 'create-sale': openSaleForm(); break;
      case 'update-stock': openStockForm(Number(action.dataset.id)); break;
      case 'view-sales': setView('sales'); break;
      case 'view-inventory': setView('inventory'); break;
      case 'sale-detail': await openSaleDetail(action.dataset.id); break;
      case 'close-dialog': dialog.close(); break;
      case 'add-sale-line': document.getElementById('sale-lines').insertAdjacentHTML('beforeend', saleLineMarkup()); break;
      case 'remove-sale-line':
        if (dialog.querySelectorAll('.sale-line').length > 1) action.closest('.sale-line').remove();
        updateSaleTotal();
        break;
      case 'retry': await refreshData(); break;
    }
  } catch (error) {
    notify(error.message, true);
  }
});

document.addEventListener('submit', (event) => {
  const form = event.target.closest('#product-form, #stock-form, #sale-form, #payment-form');
  if (!form) return;
  event.preventDefault();
  submitForm(form);
});

document.addEventListener('input', (event) => {
  if (event.target.id === 'product-search') {
    state.search = event.target.value;
    const start = event.target.selectionStart;
    render();
    const replacement = document.getElementById('product-search');
    replacement.focus();
    replacement.setSelectionRange(start, start);
  }
  if (event.target.closest('#sale-form')) updateSaleTotal();
});

document.addEventListener('change', (event) => {
  if (event.target.matches('.sale-line select[name="product_id"]')) {
    const option = event.target.selectedOptions[0];
    event.target.closest('.sale-line').querySelector('[name="unit_price"]').value = option?.dataset.price || 0;
    updateSaleTotal();
  }
});

dialog.addEventListener('click', (event) => {
  if (event.target === dialog) dialog.close();
});

document.getElementById('today-label').textContent = new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
refreshData().catch((error) => {
  content.innerHTML = `<div class="loading-state"><p>${escapeHtml(error.message)}</p><button class="button button-secondary" data-action="retry">Coba lagi</button></div>`;
});