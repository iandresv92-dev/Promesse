const API_URL = '';
let token = localStorage.getItem('token');
let html5QrCode = null;

// Screens
const loginScreen = document.getElementById('login-screen');
const appScreen = document.getElementById('app-screen');

// Initialize
if (token) {
    showApp();
}

// Utility: Debounce for search inputs
function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

// Login
document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const u = document.getElementById('username').value;
    const p = document.getElementById('password').value;
    
    const formData = new URLSearchParams();
    formData.append('username', u);
    formData.append('password', p);

    try {
        const res = await fetch(`${API_URL}/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: formData
        });
        if (res.ok) {
            const data = await res.json();
            token = data.access_token;
            localStorage.setItem('token', token);
            showApp();
        } else {
            document.getElementById('login-error').classList.remove('hidden');
        }
    } catch (err) {
        console.error(err);
    }
});

document.getElementById('logout-btn').addEventListener('click', () => {
    localStorage.removeItem('token');
    token = null;
    appScreen.classList.add('hidden');
    appScreen.classList.remove('active');
    loginScreen.classList.add('active');
    loginScreen.classList.remove('hidden');
});

function showApp() {
    loginScreen.classList.add('hidden');
    loginScreen.classList.remove('active');
    appScreen.classList.add('active');
    appScreen.classList.remove('hidden');
    loadDashboard();
}

// Navigation
document.querySelectorAll('.nav-links li').forEach(li => {
    li.addEventListener('click', () => {
        // mobile menu close FIRST so that visual transition is instant and permissions popup behaves correctly
        document.querySelector('.sidebar').classList.remove('open');

        document.querySelectorAll('.nav-links li').forEach(l => l.classList.remove('active'));
        li.classList.add('active');
        
        const view = li.getAttribute('data-view');
        const navText = li.querySelector('.nav-text') ? li.querySelector('.nav-text').innerText : li.innerText;
        document.getElementById('view-title').innerText = navText;
        
        document.querySelectorAll('.view').forEach(v => {
            v.classList.add('hidden');
            v.classList.remove('active');
        });
        document.getElementById(`view-${view}`).classList.remove('hidden');
        document.getElementById(`view-${view}`).classList.add('active');
        
        // Load data based on view
        if (view === 'dashboard') {
            loadDashboard();
            stopScanner();
        } else if (view === 'products') {
            loadProducts();
            stopScanner();
        } else if (view === 'ingresos') {
            loadIngresos();
            stopScanner();
        } else if (view === 'insumos') {
            loadInsumos();
            stopScanner();
        } else if (view === 'orders') {
            loadOrders();
            stopScanner();
        } else if (view === 'ventas-live') {
            loadVentasLive();
            stopScanner();
        } else if (view === 'reporteria') {
            stopScanner();
            // Reportería doesn't auto-load — user picks dates first
        } else if (view === 'scanner') {
            stopScanner();
        } else if (view === 'close') {
            loadBankCloses();
            stopScanner();
        }
    });
});

document.getElementById('mobile-menu-btn').addEventListener('click', () => {
    document.querySelector('.sidebar').classList.toggle('open');
});

document.getElementById('mobile-logout-btn').addEventListener('click', () => {
    document.getElementById('logout-btn').click();
});

// Auth Fetch Helper
async function apiFetch(endpoint, options = {}) {
    if (!options.headers) options.headers = {};
    options.headers['Authorization'] = `Bearer ${token}`;
    if (!options.headers['Content-Type']) {
        options.headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(`${API_URL}${endpoint}`, options);
    if (res.status === 401) {
        document.getElementById('logout-btn').click();
        return null;
    }
    return res;
}

// Dashboard
async function loadDashboard() {
    const res = await apiFetch('/dashboard');
    if (res && res.ok) {
        const data = await res.json();
        
        // Load bank close preview for Saldo Esperado
        const bcRes = await apiFetch('/bank-close/preview');
        if (bcRes && bcRes.ok) {
            const bcData = await bcRes.json();
            
            if (bcData.efectivo) {
                document.getElementById('metric-saldo-esperado-efectivo').innerText = `$${Math.round(bcData.efectivo.saldo_esperado).toLocaleString('es-CL')}`;
            }
            if (bcData.tarjeta) {
                document.getElementById('metric-saldo-esperado-tarjeta').innerText = `$${Math.round(bcData.tarjeta.saldo_esperado).toLocaleString('es-CL')}`;
            }
            
            // Highlight diff
            const bcLabelEfectivo = document.getElementById('metric-saldo-diff-label-efectivo');
            const bcLabelTarjeta = document.getElementById('metric-saldo-diff-label-tarjeta');
            if (!bcData.has_initial) {
                bcLabelEfectivo.innerText = "Requiere configurar Saldo Inicial";
                bcLabelEfectivo.style.color = "var(--warning)";
                bcLabelTarjeta.innerText = "Requiere configurar Saldo Inicial";
                bcLabelTarjeta.style.color = "var(--warning)";
            } else {
                bcLabelEfectivo.innerText = "Basado en transacciones marcadas";
                bcLabelEfectivo.style.color = "var(--text-secondary)";
                bcLabelTarjeta.innerText = "Basado en transacciones marcadas";
                bcLabelTarjeta.style.color = "var(--text-secondary)";
            }
        }
        
        // Status phase counters (v2.0)
        document.getElementById('metric-recibido').innerText = data.orders_recibido ? data.orders_recibido.length : 0;
        document.getElementById('metric-en-preparacion').innerText = data.orders_en_preparacion ? data.orders_en_preparacion.length : 0;
        document.getElementById('metric-preparado').innerText = data.orders_preparado ? data.orders_preparado.length : 0;
        document.getElementById('metric-despachado').innerText = data.orders_despachado ? data.orders_despachado.length : 0;
        document.getElementById('metric-por-pagar').innerText = data.orders_por_pagar ? data.orders_por_pagar.length : 0;
        document.getElementById('metric-pagado').innerText = data.orders_pagado ? data.orders_pagado.length : 0;
        document.getElementById('metric-finalizado').innerText = data.orders_finalizado ? data.orders_finalizado.length : 0;
        document.getElementById('metric-cancelado').innerText = data.orders_cancelado ? data.orders_cancelado.length : 0;
        
        // Ventas Live Pendientes
        if(document.getElementById('metric-live-pendientes')) {
            document.getElementById('metric-live-pendientes').innerText = data.ventas_live_pendientes ? data.ventas_live_pendientes.length : 0;
            document.getElementById('metric-total-live-pendientes').innerText = `$${Math.round(data.total_live_pendientes || 0).toLocaleString('es-CL')}`;
        }

        // Store dashboard data for modal usage
        window._dashboardData = data;
    }
}

// Dashboard orders detail modal
function showDashboardOrdersModal(phase) {
    const data = window._dashboardData;
    if (!data) return;
    
    const phaseConfig = {
        recibido: { title: '📥 Pedidos Recibidos', orders: data.orders_recibido || [], nextStatus: 'En Preparación', nextLabel: 'A Preparación 🔧', color: '#3b82f6' },
        en_preparacion: { title: '🔧 Pedidos En Preparación', orders: data.orders_en_preparacion || [], nextStatus: 'Preparado', nextLabel: 'Marcar Preparado 📦', color: '#f97316' },
        preparado: { title: '📦 Pedidos Preparados', orders: data.orders_preparado || [], nextStatus: 'Despachado', nextLabel: 'Marcar Despachado ✅', color: '#eab308' },
        despachado: { title: '✅ Pedidos Despachados', orders: data.orders_despachado || [], nextStatus: 'Pagado', nextLabel: 'Registrar Pago 💳', altStatus: 'Por Pagar', altLabel: 'Marcar Por Pagar ⏳', color: '#14b8a6' },
        por_pagar: { title: '⏳ Pedidos Por Pagar', orders: data.orders_por_pagar || [], nextStatus: 'Pagado', nextLabel: 'Registrar Pago 💳', color: '#ef4444' },
        pagado: { title: '💳 Pedidos Pagados', orders: data.orders_pagado || [], nextStatus: 'Finalizado', nextLabel: 'Finalizar ✨', color: '#8b5cf6' },
        finalizado: { title: '✨ Pedidos Finalizados', orders: data.orders_finalizado || [], nextStatus: null, nextLabel: '', color: '#c89680' },
        cancelado: { title: '❌ Pedidos Cancelados', orders: data.orders_cancelado || [], nextStatus: null, nextLabel: '', color: '#9ca3af' },
        ventas_live: { title: '⚡ Ventas Live Pendientes', orders: data.ventas_live_pendientes || [], nextStatus: 'Pagado', nextLabel: 'Registrar Pago 💳', color: '#8b5cf6' }
    };
    
    const cfg = phaseConfig[phase];
    if(!cfg) return;

    document.getElementById('dashboard-modal-title').innerHTML = cfg.title;
    const body = document.getElementById('dashboard-modal-body');
    
    if (cfg.orders.length === 0) {
        body.innerHTML = `<div style="text-align: center; padding: 2rem; color: var(--text-secondary);"><i class="fa-solid fa-check-circle" style="font-size: 2rem; margin-bottom: 1rem; color: var(--success); display: block;"></i>No hay pedidos en esta etapa.</div>`;
    } else {
        body.innerHTML = cfg.orders.map(o => {
            const date = new Date(o.created_at).toLocaleDateString('es-CL');
            let nextStatus = cfg.nextStatus;
            let nextLabel = cfg.nextLabel;
            
            const pdfBtn = `<button class="btn outline-btn" style="padding: 0.4rem 0.8rem; font-size: 0.8rem; width: auto; margin-top: 0.5rem; margin-right: 0.5rem;" onclick="showReceiptModal(${o.id})"><i class="fa-solid fa-receipt"></i> Ver Boleta</button>`;
            
            // Segundo botón opcional (ej. Despachado -> Por Pagar, sin pedir medio de pago)
            const altBtn = cfg.altStatus
                ? `<button class="btn outline-btn" style="padding: 0.4rem 0.8rem; font-size: 0.8rem; width: auto; margin-top: 0.5rem; margin-left: 0.5rem;" onclick="quickAdvanceOrder(${o.id}, '${cfg.altStatus}')">${cfg.altLabel}</button>`
                : '';
            
            const actionBtn = nextStatus
                ? ((nextStatus === 'Pagado' || nextStatus === 'Finalizado')
                    ? `${pdfBtn}<button class="btn primary-btn" style="padding: 0.4rem 0.8rem; font-size: 0.8rem; width: auto; margin-top: 0.5rem;" onclick="quickPayOrder(${o.id}, '${nextStatus}')">${nextLabel}</button>${altBtn}`
                    : `${pdfBtn}<button class="btn primary-btn" style="padding: 0.4rem 0.8rem; font-size: 0.8rem; width: auto; margin-top: 0.5rem;" onclick="quickAdvanceOrder(${o.id}, '${nextStatus}')">${nextLabel}</button>`)
                : pdfBtn;
            
            return `
                <div style="background: var(--bg-color); border: 1px solid var(--border-color); border-left: 3px solid ${cfg.color}; border-radius: 8px; padding: 1rem; margin-bottom: 0.8rem;">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 0.5rem;">
                        <div>
                            <span style="font-weight: 700; font-size: 0.95rem;">#${o.id} — ${o.customer_name || 'Sin nombre'}</span><br>
                            <span style="color: var(--text-secondary); font-size: 0.85rem;">${date} · ${o.items_summary}</span>
                        </div>
                        <div style="text-align: right;">
                            <span style="font-weight: 700; color: var(--primary-color); font-size: 1rem;">$${Math.round(o.total).toLocaleString('es-CL')}</span><br>
                            <span style="font-size: 0.8rem; color: var(--text-secondary);">${o.status}</span>
                        </div>
                    </div>
                    ${actionBtn}
                </div>
            `;
        }).join('');
    }
    
    document.getElementById('modal-backdrop').classList.remove('hidden');
    document.getElementById('dashboard-orders-modal').classList.remove('hidden');
}
window.showDashboardOrdersModal = showDashboardOrdersModal;

// Quick advance order to next status (no payment method needed)
async function quickAdvanceOrder(orderId, newStatus) {
    const res = await apiFetch(`/orders/${orderId}/status?status=${encodeURIComponent(newStatus)}`, { method: 'PUT' });
    if (res && res.ok) {
        closeModals();
        loadDashboard();
        loadVentasLive();
        if (document.getElementById('view-orders').classList.contains('active')) {
            loadOrders();
        }
    }
}
window.quickAdvanceOrder = quickAdvanceOrder;

// Quick pay order: shows inline payment method selection
function quickPayOrder(orderId, nextStatus = 'Pagado') {
    const body = document.getElementById('dashboard-modal-body');
    body.innerHTML = `
        <div style="background: var(--bg-color); border: 1px solid var(--border-color); border-radius: 8px; padding: 1.5rem;">
            <h4 style="margin-bottom: 1rem; color: var(--primary-color);">Confirmar Medio de Pago — Pedido #${orderId}</h4>
            <p style="margin-bottom: 1rem; color: var(--text-secondary);">El pedido avanzará a estado: <strong>${nextStatus}</strong></p>
            <div class="input-group">
                <label>Medio de Pago</label>
                <select id="quick-pay-method">
                    <option value="Efectivo">Efectivo</option>
                    <option value="Transferencia">Transferencia</option>
                    <option value="Tarjeta">Tarjeta</option>
                </select>
            </div>
            <div style="display: flex; gap: 0.8rem; margin-top: 1rem;">
                <button class="btn outline-btn" style="width: auto;" onclick="closeModals()">Cancelar</button>
                <button class="btn primary-btn" style="flex: 1;" onclick="confirmQuickPay(${orderId}, '${nextStatus}')">✅ Confirmar y Avanzar</button>
            </div>
        </div>
    `;
}
window.quickPayOrder = quickPayOrder;

async function confirmQuickPay(orderId, nextStatus) {
    const method = document.getElementById('quick-pay-method').value;
    const res = await apiFetch(`/orders/${orderId}/status?status=${encodeURIComponent(nextStatus)}&payment_method=${encodeURIComponent(method)}`, { method: 'PUT' });
    if (res && res.ok) {
        closeModals();
        loadDashboard();
        loadVentasLive();
        if (document.getElementById('view-orders').classList.contains('active')) {
            loadOrders();
        }
    }
}
window.confirmQuickPay = confirmQuickPay;

// Products
let allProducts = [];
let currentProductPage = 1;
let currentProductFilter = 'all';

async function loadProducts() {
    const queryInput = document.getElementById('search-product');
    const searchQuery = queryInput ? queryInput.value.trim() : '';
    
    let url = `/products?page=${currentProductPage}&limit=20`;
    if (currentProductFilter !== 'all') {
        url += `&stock_filter=${currentProductFilter}`;
    }
    if (searchQuery) {
        url += `&search=${encodeURIComponent(searchQuery)}`;
    }
    
    const res = await apiFetch(url);
    if (res && res.ok) {
        const data = await res.json();
        allProducts = data.items;
        renderProducts(allProducts);
        const pageLabel = document.getElementById('product-page-label');
        if (pageLabel) pageLabel.innerText = `Página ${currentProductPage} (${data.total_pages})`;
        window._totalProductPages = data.total_pages;
    }
}

function nextProductPage() {
    if (window._totalProductPages && currentProductPage >= window._totalProductPages) return;
    currentProductPage++;
    loadProducts();
}
window.nextProductPage = nextProductPage;

function prevProductPage() {
    if (currentProductPage > 1) {
        currentProductPage--;
        loadProducts();
    }
}
window.prevProductPage = prevProductPage;

function setProductFilter(filter) {
    currentProductFilter = filter;
    currentProductPage = 1;
    document.querySelectorAll('#view-products .tabs-container button').forEach(b => {
        b.classList.remove('active');
        b.classList.add('outline-btn');
    });
    
    let activeBtn = document.getElementById(`tab-products-${filter === 'all' ? 'all' : (filter === 'con_stock' ? 'con' : 'sin')}`);
    if (activeBtn) {
        activeBtn.classList.remove('outline-btn');
        activeBtn.classList.add('active');
    }
    
    loadProducts();
}

function renderProducts(products) {
    const tbody = document.querySelector('#products-table tbody');
    tbody.innerHTML = '';
    products.forEach(p => {
        const photoUrl = p.image_url || `/static/photos/${p.sku}.jpg`;
        const costVal = p.cost ? `$${p.cost.toLocaleString('es-CL')}` : '-';
        
        tbody.innerHTML += `
            <tr>
                <td>
                    <img src="${photoUrl}" onerror="this.src='https://placehold.co/60x60/FAF4F0/C89680?text=Promesse'" style="width: 50px; height: 50px; border-radius: 6px; object-fit: cover; border: 1px solid var(--border-color); cursor: pointer;" alt="foto" onclick="zoomImage(this.src)">
                </td>
                <td><strong>${p.sku || '-'}</strong></td>
                <td>${p.name}</td>
                <td>${p.provider || '-'}</td>
                <td>$${p.price.toLocaleString('es-CL')}</td>
                <td>${costVal}</td>
                <td>${p.stock}</td>
                <td>
                    <div style="display:flex; gap:0.5rem;">
                        <button class="btn outline-btn" style="padding:0.3rem 0.6rem; font-size:0.8rem; width: auto;" onclick="showEditProduct(${p.id})"><i class="fa-solid fa-edit"></i> Editar</button>
                        <button class="btn outline-btn" style="padding:0.3rem 0.6rem; font-size:0.8rem; width: auto; color:var(--warning); border-color:rgba(239,68,68,0.2);" onclick="deleteProduct(${p.id})"><i class="fa-solid fa-trash"></i> Borrar</button>
                    </div>
                </td>
            </tr>
        `;
    });
}

// Edit Product functions
function showEditProduct(id) {
    const p = allProducts.find(prod => prod.id === id);
    if (!p) return;
    
    document.getElementById('prod-edit-id').value = p.id;
    document.getElementById('prod-edit-name').value = p.name;
    document.getElementById('prod-edit-sku').value = p.sku || '';
    document.getElementById('prod-edit-provider').value = p.provider || '';
    document.getElementById('prod-edit-price').value = p.price;
    document.getElementById('prod-edit-cost').value = p.cost || 0;
    document.getElementById('prod-edit-stock').value = p.stock || 0;
    
    // Photo preview
    document.getElementById('prod-edit-photo-file').value = '';
    document.getElementById('prod-edit-photo-url').value = p.image_url || '';
    const preview = document.getElementById('prod-edit-photo-preview');
    const container = document.getElementById('prod-edit-photo-preview-container');
    if (p.image_url) {
        preview.src = p.image_url;
        container.classList.remove('hidden');
    } else {
        preview.src = '';
        container.classList.add('hidden');
    }
    
    document.getElementById('modal-backdrop').classList.remove('hidden');
    document.getElementById('product-modal').classList.remove('hidden');
}

async function saveProductEdit() {
    const id = document.getElementById('prod-edit-id').value;
    
    // Upload image first if selected
    const photoFileInput = document.getElementById('prod-edit-photo-file');
    let photoUrl = document.getElementById('prod-edit-photo-url').value || null;
    if (photoFileInput.files.length > 0) {
        const uploadedUrl = await uploadPhoto(photoFileInput);
        if (uploadedUrl) {
            photoUrl = uploadedUrl;
        }
    }
    
    const prod = {
        name: document.getElementById('prod-edit-name').value,
        sku: document.getElementById('prod-edit-sku').value,
        provider: document.getElementById('prod-edit-provider').value || null,
        price: parseFloat(document.getElementById('prod-edit-price').value),
        cost: parseFloat(document.getElementById('prod-edit-cost').value),
        stock: parseInt(document.getElementById('prod-edit-stock').value),
        image_url: photoUrl
    };
    
    const res = await apiFetch(`/products/${id}`, {
        method: 'PUT',
        body: JSON.stringify(prod)
    });
    if (res && res.ok) {
        closeModals();
        loadProducts();
        loadDashboard();
    }
}

async function deleteProduct(id) {
    if (!confirm('¿Estás seguro de que deseas eliminar este producto de la bodega permanentemente?')) return;
    
    const res = await apiFetch(`/products/${id}`, {
        method: 'DELETE'
    });
    if (res && res.ok) {
        loadProducts();
        loadDashboard();
    }
}

// Search Product filter
// Setup product search listener for POS
const debouncedFilterPOSProducts = debounce((e) => filterPOSProducts(e.target.value), 300);
document.getElementById('order-search-prod').addEventListener('input', debouncedFilterPOSProducts);

document.getElementById('search-product').addEventListener('input', debounce((e) => {
    currentProductPage = 1;
    loadProducts();
}, 300));

// Cost pricing factorization
function calculateSuggestedPrice(costValue) {
    const cost = parseFloat(costValue);
    if (isNaN(cost) || cost <= 0) {
        document.getElementById('ing-suggested').value = '';
        return;
    }
    let factor = 1.8;
    if (cost < 500) factor = 3.0;
    else if (cost < 1000) factor = 2.5;
    else if (cost < 5000) factor = 2.2;
    else if (cost < 20000) factor = 2.0;
    
    const suggested = Math.round(cost * factor);
    document.getElementById('ing-suggested').value = suggested;
    document.getElementById('ing-price').value = suggested;
}

async function fetchProductBySku(sku) {
    if (!sku) return;
    try {
        const res = await apiFetch(`/products/${sku}`);
        if (res && res.ok) {
            const prod = await res.json();
            document.getElementById('ing-provider').value = prod.provider || '';
            document.getElementById('ing-name').value = prod.name;
            document.getElementById('ing-cost').value = prod.cost;
            document.getElementById('ing-price').value = prod.price;
            calculateSuggestedPrice(prod.cost);
        }
    } catch (e) {
        console.error(e);
    }
}

// Toggle include_in_close
async function toggleClose(type, id) {
    const res = await apiFetch(`/${type}/${id}/toggle-close`, { method: 'PATCH' });
    if (res && res.ok) {
        if (type === 'orders') {
            loadOrders();
            loadVentasLive();
        }
        else if (type === 'insumos') loadInsumos();
        else if (type === 'ingresos') loadIngresos();
        loadDashboard();
    }
}
window.toggleClose = toggleClose;

async function deleteIngreso(id) {
    if (!confirm('¿Estás seguro de que deseas eliminar este registro de ingreso? Esto restará el stock de la bodega.')) return;
    const res = await apiFetch(`/ingresos/${id}`, { method: 'DELETE' });
    if (res && res.ok) {
        loadIngresos();
        loadProducts();
        loadDashboard();
    }
}
window.deleteIngreso = deleteIngreso;

// Ingresos View
let allIngresos = [];
let currentIngresoPage = 1;
let currentIngresoStatus = 'all';

async function loadIngresos() {
    const searchInput = document.getElementById('search-ingresos');
    const searchQuery = searchInput ? searchInput.value.trim() : '';
    
    let url = `/ingresos?page=${currentIngresoPage}&limit=20&status=${currentIngresoStatus}`;
    const dFrom = document.getElementById('filter-ingreso-from').value;
    const dTo = document.getElementById('filter-ingreso-to').value;
    const period = document.getElementById('filter-ingreso-period').value;

    if (dFrom) url += `&date_from=${dFrom}`;
    if (dTo) url += `&date_to=${dTo}`;
    if (currentIngresoStatus === 'contabilizados' && period) url += `&period=${period}`;
    if (searchQuery) url += `&search=${encodeURIComponent(searchQuery)}`;
    
    const res = await apiFetch(url);
    if (res && res.ok) {
        const data = await res.json();
        allIngresos = data.items;
        renderIngresos(allIngresos);
        // Update page label if it exists (check for ID to avoid errors)
        const pageLabel = document.getElementById('ingreso-page-label');
        if (pageLabel) pageLabel.innerText = `Página ${currentIngresoPage} (${data.total_pages})`;
        window._totalIngresoPages = data.total_pages;
    }
}

function nextIngresoPage() {
    if (window._totalIngresoPages && currentIngresoPage >= window._totalIngresoPages) return;
    currentIngresoPage++;
    loadIngresos();
}
window.nextIngresoPage = nextIngresoPage;

function prevIngresoPage() {
    if (currentIngresoPage > 1) {
        currentIngresoPage--;
        loadIngresos();
    }
}
window.prevIngresoPage = prevIngresoPage;

function setIngresoFilter(status) {
    currentIngresoStatus = status;
    currentIngresoPage = 1;
    
    document.querySelectorAll('#view-ingresos .tabs-container button').forEach(b => {
        b.classList.remove('active');
        b.classList.add('outline-btn');
    });
    
    const activeBtn = document.getElementById(`tab-ingresos-${status}`);
    if (activeBtn) {
        activeBtn.classList.remove('outline-btn');
        activeBtn.classList.add('active');
    }
    
    const extraFilters = document.getElementById('ingresos-contabilizados-extra-filters');
    if (status === 'contabilizados') {
        extraFilters.classList.remove('hidden');
    } else {
        extraFilters.classList.add('hidden');
    }
    
    loadIngresos();
}
window.setIngresoFilter = setIngresoFilter;

function fetchIngresos() {
    currentIngresoPage = 1;
    loadIngresos();
}
window.fetchIngresos = fetchIngresos;

function renderIngresos(ingresos) {
    const tbody = document.querySelector('#ingresos-table tbody');
    tbody.innerHTML = '';
        ingresos.forEach(i => {
            const prod = allProducts.find(p => p.sku === i.sku);
            const photoUrl = prod ? (prod.image_url || '') : '';
            const imgHtml = photoUrl 
                ? `<img src="${photoUrl}" style="width: 50px; height: 50px; border-radius: 6px; object-fit: cover; border: 1px solid var(--border-color); cursor: pointer;" alt="foto" onclick="zoomImage(this.src)">` 
                : `<div style="width: 50px; height: 50px; border-radius: 6px; background: rgba(197, 168, 128, 0.1); border: 1px dashed var(--border-color); display: flex; align-items: center; justify-content: center; color: var(--text-secondary); font-size: 0.8rem;"><i class="fa-solid fa-image"></i></div>`;
                
            tbody.innerHTML += `
                <tr>
                    <td>${imgHtml}</td>
                    <td><input type="checkbox" onchange="toggleClose('ingresos', ${i.id})" ${i.include_in_close ? 'checked' : ''} style="width: 20px; height: 20px; cursor: pointer; accent-color: var(--primary-color);"></td>
                    <td>${new Date(i.date).toLocaleDateString()}</td>
                    <td>${i.provider}</td>
                    <td><strong>${i.sku}</strong></td>
                    <td>${i.name}</td>
                    <td>$${i.cost.toLocaleString('es-CL')}</td>
                    <td><span class="status-badge" style="background: rgba(255,255,255,0.05); color: var(--text-primary); font-size: 0.75rem;">${i.payment_type || 'Efectivo'}</span></td>
                    <td>$${i.final_price.toLocaleString('es-CL')}</td>
                    <td>${i.quantity}</td>
                    <td>
                        <div style="display:flex; gap:0.5rem;">
                            <button class="btn outline-btn" style="padding:0.3rem 0.6rem; font-size:0.8rem; width: auto;" title="Editar" onclick="showEditIngreso(${i.id}, '${i.provider}', '${i.sku}', '${i.name.replace(/'/g, "\\'")}', ${i.cost}, ${i.final_price}, ${i.quantity}, '${i.payment_type || 'Efectivo'}')"><i class="fa-solid fa-edit"></i></button>
                            <button class="btn outline-btn" style="padding:0.3rem 0.6rem; font-size:0.8rem; width: auto; color:var(--warning); border-color:rgba(239,68,68,0.2);" title="Eliminar" onclick="deleteIngreso(${i.id})"><i class="fa-solid fa-trash"></i></button>
                        </div>
                    </td>
                </tr>
            `;
        });
}

function showAddIngresoModal() {
    document.getElementById('ingreso-modal-title').innerText = "Registrar Ingreso";
    document.getElementById('ing-id').value = '';
    
    document.getElementById('ing-provider').value = '';
    document.getElementById('ing-sku').value = '';
    document.getElementById('ing-name').value = '';
    document.getElementById('ing-cost').value = '';
    document.getElementById('ing-suggested').value = '';
    document.getElementById('ing-price').value = '';
    document.getElementById('ing-qty').value = '1';
    document.getElementById('ing-payment-type').value = 'Efectivo';
    
    // Photo preview reset
    document.getElementById('ing-photo-file').value = '';
    document.getElementById('ing-photo-url').value = '';
    document.getElementById('ing-photo-preview').src = '';
    document.getElementById('ing-photo-preview-container').classList.add('hidden');
    
    document.getElementById('modal-backdrop').classList.remove('hidden');
    document.getElementById('ingreso-modal').classList.remove('hidden');
}

function showEditIngreso(id, provider, sku, name, cost, price, quantity, paymentType) {
    document.getElementById('ingreso-modal-title').innerText = "Editar Ingreso";
    document.getElementById('ing-id').value = id;
    
    document.getElementById('ing-provider').value = provider;
    document.getElementById('ing-sku').value = sku;
    document.getElementById('ing-name').value = name;
    document.getElementById('ing-cost').value = cost;
    calculateSuggestedPrice(cost);
    document.getElementById('ing-price').value = price;
    document.getElementById('ing-qty').value = quantity;
    document.getElementById('ing-payment-type').value = paymentType || 'Efectivo';
    
    // Photo preview load based on existing product
    const prod = allProducts.find(p => p.sku === sku);
    document.getElementById('ing-photo-file').value = '';
    document.getElementById('ing-photo-url').value = prod ? (prod.image_url || '') : '';
    const preview = document.getElementById('ing-photo-preview');
    const container = document.getElementById('ing-photo-preview-container');
    if (prod && prod.image_url) {
        preview.src = prod.image_url;
        container.classList.remove('hidden');
    } else {
        preview.src = '';
        container.classList.add('hidden');
    }
    
    document.getElementById('modal-backdrop').classList.remove('hidden');
    document.getElementById('ingreso-modal').classList.remove('hidden');
}

async function saveIngreso() {
    const id = document.getElementById('ing-id').value;
    
    // Upload image first if selected
    const photoFileInput = document.getElementById('ing-photo-file');
    let photoUrl = document.getElementById('ing-photo-url').value || null;
    if (photoFileInput.files.length > 0) {
        const uploadedUrl = await uploadPhoto(photoFileInput);
        if (uploadedUrl) {
            photoUrl = uploadedUrl;
        }
    }
    
    const ingreso = {
        provider: document.getElementById('ing-provider').value,
        sku: document.getElementById('ing-sku').value,
        name: document.getElementById('ing-name').value,
        cost: parseFloat(document.getElementById('ing-cost').value),
        suggested_price: parseFloat(document.getElementById('ing-suggested').value || 0),
        final_price: parseFloat(document.getElementById('ing-price').value),
        quantity: parseInt(document.getElementById('ing-qty').value),
        payment_type: document.getElementById('ing-payment-type').value,
        image_url: photoUrl
    };
    
    let res;
    if (id) {
        // Edit existing ingress
        res = await apiFetch(`/ingresos/${id}`, {
            method: 'PUT',
            body: JSON.stringify(ingreso)
        });
    } else {
        // Create new ingress
        res = await apiFetch('/ingresos', {
            method: 'POST',
            body: JSON.stringify(ingreso)
        });
    }
    
    if (res && res.ok) {
        closeModals();
        loadIngresos();
        loadProducts();
        loadDashboard();
    }
}

// Insumos View
let currentInsumoFilter = 'pendientes';

async function loadInsumos() {
    let url = '/insumos';
    if (currentInsumoFilter === 'contabilizados') {
        url = '/insumos/contabilizados?';
        const p = document.getElementById('filter-insumo-period').value;
        const pt = document.getElementById('filter-insumo-payment').value;
        if (p) url += `period=${p}&`;
        if (pt) url += `payment_type=${pt}&`;
    }
    const res = await apiFetch(url);
    if (res && res.ok) {
        const insumos = await res.json();
        const tbody = document.querySelector('#insumos-table tbody');
        tbody.innerHTML = '';
        insumos.forEach(i => {
            tbody.innerHTML += `
                <tr>
                    <td><input type="checkbox" onchange="toggleClose('insumos', ${i.id})" ${i.include_in_close ? 'checked' : ''} style="width: 20px; height: 20px; cursor: pointer; accent-color: var(--primary-color);"></td>
                    <td>${new Date(i.date).toLocaleDateString()}</td>
                    <td>${i.sku ? `<small style="display:block; color:var(--primary-color); font-size:0.7rem;">${i.sku}</small>` : ''}${i.item}</td>
                    <td>$${i.cost.toLocaleString('es-CL')}</td>
                    <td><span class="status-badge" style="background: rgba(255,255,255,0.05); color: var(--text-primary); font-size: 0.75rem;">${i.payment_type || 'Efectivo'}</span></td>
                    <td>
                        <button class="btn outline-btn" style="padding:0.3rem 0.6rem; font-size:0.8rem; width: auto;" onclick="showEditInsumo(${i.id}, '${i.date.substring(0, 10)}', '${i.item.replace(/'/g, "\\'")}', ${i.cost}, '${i.sku || ''}')"><i class="fa-solid fa-edit"></i> Editar</button>
                    </td>
                </tr>
            `;
        });
    }
}

function setInsumoFilter(filter) {
    currentInsumoFilter = filter;
    document.getElementById('tab-insumos-pendientes').classList.remove('active', 'outline-btn');
    document.getElementById('tab-insumos-pendientes').classList.add('outline-btn');
    document.getElementById('tab-insumos-contabilizados').classList.remove('active', 'outline-btn');
    document.getElementById('tab-insumos-contabilizados').classList.add('outline-btn');
    
    document.getElementById(`tab-insumos-${filter}`).classList.remove('outline-btn');
    document.getElementById(`tab-insumos-${filter}`).classList.add('active');
    
    if (filter === 'contabilizados') {
        document.getElementById('insumos-contabilizados-filters').classList.remove('hidden');
    } else {
        document.getElementById('insumos-contabilizados-filters').classList.add('hidden');
    }
    
    loadInsumos();
}

// Search filter for Ingresos
const debouncedLoadIngresos = debounce(() => {
    currentIngresoPage = 1;
    loadIngresos();
}, 300);

document.addEventListener('input', e => {
    if (e.target && e.target.id === 'search-ingresos') {
        debouncedLoadIngresos();
    }
});

function showAddInsumoModal() {
    document.getElementById('insumo-modal-title').innerText = "Registrar Insumo";
    document.getElementById('ins-id').value = '';
    
    const today = new Date().toISOString().substring(0, 10);
    document.getElementById('ins-date').value = today;
    document.getElementById('ins-sku').value = '';
    document.getElementById('ins-item').value = '';
    document.getElementById('ins-cost').value = '';
    
    document.getElementById('modal-backdrop').classList.remove('hidden');
    document.getElementById('insumo-modal').classList.remove('hidden');
}

function showEditInsumo(id, date, item, cost, sku = '') {
    document.getElementById('insumo-modal-title').innerText = "Editar Insumo";
    document.getElementById('ins-id').value = id;
    
    document.getElementById('ins-date').value = date;
    document.getElementById('ins-sku').value = sku;
    document.getElementById('ins-item').value = item;
    document.getElementById('ins-cost').value = cost;
    
    document.getElementById('modal-backdrop').classList.remove('hidden');
    document.getElementById('insumo-modal').classList.remove('hidden');
}

async function fetchProductBySkuForInsumo(sku) {
    if (!sku) return;
    try {
        const res = await apiFetch(`/products/${sku}`);
        if (res && res.ok) {
            const prod = await res.json();
            document.getElementById('ins-item').value = prod.name;
            document.getElementById('ins-cost').value = prod.cost || 0;
        }
    } catch (e) {
        console.error(e);
    }
}
window.fetchProductBySkuForInsumo = fetchProductBySkuForInsumo;

async function saveInsumo() {
    const id = document.getElementById('ins-id').value;
    const insDate = document.getElementById('ins-date').value;
    let parsedDate = null;
    if (insDate) {
        parsedDate = new Date(insDate).toISOString();
    }
    
    const insumo = {
        item: document.getElementById('ins-item').value,
        sku: document.getElementById('ins-sku').value || null,
        cost: parseFloat(document.getElementById('ins-cost').value),
        payment_type: document.getElementById('ins-payment-type').value,
        date: parsedDate
    };
    
    let res;
    if (id) {
        res = await apiFetch(`/insumos/${id}`, {
            method: 'PUT',
            body: JSON.stringify(insumo)
        });
    } else {
        res = await apiFetch('/insumos', {
            method: 'POST',
            body: JSON.stringify(insumo)
        });
    }
    
    if (res && res.ok) {
        closeModals();
        loadInsumos();
        loadDashboard();
    }
}

// Pay VAT
function showPayVatModal() {
    document.getElementById('modal-backdrop').classList.remove('hidden');
    document.getElementById('vat-modal').classList.remove('hidden');
}

async function submitVatPayment() {
    const amount = parseFloat(document.getElementById('vat-amount').value);
    if (isNaN(amount) || amount <= 0) return;
    
    const res = await apiFetch('/vat-payments', {
        method: 'POST',
        body: JSON.stringify({ amount })
    });
    if (res && res.ok) {
        closeModals();
        loadDashboard();
    }
}

// Orders (Ventas) View
let allOrders = [];
let currentOrderPage = 1;
let currentOrderFilter = 'all';

async function loadOrders() {
    const queryInput = document.getElementById('search-order');
    const searchQuery = queryInput ? queryInput.value.trim() : '';
    const dateVal = document.getElementById('filter-order-date').value;
    const paymentVal = document.getElementById('filter-order-payment') ? document.getElementById('filter-order-payment').value : 'all';
    const statusVal = document.getElementById('filter-order-status') ? document.getElementById('filter-order-status').value : 'all';

    let url = `/orders?page=${currentOrderPage}&limit=20&is_live_sale=false`;
    if (statusVal !== 'all') url += `&status=${statusVal}`;
    if (paymentVal !== 'all') url += `&payment_method=${paymentVal}`;
    if (searchQuery) url += `&search=${encodeURIComponent(searchQuery)}`;
    if (dateVal) url += `&date_from=${dateVal}&date_to=${dateVal}`;

    const res = await apiFetch(url);
    if (res && res.ok) {
        const data = await res.json();
        allOrders = data.items;
        renderOrders(allOrders);
        const pageLabel = document.getElementById('order-page-label');
        if (pageLabel) pageLabel.innerText = `Página ${currentOrderPage} (${data.total_pages})`;
        window._totalOrderPages = data.total_pages;
    }
}

function nextOrderPage() {
    if (window._totalOrderPages && currentOrderPage >= window._totalOrderPages) return;
    currentOrderPage++;
    loadOrders();
}
window.nextOrderPage = nextOrderPage;

function prevOrderPage() {
    if (currentOrderPage > 1) {
        currentOrderPage--;
        loadOrders();
    }
}
window.prevOrderPage = prevOrderPage;

// ===== Estados de pedidos v2.0 (mismos que el Dashboard) =====
const ORDER_STATUS_META = {
    'Recibido':       { icon: '📥 ', color: '#3b82f6' },
    'En Preparación': { icon: '🔧 ', color: '#f97316' },
    'Preparado':      { icon: '📦 ', color: '#eab308' },
    'Despachado':     { icon: '✅ ', color: '#14b8a6' },
    'Por Pagar':      { icon: '⏳ ', color: '#ef4444' },
    'Pagado':         { icon: '💳 ', color: '#8b5cf6' },
    'Finalizado':     { icon: '✨ ', color: '#c89680' },
    'Cancelado':      { icon: '❌ ', color: '#9ca3af' }
};
// Debe coincidir con VALID_TRANSITIONS de main.py
const ORDER_TRANSITIONS = {
    'Recibido':       ['En Preparación', 'Cancelado'],
    'En Preparación': ['Preparado', 'Cancelado'],
    'Preparado':      ['Despachado', 'Cancelado'],
    'Despachado':     ['Pagado', 'Por Pagar', 'Cancelado'],
    'Pagado':         ['Finalizado', 'Cancelado'],
    'Por Pagar':      ['Pagado', 'Cancelado'],
    'Finalizado':     ['Cancelado'],
    'Cancelado':      []
};
// El medio de pago se pide al registrar el pago o al finalizar (igual que en el Dashboard)
function needsPaymentMethod(status) {
    return status === 'Pagado' || status === 'Finalizado';
}

function renderOrders(orders) {
    const tbody = document.querySelector('#orders-table tbody');
    tbody.innerHTML = '';
    orders.forEach(o => {
        const meta = ORDER_STATUS_META[o.status] || { icon: '', color: '#9ca3af' };
        const statusClass = '';
        const statusIcon = meta.icon;
        const statusStyle = `background: ${meta.color}22; color: ${meta.color}; border: 1px solid ${meta.color}66;`;
        
        // Render each item as a separate block so that they align perfectly vertically in their respective columns!
        const skusHtml = o.items.map(item => `<div style="padding: 4px 0; font-weight: 600; border-bottom: 1px dashed rgba(255,255,255,0.05);">${item.product ? item.product.sku : '-'}</div>`).join('');
        const namesHtml = o.items.map(item => `<div style="padding: 4px 0; border-bottom: 1px dashed rgba(255,255,255,0.05); text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 250px;" title="${item.product ? item.product.name : 'Producto Eliminado'}">${item.product ? item.product.name : 'Producto Eliminado'}</div>`).join('');
        const qtyHtml = o.items.map(item => `<div style="padding: 4px 0; border-bottom: 1px dashed rgba(255,255,255,0.05); font-weight: 500;">${item.quantity} ud</div>`).join('');
        
        const totalCost = Math.round(o.total_cost || 0);
        
        const totalCommission = o.total_commission;
        const totalTax = o.total_tax;
        const totalProfit = o.total_real_profit;
        
        const commissionVal = totalCommission > 0 ? `$${Math.round(totalCommission).toLocaleString('es-CL')}` : '-';
        // Impuesto (19%) completely rounded, no decimals!
        const taxVal = totalTax > 0 ? `$${Math.round(totalTax).toLocaleString('es-CL')}` : '-';
        const profitVal = (o.status === 'Pagado' || o.status === 'Finalizado') ? `$${Math.round(totalProfit).toLocaleString('es-CL')}` : '-';
        
        tbody.innerHTML += `
            <tr>
                <td>#${o.id}</td>
                <td><input type="checkbox" onchange="toggleClose('orders', ${o.id})" ${o.include_in_close ? 'checked' : ''} style="width: 20px; height: 20px; cursor: pointer; accent-color: var(--primary-color);"></td>
                <td>${new Date(o.created_at).toLocaleDateString()}</td>
                <td>${o.customer_name || 'Sin nombre'}</td>
                <td>${skusHtml}</td>
                <td>${namesHtml}</td>
                <td>${qtyHtml}</td>
                <td>$${Math.round(o.total).toLocaleString('es-CL')}</td>
                <td><span style="font-weight: 500;">${o.payment_method !== '-' ? o.payment_method : '—'}</span></td>
                <td>$${totalCost.toLocaleString('es-CL')}</td>
                <td style="color: var(--success); font-weight: 600;">${profitVal}</td>
                <td>${taxVal}</td>
                <td>${commissionVal}</td>
                <td><span class="status-badge ${statusClass}" style="${statusStyle}">${statusIcon}${o.status}</span></td>
                <td style="display: flex; gap: 0.5rem; justify-content: center;">
                    <button class="btn outline-btn" style="padding:0.3rem 0.6rem; font-size:0.8rem; width: auto;" onclick="showReceiptModal(${o.id})" title="Ver Comprobante"><i class="fa-solid fa-receipt"></i> Ver</button>
                    <button class="btn outline-btn" style="padding:0.3rem 0.6rem; font-size:0.8rem; width: auto;" onclick="showStatusModal(${o.id}, '${o.status}', '${o.payment_method}')">Cambiar</button>
                    <button class="btn outline-btn" style="padding:0.3rem 0.6rem; font-size:0.8rem; width: auto;" onclick="showEditOrderModal(${o.id})"><i class="fa-solid fa-edit"></i> Editar</button>
                    <button class="btn outline-btn" style="padding:0.3rem 0.6rem; font-size:0.8rem; width: auto; color: var(--warning); border-color: rgba(239, 68, 68, 0.2);" onclick="confirmDeleteOrder(${o.id})"><i class="fa-solid fa-trash"></i> Eliminar</button>
                </td>
            </tr>
        `;
    });
}

async function previewOrderPDF(orderId) {
    try {
        const res = await fetch(`${API_URL}/orders/${orderId}/pdf`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            window.open(url, '_blank');
        } else {
            const errData = await res.json();
            alert('Error al generar PDF: ' + (errData.detail || 'Error desconocido'));
        }
    } catch (err) {
        console.error(err);
        alert('Error al conectar con el servidor');
    }
}
window.previewOrderPDF = previewOrderPDF;


// Show/Hide Payment method based on Status in the edit status modal
// Only show payment method when marking as Pagado
function toggleStatusModalPaymentMethod(status) {
    const container = document.getElementById('status-payment-container');
    if (needsPaymentMethod(status)) {
        container.classList.remove('hidden');
    } else {
        container.classList.add('hidden');
    }
}
window.toggleStatusModalPaymentMethod = toggleStatusModalPaymentMethod;

// Open status edit modal
function showStatusModal(id, status, paymentMethod) {
    document.getElementById('status-order-id').value = id;
    const select = document.getElementById('status-select');
    const allowed = [status, ...(ORDER_TRANSITIONS[status] || [])];
    // Estados antiguos (ej. 'Por preparar') que no existen en v2.0: se permite elegir cualquiera
    const options = ORDER_STATUS_META[status] ? allowed : [status, ...Object.keys(ORDER_STATUS_META)];
    select.innerHTML = options.map(st => {
        const icon = (ORDER_STATUS_META[st] || { icon: '' }).icon;
        const label = st === status ? `${st} (actual)` : st;
        return `<option value="${st}">${icon}${label}</option>`;
    }).join('');
    select.value = status;
    document.getElementById('status-payment-method').value = (paymentMethod && paymentMethod !== '-' ? paymentMethod : 'Efectivo');
    
    toggleStatusModalPaymentMethod(status);
    
    document.getElementById('modal-backdrop').classList.remove('hidden');
    document.getElementById('status-modal').classList.remove('hidden');
}
window.showStatusModal = showStatusModal;

// Save order status & payment method updates
async function saveOrderStatusUpdate() {
    const id = document.getElementById('status-order-id').value;
    const status = document.getElementById('status-select').value;
    let url = `/orders/${id}/status?status=${encodeURIComponent(status)}`;
    if (needsPaymentMethod(status)) {
        url += `&payment_method=${encodeURIComponent(document.getElementById('status-payment-method').value)}`;
    }
    
    const res = await apiFetch(url, { method: 'PUT' });
    if (res && res.ok) {
        closeModals();
        loadOrders();
        loadVentasLive();
        loadProducts();
        loadDashboard();
    } else if (res) {
        let msg = 'No se pudo actualizar el estado.';
        try { const err = await res.json(); if (err.detail) msg = err.detail; } catch (e) {}
        alert(msg);
    }
}
window.saveOrderStatusUpdate = saveOrderStatusUpdate;

async function confirmDeleteOrder(id) {
    if (confirm("¿Estás seguro que deseas eliminar este pedido? Esta acción no se puede deshacer y devolverá los productos a bodega si corresponde.")) {
        const res = await apiFetch(`/orders/${id}`, { method: 'DELETE' });
        if (res && res.ok) {
            loadOrders();
            loadProducts();
            loadDashboard();
        } else {
            alert("Error al eliminar pedido.");
        }
    }
}
window.confirmDeleteOrder = confirmDeleteOrder;


// Search Order filters (SKU, Customer name, Date, and Amount)
function filterOrders() {
    currentOrderPage = 1; // Reset to page 1 on new filter/search
    loadOrders();
}

// Add event listeners for order search and filters
const debouncedFilterOrders = debounce(() => filterOrders(), 300);
document.getElementById('search-order').addEventListener('input', debouncedFilterOrders);
document.getElementById('filter-order-date').addEventListener('change', () => filterOrders());
document.getElementById('filter-order-amount').addEventListener('input', debouncedFilterOrders);
document.getElementById('filter-order-payment').addEventListener('change', () => filterOrders());

// Event listeners for order filters are already at the bottom or attached to elements, 
// we just need to make sure they call the new filterOrders() correctly.

function setOrderFilter(status) {
    document.getElementById('filter-order-status').value = status;
    currentOrderPage = 1; // Reset page
    
    document.querySelectorAll('#view-orders .tabs-container button').forEach(b => {
        b.classList.remove('active');
        b.classList.add('outline-btn');
    });
    
    let btnId = status === 'all' ? 'all' : status.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s/g, '-');
    const targetBtn = document.getElementById(`tab-orders-${btnId}`);
    if (targetBtn) {
        targetBtn.classList.remove('outline-btn');
        targetBtn.classList.add('active');
    }

    // Show payment filter only for All, Pagado, and Finalizado
    const paymentFilter = document.getElementById('filter-order-payment');
    if (paymentFilter) {
        if (status === 'all' || status === 'Pagado' || status === 'Finalizado') {
            paymentFilter.classList.remove('hidden');
        } else {
            paymentFilter.classList.add('hidden');
            paymentFilter.value = 'all'; // Reset to avoid confusion
        }
    }
    
    loadOrders();
}

// POS Order dynamic logic
let posItems = [];
let currentEditOrderId = null;

function showAddOrderModal() {
    currentEditOrderId = null;
    posItems = [];
    renderPOSItems();
    
    document.getElementById('pos-modal-title').innerText = "Nuevo Pedido (Venta POS)";
    document.getElementById('pos-submit-btn').innerText = "Crear Pedido";
    
    const today = new Date().toISOString().substring(0, 10);
    document.getElementById('order-date').value = today;
    document.getElementById('order-customer').value = '';
    document.getElementById('order-search-prod').value = '';
    document.getElementById('order-status').value = 'Recibido';
    document.getElementById('order-payment-method').value = '';
    
    // reset payment method visibility (hidden by default since status is 'Recibido')
    togglePOSPaymentMethod('Recibido');
    
    document.getElementById('pos-search-results').classList.add('hidden');
    
    document.getElementById('modal-backdrop').classList.remove('hidden');
    document.getElementById('order-modal').classList.remove('hidden');
}

function showEditOrderModal(orderId) {
    const order = allOrders.find(o => o.id === orderId);
    if (!order) return;
    
    currentEditOrderId = order.id;
    
    // Map items mapping logic
    posItems = order.items.map(i => ({
        id: i.product_id,
        sku: i.product ? i.product.sku : '',
        name: i.product ? i.product.name : 'Producto Eliminado',
        price: i.price,
        quantity: i.quantity,
        stock: (i.product ? i.product.stock : 0) + i.quantity // include the quantity currently in this order so they can use it without error
    }));
    renderPOSItems();
    
    document.getElementById('pos-modal-title').innerText = "Editar Pedido #" + order.id;
    document.getElementById('pos-submit-btn').innerText = "Actualizar Pedido";
    
    document.getElementById('order-date').value = order.created_at ? order.created_at.substring(0, 10) : '';
    document.getElementById('order-customer').value = order.customer_name || '';
    document.getElementById('order-search-prod').value = '';
    document.getElementById('order-status').value = order.status;
    togglePOSPaymentMethod(order.status);
    
    if(needsPaymentMethod(order.status)) {
        document.getElementById('order-payment-method').value = order.payment_method && order.payment_method !== '-' ? order.payment_method : '';
    } else {
        document.getElementById('order-payment-method').value = '';
    }
    
    document.getElementById('pos-search-results').classList.add('hidden');
    
    document.getElementById('modal-backdrop').classList.remove('hidden');
    document.getElementById('order-modal').classList.remove('hidden');
}

// Show/Hide Payment method based on Payment Status in POS modal
// Only show when Pagado is selected
function togglePOSPaymentMethod(status) {
    const methodContainer = document.getElementById('payment-method-container');
    if (needsPaymentMethod(status)) {
        methodContainer.classList.remove('hidden');
    } else {
        methodContainer.classList.add('hidden');
    }
}
window.togglePOSPaymentMethod = togglePOSPaymentMethod;


async function filterPOSProducts(query) {
    const q = query.toLowerCase().trim();
    const resultsDiv = document.getElementById('pos-search-results');
    if (!q) {
        resultsDiv.classList.add('hidden');
        return;
    }
    
    // Fetch products from server matching the search term
    const res = await apiFetch(`/products?search=${encodeURIComponent(q)}&limit=10`);
    if (res && res.ok) {
        const data = await res.json();
        const products = data.items || [];
        if (products.length === 0) {
            resultsDiv.innerHTML = `<div style="padding: 0.8rem; color: var(--text-secondary); font-size: 0.9rem;">No se encontraron productos.</div>`;
        } else {
            resultsDiv.innerHTML = '';
            products.forEach(p => {
                resultsDiv.innerHTML += `
                    <div class="pos-search-item" onclick="addPOSItem(${p.id}, '${p.sku}', '${p.name.replace(/'/g, "\\'")}', ${p.price}, ${p.stock})" style="padding: 0.8rem; cursor: pointer; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; font-size: 0.9rem; background: var(--card-bg);">
                        <span><strong>${p.sku || '-'}</strong> - ${p.name}</span>
                        <span style="color: var(--primary-color);">Stock: ${p.stock} | $${p.price.toLocaleString('es-CL')}</span>
                    </div>
                `;
            });
        }
    }
    resultsDiv.classList.remove('hidden');
}
window.filterPOSProducts = filterPOSProducts;
window.addPOSItem = addPOSItem;
window.updatePOSItemQty = updatePOSItemQty;
window.removePOSItem = removePOSItem;
window.showEditProduct = showEditProduct;
window.deleteProduct = deleteProduct;
window.showEditInsumo = showEditInsumo;

function addPOSItem(id, sku, name, price, stock) {
    document.getElementById('pos-search-results').classList.add('hidden');
    document.getElementById('order-search-prod').value = '';
    
    if (stock <= 0) {
        alert('Este producto no tiene stock disponible en bodega.');
        return;
    }
    
    const existing = posItems.find(item => item.id === id);
    if (existing) {
        if (existing.quantity < stock) {
            existing.quantity++;
        } else {
            alert('Has alcanzado el límite de stock disponible en bodega.');
        }
    } else {
        posItems.push({
            id,
            sku,
            name,
            price,
            stock,
            quantity: 1
        });
    }
    renderPOSItems();
}

function renderPOSItems() {
    const tbody = document.querySelector('#pos-items-table tbody');
    tbody.innerHTML = '';
    
    if (posItems.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-secondary);">No se han agregado productos a la venta.</td></tr>`;
        document.getElementById('pos-total-display').innerText = '$0';
        return;
    }
    
    let total = 0;
    posItems.forEach((item, idx) => {
        const itemTotal = Math.round(item.price * item.quantity);
        total += itemTotal;
        tbody.innerHTML += `
            <tr>
                <td><strong>${item.sku || '-'}</strong><br><span style="font-size: 0.8rem; color: var(--text-secondary);">${item.name}</span></td>
                <td>
                    <div style="display: flex; flex-direction: column; gap: 0.2rem;">
                        <div style="display: flex; align-items: center; gap: 0.3rem;">
                            <span style="font-size: 0.85rem; color: var(--text-secondary);">$</span>
                            <input type="number" value="${Math.round(item.price)}" min="0" step="100" oninput="updatePOSItemPrice(${idx}, this.value)" style="width: 100px; padding: 0.3rem; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-color); color: var(--text-primary); font-weight: 600;">
                        </div>
                        <div style="display: flex; gap: 0.2rem; align-items: center; margin-top: 0.2rem;">
                            <span style="font-size: 0.65rem; color: var(--text-secondary);">Promo:</span>
                            <button type="button" class="btn outline-btn" style="padding: 0.1rem 0.3rem; font-size: 0.65rem; width: auto;" onclick="applyPOSItemDiscount(${idx}, 10)">-10%</button>
                            <button type="button" class="btn outline-btn" style="padding: 0.1rem 0.3rem; font-size: 0.65rem; width: auto;" onclick="applyPOSItemDiscount(${idx}, 20)">-20%</button>
                            <button type="button" class="btn outline-btn" style="padding: 0.1rem 0.3rem; font-size: 0.65rem; width: auto;" onclick="applyPOSItemDiscount(${idx}, 50)">-50%</button>
                        </div>
                    </div>
                </td>
                <td>
                    <input type="number" value="${item.quantity}" min="1" max="${item.stock}" onchange="updatePOSItemQty(${idx}, this.value)" style="width: 60px; padding: 0.3rem; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-color); color: var(--text-primary); text-align: center;">
                </td>
                <td style="font-weight: 600; color: var(--primary-color);">$${itemTotal.toLocaleString('es-CL')}</td>
                <td>
                    <button class="btn outline-btn" style="padding: 0.3rem; width: auto; color: var(--warning); border-color: rgba(239, 68, 68, 0.2);" onclick="removePOSItem(${idx})"><i class="fa-solid fa-trash"></i></button>
                </td>
            </tr>
        `;
    });
    
    document.getElementById('pos-total-display').innerText = `$${Math.round(total).toLocaleString('es-CL')}`;
}

function updatePOSItemPrice(idx, val) {
    const newPrice = Math.max(0, parseFloat(val) || 0);
    if (posItems[idx]) {
        posItems[idx].price = newPrice;
        let total = posItems.reduce((acc, item) => acc + Math.round(item.price * item.quantity), 0);
        document.getElementById('pos-total-display').innerText = `$${total.toLocaleString('es-CL')}`;
        
        // Update item total cell visually without re-rendering full table to preserve cursor focus
        const tbody = document.querySelector('#pos-items-table tbody');
        if (tbody && tbody.rows[idx]) {
            const totalCell = tbody.rows[idx].cells[3];
            if (totalCell) {
                totalCell.innerText = `$${Math.round(newPrice * posItems[idx].quantity).toLocaleString('es-CL')}`;
            }
        }
    }
}
window.updatePOSItemPrice = updatePOSItemPrice;

function applyPOSItemDiscount(idx, percentage) {
    if (posItems[idx]) {
        const currentPrice = posItems[idx].price;
        const discounted = Math.round(currentPrice * (1 - percentage / 100));
        posItems[idx].price = discounted;
        renderPOSItems();
    }
}
window.applyPOSItemDiscount = applyPOSItemDiscount;

function updatePOSItemQty(idx, val) {
    const qty = parseInt(val);
    const item = posItems[idx];
    if (isNaN(qty) || qty < 1) {
        item.quantity = 1;
    } else if (qty > item.stock) {
        alert(`Solo quedan ${item.stock} unidades de este producto en bodega.`);
        item.quantity = item.stock;
    } else {
        item.quantity = qty;
    }
    renderPOSItems();
}

function removePOSItem(idx) {
    posItems.splice(idx, 1);
    renderPOSItems();
}

async function submitPOSOrder() {
    if (posItems.length === 0) {
        alert('Por favor, agrega al menos un producto a la venta.');
        return;
    }
    
    const orderDate = document.getElementById('order-date').value;
    let parsedDate = null;
    if (orderDate) {
        parsedDate = new Date(orderDate).toISOString();
    }
    
    const paymentStatus = document.getElementById('order-status').value;
    const paymentMethodRaw = document.getElementById('order-payment-method').value;
    
    if (needsPaymentMethod(paymentStatus) && !paymentMethodRaw) {
        alert('Por favor, selecciona un medio de pago.');
        return;
    }
    
    const paymentMethod = needsPaymentMethod(paymentStatus) ? paymentMethodRaw : '-';
    const order = {
        customer_name: document.getElementById('order-customer').value || null,
        status: paymentStatus,
        payment_method: paymentMethod,
        created_at: parsedDate,
        items: posItems.map(item => ({
            product_id: item.id,
            quantity: item.quantity,
            price: item.price
        }))
    };

    const url = currentEditOrderId ? `/orders/${currentEditOrderId}` : '/orders';
    const method = currentEditOrderId ? 'PUT' : 'POST';

    const res = await apiFetch(url, {
        method: method,
        body: JSON.stringify(order)
    });
    
    if (res && res.ok) {
        closeModals();
        currentEditOrderId = null;
        loadOrders();
        loadProducts();
        loadDashboard();
    }
}

// Scanner (Direct camera control with permission handling)
function startScanner() {
    if (typeof Html5QrCode === 'undefined') {
        alert("La librería del escáner no se ha cargado. Por favor, asegúrate de estar conectado a internet o recarga la página.");
        return;
    }
    
    document.getElementById('scan-result').classList.add('hidden');
    document.getElementById('scanner-buttons-wrapper').classList.add('hidden');
    document.getElementById('reader-wrapper').classList.remove('hidden');
    
    if (!html5QrCode) {
        html5QrCode = new Html5QrCode("reader");
    }
    
    const config = { fps: 10, qrbox: { width: 250, height: 250 } };
    
    html5QrCode.start(
        { facingMode: "environment" }, 
        config,
        onScanSuccess,
        onScanError
    ).catch(err => {
        console.error("Camera access error: ", err);
        alert("No se pudo acceder a la cámara. Asegúrate de dar los permisos correspondientes o usar HTTPS/localhost.");
        stopScanner();
    });
}

function stopScanner() {
    if (html5QrCode && html5QrCode.isScanning) {
        html5QrCode.stop().then(() => {
            showScannerInterface();
        }).catch(err => {
            console.error("Failed to stop html5QrCode stream. ", err);
            showScannerInterface();
        });
    } else {
        showScannerInterface();
    }
}

async function scanImageFile(input) {
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    
    if (typeof Html5QrCode === 'undefined') {
        alert("La librería del escáner no se ha cargado.");
        return;
    }
    
    if (!html5QrCode) {
        html5QrCode = new Html5QrCode("reader");
    }
    
    try {
        const decodedText = await html5QrCode.scanFile(file, true);
        await onScanSuccess(decodedText);
    } catch (err) {
        console.error("Error al escanear archivo: ", err);
        alert("No se pudo detectar ningún código de barras en la foto. Intenta tomarla bien enfocada, más de cerca y con buena iluminación.");
    } finally {
        input.value = "";
    }
}
window.scanImageFile = scanImageFile;

function showScannerInterface() {
    document.getElementById('scan-result').classList.add('hidden');
    document.getElementById('reader-wrapper').classList.add('hidden');
    document.getElementById('scanner-buttons-wrapper').classList.remove('hidden');
}
window.showScannerInterface = showScannerInterface;
window.startScanner = startScanner;
window.stopScanner = stopScanner;

async function onScanSuccess(decodedText, decodedResult) {
    // stop camera on successful scan
    if (html5QrCode && html5QrCode.isScanning) {
        await html5QrCode.stop().catch(err => console.error(err));
    }
    
    document.getElementById('reader-wrapper').classList.add('hidden');
    
    const res = await apiFetch(`/products/${decodedText}`);
    const resDiv = document.getElementById('scan-result');
    resDiv.classList.remove('hidden');
    
    if (res && res.ok) {
        const prod = await res.json();
        document.getElementById('scanned-name').innerText = prod.name;
        document.getElementById('scanned-price').innerText = `Precio: $${prod.price.toLocaleString('es-CL')}`;
    } else {
        document.getElementById('scanned-name').innerText = 'Producto no encontrado';
        document.getElementById('scanned-price').innerText = '';
    }
}

function onScanError(errorMessage) {
    // console.log(errorMessage);
}

// Bank Close
window.currentClosePreview = null;

let adjustmentsByType = {
    efectivo: [],
    tarjeta: []
};

function switchCloseTab(type) {
    document.getElementById('current-close-type').value = type === 'efectivo' ? 'Efectivo' : 'Tarjeta/Transferencia';
    
    // UI tabs style
    if (type === 'efectivo') {
        document.getElementById('tab-efectivo').classList.replace('outline-btn', 'primary-btn');
        document.getElementById('tab-tarjeta').classList.replace('primary-btn', 'outline-btn');
        document.getElementById('row-bc-ventas-efectivo').style.display = 'flex';
        document.getElementById('row-bc-ventas-transferencia').style.display = 'none';
        document.getElementById('row-bc-ventas-tarjeta').style.display = 'none';
    } else {
        document.getElementById('tab-tarjeta').classList.replace('outline-btn', 'primary-btn');
        document.getElementById('tab-efectivo').classList.replace('primary-btn', 'outline-btn');
        document.getElementById('row-bc-ventas-efectivo').style.display = 'none';
        document.getElementById('row-bc-ventas-transferencia').style.display = 'flex';
        document.getElementById('row-bc-ventas-tarjeta').style.display = 'flex';
    }
    
    // Update data
    if (window.currentClosePreview) {
        const pData = window.currentClosePreview[type];
        if (pData) {
            document.getElementById('bc-saldo-inicial').innerText = `$${Math.round(pData.saldo_inicial).toLocaleString('es-CL')}`;
            document.getElementById('bc-insumos').innerText = `$${Math.round(pData.insumos).toLocaleString('es-CL')}`;
            document.getElementById('bc-ingresos').innerText = `$${Math.round(pData.ingresos).toLocaleString('es-CL')}`;
            
            if (type === 'efectivo') {
                document.getElementById('bc-ventas-efectivo').innerText = `$${Math.round(pData.ventas).toLocaleString('es-CL')}`;
            } else {
                document.getElementById('bc-ventas-transferencia').innerText = `$${Math.round(pData.ventas_transferencia).toLocaleString('es-CL')}`;
                document.getElementById('bc-ventas-tarjeta').innerText = `$${Math.round(pData.ventas_tarjeta_netas).toLocaleString('es-CL')}`;
            }
            
            // Preview counts
            const counts = pData.counts || { orders: 0, live_sales: 0, insumos: 0, ingresos: 0 };
            document.getElementById('bc-preview-counts').innerText = `Se contabilizarán: ${counts.orders} pedidos, ${counts.live_sales} ventas live, ${counts.insumos} insumos y ${counts.ingresos} ingresos`;
        }
    }
    renderBankCloseAdjustments();
    recalculateBankCloseExpected();
    updateLiveDifference();
}
window.switchCloseTab = switchCloseTab;

async function loadBankCloses() {
    const previewRes = await apiFetch('/bank-close/preview');
    if (previewRes && previewRes.ok) {
        const p = await previewRes.json();
        window.currentClosePreview = p;
        const initialPanel = document.getElementById('initial-balance-panel');
        const regularPanel = document.getElementById('regular-close-panel');
        
        if (!p.has_initial) {
            initialPanel.classList.remove('hidden');
            regularPanel.classList.add('hidden');
        } else {
            initialPanel.classList.add('hidden');
            regularPanel.classList.remove('hidden');
            const currentTab = document.getElementById('current-close-type').value === 'Efectivo' ? 'efectivo' : 'tarjeta';
            switchCloseTab(currentTab);
        }
    }

    const res = await apiFetch('/bank-closes');
    if (res && res.ok) {
        const closes = await res.json();
        const tbody = document.querySelector('#closes-table tbody');
        tbody.innerHTML = '';
        closes.forEach((c, idx) => {
            const diff = c.diferencia || 0;
            const diffClass = diff === 0 ? 'status-pagado' : 'status-pendiente';
            const realBal = c.saldo_real !== null ? `$${Math.round(c.saldo_real).toLocaleString('es-CL')}` : '-';
            
            // Only allow UNDO for the most recent close of each type
            const isLatestOfType = closes.find(other => other.close_type === c.close_type).id === c.id;
            const undoBtn = isLatestOfType ? `<button class="btn outline-btn" style="padding: 0.3rem 0.6rem; font-size: 0.8rem; color: var(--warning); border-color: rgba(239, 68, 68, 0.2);" onclick="undoBankClose(${c.id})"><i class="fa-solid fa-undo"></i> Deshacer</button>` : '';
            const detailsBtn = c.adjustments && c.adjustments.length > 0 ? `<button class="btn outline-btn" style="padding: 0.3rem 0.6rem; font-size: 0.8rem;" onclick="showAdjustmentsDetail(${c.id})"><i class="fa-solid fa-list"></i> Ajustes</button>` : '';

            tbody.innerHTML += `
                <tr>
                    <td>${new Date(c.created_at).toLocaleString('es-CL')}</td>
                    <td><span class="status-badge" style="background: rgba(255,255,255,0.1); color: var(--text-primary); border: 1px solid var(--border-color);">${c.close_type}</span></td>
                    <td>$${Math.round(c.saldo_inicial).toLocaleString('es-CL')}</td>
                    <td>$${Math.round(c.saldo_esperado).toLocaleString('es-CL')}</td>
                    <td>${realBal}</td>
                    <td><span class="status-badge ${diffClass}">$${Math.round(diff).toLocaleString('es-CL')}</span></td>
                    <td style="font-size: 0.85rem; color: var(--text-secondary);">${c.notas || '—'}</td>
                    <td>
                        <div style="display: flex; gap: 0.5rem;">
                            ${detailsBtn}
                            ${undoBtn}
                        </div>
                    </td>
                </tr>
            `;
        });
    }
}
window.loadBankCloses = loadBankCloses;

// Currency formatting helper
function formatCurrencyInput(input) {
    let value = input.value.replace(/\D/g, '');
    if (value === '') {
        input.value = '';
        return;
    }
    input.value = parseInt(value).toLocaleString('es-CL');
}
window.formatCurrencyInput = formatCurrencyInput;

function parseCurrencyValue(value) {
    if (!value) return 0;
    // Remove currency symbols, dots, and everything except digits and optional minus sign
    const cleaned = value.toString().replace(/[^\d-]/g, '');
    return parseInt(cleaned) || 0;
}

async function submitInitialBankClose() {
    const val = parseCurrencyValue(document.getElementById('bank-initial-balance').value);
    const closeType = document.getElementById('bank-initial-type').value;
    if(isNaN(val)) {
        alert("Por favor ingresa un monto válido.");
        return;
    }
    const res = await apiFetch('/bank-close', {
        method: 'POST',
        body: JSON.stringify({ close_type: closeType, saldo_inicial: val })
    });
    if(res && res.ok) {
        loadBankCloses();
        loadDashboard();
    }
}
window.submitInitialBankClose = submitInitialBankClose;

let bankCloseAdjustments = [];

function addBankCloseAdjustment() {
    const typeKey = document.getElementById('current-close-type').value === 'Efectivo' ? 'efectivo' : 'tarjeta';
    const tipo = document.getElementById('adj-tipo').value;
    const monto = parseCurrencyValue(document.getElementById('adj-monto').value);
    const comentario = document.getElementById('adj-comentario').value;
    const editIndex = parseInt(document.getElementById('adj-edit-index').value);
    
    if (!monto || isNaN(monto) || monto <= 0) {
        alert("Ingrese un monto válido");
        return;
    }
    
    const adj = { tipo, monto, comentario };
    
    if (editIndex > -1) {
        adjustmentsByType[typeKey][editIndex] = adj;
        document.getElementById('adj-edit-index').value = "-1";
        document.getElementById('btn-add-adjustment').innerText = "+ Agregar Ajuste";
    } else {
        adjustmentsByType[typeKey].push(adj);
    }
    
    document.getElementById('adj-monto').value = '';
    document.getElementById('adj-comentario').value = '';
    renderBankCloseAdjustments();
}
window.addBankCloseAdjustment = addBankCloseAdjustment;

function removeBankCloseAdjustment(idx) {
    const typeKey = document.getElementById('current-close-type').value === 'Efectivo' ? 'efectivo' : 'tarjeta';
    adjustmentsByType[typeKey].splice(idx, 1);
    renderBankCloseAdjustments();
}
window.removeBankCloseAdjustment = removeBankCloseAdjustment;

function editBankCloseAdjustment(idx) {
    const typeKey = document.getElementById('current-close-type').value === 'Efectivo' ? 'efectivo' : 'tarjeta';
    const adj = adjustmentsByType[typeKey][idx];
    
    document.getElementById('adj-tipo').value = adj.tipo;
    document.getElementById('adj-monto').value = adj.monto.toLocaleString('es-CL');
    document.getElementById('adj-comentario').value = adj.comentario;
    document.getElementById('adj-edit-index').value = idx;
    document.getElementById('btn-add-adjustment').innerText = "Guardar Cambios";
}
window.editBankCloseAdjustment = editBankCloseAdjustment;

function renderBankCloseAdjustments() {
    const typeKey = document.getElementById('current-close-type').value === 'Efectivo' ? 'efectivo' : 'tarjeta';
    const container = document.getElementById('bank-close-adjustments-list');
    container.innerHTML = '';
    adjustmentsByType[typeKey].forEach((adj, idx) => {
        container.innerHTML += `
            <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.05); padding: 0.5rem; border-radius: 4px;">
                <span>${adj.tipo === 'ingreso' ? '+' : '-'} $${adj.monto.toLocaleString('es-CL')} (${adj.comentario})</span>
                <div style="display: flex; gap: 0.5rem;">
                    <button type="button" onclick="editBankCloseAdjustment(${idx})" style="background: none; border: none; color: var(--primary-color); cursor: pointer;"><i class="fa-solid fa-edit"></i></button>
                    <button type="button" onclick="removeBankCloseAdjustment(${idx})" style="background: none; border: none; color: var(--warning); cursor: pointer;"><i class="fa-solid fa-times"></i></button>
                </div>
            </div>
        `;
    });
    recalculateBankCloseExpected();
}

function recalculateBankCloseExpected() {
    const currentCloseType = document.getElementById('current-close-type').value;
    const typeKey = currentCloseType === 'Efectivo' ? 'efectivo' : 'tarjeta';
    if (!window.currentClosePreview || !window.currentClosePreview[typeKey]) return;
    
    const baseEsperado = window.currentClosePreview[typeKey].saldo_esperado;
    let sumAdj = 0;
    adjustmentsByType[typeKey].forEach(a => {
        if (a.tipo === 'ingreso') sumAdj += a.monto;
        else sumAdj -= a.monto;
    });
    const finalEsperado = baseEsperado + sumAdj;
    document.getElementById('bc-saldo-esperado').innerText = `$${Math.round(finalEsperado).toLocaleString('es-CL')}`;
    updateLiveDifference();
}

function updateLiveDifference() {
    const realBalance = parseCurrencyValue(document.getElementById('bank-real-balance').value);
    const expectedText = document.getElementById('bc-saldo-esperado').innerText;
    const expectedBalance = parseCurrencyValue(expectedText);
    
    const diffSummary = document.getElementById('live-diff-summary');
    if (isNaN(realBalance) || realBalance === 0 && document.getElementById('bank-real-balance').value === '') {
        diffSummary.innerText = '';
        return;
    }
    
    const diff = realBalance - expectedBalance;
    if (diff === 0) {
        diffSummary.innerText = "✓ Cuadrado (Diferencia $0)";
        diffSummary.style.color = "var(--success)";
    } else {
        const diffText = diff > 0 ? `Sobran $${Math.round(diff).toLocaleString('es-CL')}` : `Faltan $${Math.round(Math.abs(diff)).toLocaleString('es-CL')}`;
        diffSummary.innerText = `⚠ Diferencia: ${diffText}`;
        diffSummary.style.color = "#f59e0b"; // Yellow/Orange
    }
}
window.updateLiveDifference = updateLiveDifference;

async function undoBankClose(id) {
    if (!confirm("¿Estás seguro de que deseas deshacer este cierre? Se revertirán los estados de los pedidos, insumos e ingresos asociados. Esta acción no se puede deshacer.")) {
        return;
    }
    
    const res = await apiFetch(`/bank-close/${id}`, { method: 'DELETE' });
    if (res && res.ok) {
        loadBankCloses();
        loadDashboard();
        // Refresh other views
        if (document.getElementById('view-orders').classList.contains('active')) loadOrders();
        if (document.getElementById('view-insumos').classList.contains('active')) loadInsumos();
        if (document.getElementById('view-ingresos').classList.contains('active')) loadIngresos();
    }
}
window.undoBankClose = undoBankClose;

async function showAdjustmentsDetail(id) {
    const res = await apiFetch(`/bank-close/${id}`);
    if (res && res.ok) {
        const close = await res.json();
        const tbody = document.querySelector('#adjustments-detail-table tbody');
        tbody.innerHTML = '';
        if (close.adjustments && close.adjustments.length > 0) {
            close.adjustments.forEach(a => {
                tbody.innerHTML += `
                    <tr>
                        <td><span style="color: ${a.tipo === 'ingreso' ? 'var(--success)' : 'var(--warning)'}; font-weight: 600;">${a.tipo.toUpperCase()}</span></td>
                        <td>$${Math.round(a.monto).toLocaleString('es-CL')}</td>
                        <td>${a.comentario}</td>
                        <td>${new Date(a.created_at).toLocaleDateString()}</td>
                    </tr>
                `;
            });
        }
        document.getElementById('modal-backdrop').classList.remove('hidden');
        document.getElementById('adjustments-detail-modal').classList.remove('hidden');
    }
}
window.showAdjustmentsDetail = showAdjustmentsDetail;

async function toggleMarkAll(type) {
    const isChecked = document.getElementById(`mark-all-${type}`).checked;
    
    // This is a simplified "mark all" that toggles the checkboxes visually 
    // and sends a request for EACH item. 
    // In a production app, we'd probably want a single endpoint for this.
    // Given the constraints and existing patterns, I'll stick to a loop but 
    // maybe I should add a backend endpoint for batch toggle.
    // For now, I'll follow the user's request to "agregar un boton de marcar todos".
    
    const table = document.getElementById(`${type}-table`);
    const checkboxes = table.querySelectorAll('tbody input[type="checkbox"]');
    
    // To avoid overwhelming the server, we'll do them sequentially or in small batches.
    // But since this is a small-scale app, let's just do them.
    for (let cb of checkboxes) {
        if (cb.checked !== isChecked) {
            cb.checked = isChecked;
            // The checkbox has an onchange="toggleClose(...)"
            // We trigger it manually.
            cb.dispatchEvent(new Event('change'));
        }
    }
}
window.toggleMarkAll = toggleMarkAll;

async function submitRegularBankClose() {
    const realBalanceInput = document.getElementById('bank-real-balance');
    if (!realBalanceInput.value.trim()) {
        alert("Por favor ingresa el saldo real para poder realizar el cierre.");
        realBalanceInput.focus();
        return;
    }
    
    const val = parseCurrencyValue(realBalanceInput.value);
    const notes = document.getElementById('bank-close-notes') ? document.getElementById('bank-close-notes').value.trim() : null;
    const closeType = document.getElementById('current-close-type').value;
    const typeKey = closeType === 'Efectivo' ? 'efectivo' : 'tarjeta';
    
    if(isNaN(val)) {
        alert("Por favor ingresa un monto válido para el saldo real.");
        return;
    }
    const res = await apiFetch('/bank-close', {
        method: 'POST',
        body: JSON.stringify({ 
            close_type: closeType, 
            saldo_real: val, 
            notas: notes, 
            adjustments: adjustmentsByType[typeKey] 
        })
    });
    if(res && res.ok) {
        const data = await res.json();
        const msgDiv = document.getElementById('close-result');
        const msgText = document.getElementById('close-msg');
        msgDiv.classList.remove('hidden');
        if(data.diferencia === 0) {
            msgText.innerText = `¡Cuadratura Perfecta! Diferencia: $0`;
            msgText.style.color = 'var(--success)';
        } else {
            msgText.innerText = `Diferencia de cuadratura: $${Math.round(data.diferencia).toLocaleString('es-CL')}`;
            msgText.style.color = 'var(--warning)';
        }
        document.getElementById('bank-real-balance').value = '';
        document.getElementById('live-diff-summary').innerText = '';
        if (document.getElementById('bank-close-notes')) document.getElementById('bank-close-notes').value = '';
        
        adjustmentsByType[typeKey] = [];
        renderBankCloseAdjustments();
        
        loadBankCloses();
        loadDashboard();
        
        setTimeout(() => {
            msgDiv.classList.add('hidden');
        }, 8000);
        
        // Refresh tables if active
        if (document.getElementById('view-orders').classList.contains('active')) loadOrders();
        if (document.getElementById('view-insumos').classList.contains('active')) loadInsumos();
        if (document.getElementById('view-ingresos').classList.contains('active')) loadIngresos();
    }
}

// Receipt Modal Functions
let currentReceiptOrderId = null;

async function showReceiptModal(orderId) {
    currentReceiptOrderId = orderId;
    const order = allOrders.find(o => o.id === orderId) || (window._dashboardData ? [...window._dashboardData.orders_por_preparar, ...window._dashboardData.orders_preparados, ...window._dashboardData.orders_faltan_pagar].find(o => o.id === orderId) : null);
    
    if (!order) {
        // If not in local cache, fetch from server
        try {
            const res = await apiFetch(`/orders?search=${orderId}`); // Vague search to find the specific ID
            if (res && res.ok) {
                const data = await res.json();
                const found = data.items.find(o => o.id === orderId);
                if (found) {
                    renderReceiptContent(found);
                } else {
                    alert("Pedido no encontrado para mostrar el comprobante.");
                }
            }
        } catch (e) { console.error(e); }
        return;
    }

    renderReceiptContent(order);
}
window.showReceiptModal = showReceiptModal;

function renderReceiptContent(order) {
    const container = document.getElementById('receipt-content');
    const date = new Date(order.created_at).toLocaleString('es-CL');
    
    let itemsHtml = order.items.map(item => {
        const name = item.product ? item.product.name : 'Producto Eliminado';
        const sku = item.product ? item.product.sku : '-';
        const total = Math.round(item.price * item.quantity);
        return `
            <div style="display: flex; justify-content: space-between; margin-bottom: 0.3rem; border-bottom: 1px dashed #eee;">
                <div style="flex: 1;">
                    <span style="font-weight: bold;">${sku}</span><br>
                    <small>${name}</small>
                </div>
                <div style="text-align: right; min-width: 80px;">
                    ${item.quantity} x $${Math.round(item.price).toLocaleString('es-CL')}<br>
                    <strong>$${total.toLocaleString('es-CL')}</strong>
                </div>
            </div>
        `;
    }).join('');

    container.innerHTML = `
        <div style="text-align: center; margin-bottom: 1rem;">
            <h2 style="margin: 0; color: #C89680; font-family: 'Playfair Display', serif; font-weight: bold;">PROMESSE</h2>
            <p style="margin: 2px 0 0 0; font-size: 0.7rem; letter-spacing: 1.5px; font-weight: 600; color: #B57F69; text-transform: uppercase;">D E T A L L E S   Q U E   A B R I G A N</p>
            <p style="margin: 4px 0 0 0; font-size: 0.8rem; color: #666;">Comprobante de Venta</p>
        </div>
        <div style="margin-bottom: 1rem; border-top: 2px solid #C89680; border-bottom: 2px solid #C89680; padding: 0.5rem 0;">
            <p style="margin: 0;"><strong>Pedido:</strong> #${order.id}</p>
            <p style="margin: 0;"><strong>Fecha:</strong> ${date}</p>
            <p style="margin: 0;"><strong>Cliente:</strong> ${order.customer_name || 'Sin nombre'}</p>
            <p style="margin: 0;"><strong>Pago:</strong> ${order.payment_method || '-'}</p>
        </div>
        <div style="margin-bottom: 1rem;">
            ${itemsHtml}
        </div>
        <div style="border-top: 2px solid #C89680; padding-top: 0.5rem; display: flex; justify-content: space-between; font-size: 1.2rem; font-weight: bold; color: #3D2E28;">
            <span>TOTAL:</span>
            <span style="color: #C89680;">$${Math.round(order.total).toLocaleString('es-CL')}</span>
        </div>
        <div style="margin-top: 1.5rem; text-align: center; font-size: 0.8rem; color: #B57F69; font-style: italic;">
            <p>¡Gracias por preferir Promesse! Detalles que abrigan.</p>
        </div>
    `;

    document.getElementById('modal-backdrop').classList.remove('hidden');
    document.getElementById('receipt-modal').classList.remove('hidden');
}

function previewOrderPDFFromModal() {
    if (currentReceiptOrderId) {
        previewOrderPDF(currentReceiptOrderId);
    }
}
window.previewOrderPDFFromModal = previewOrderPDFFromModal;
window.submitRegularBankClose = submitRegularBankClose;

function closeModals() {
    currentEditOrderId = null;
    document.getElementById('modal-backdrop').classList.add('hidden');
    document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
}

// Image Uploader Helper
async function uploadPhoto(fileInput) {
    const file = fileInput.files[0];
    if (!file) return null;
    
    const formData = new FormData();
    formData.append("file", file);
    
    const res = await fetch(`${API_URL}/upload`, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${token}`
        },
        body: formData
    });
    
    if (res.status === 401) {
        document.getElementById('logout-btn').click();
        return null;
    }
    
    if (res.ok) {
        const data = await res.json();
        return data.url;
    }
    
    alert("Error al subir la imagen. Inténtalo de nuevo.");
    return null;
}

// Local previews for image inputs
document.getElementById('prod-edit-photo-file').addEventListener('change', function() {
    const file = this.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            document.getElementById('prod-edit-photo-preview').src = e.target.result;
            document.getElementById('prod-edit-photo-preview-container').classList.remove('hidden');
        }
        reader.readAsDataURL(file);
    }
});

document.getElementById('ing-photo-file').addEventListener('change', function() {
    const file = this.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            document.getElementById('ing-photo-preview').src = e.target.result;
            document.getElementById('ing-photo-preview-container').classList.remove('hidden');
        }
        reader.readAsDataURL(file);
    }
});

// Floating Image Zoom functionality
function zoomImage(src) {
    const overlay = document.getElementById('image-zoom-overlay');
    const img = document.getElementById('zoomed-image');
    if (!overlay || !img) return;
    img.src = src;
    overlay.classList.remove('hidden');
    setTimeout(() => {
        overlay.style.opacity = '1';
        img.style.transform = 'scale(1)';
    }, 10);
}
window.zoomImage = zoomImage;

function closeImageZoom() {
    const overlay = document.getElementById('image-zoom-overlay');
    const img = document.getElementById('zoomed-image');
    if (!overlay || !img) return;
    overlay.style.opacity = '0';
    img.style.transform = 'scale(0.9)';
    setTimeout(() => {
        overlay.classList.add('hidden');
    }, 300);
}
window.closeImageZoom = closeImageZoom;

// Maintenance & Export
async function exportProductsExcel() {
    try {
        const res = await fetch(`${API_URL}/products/export/excel`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'inventario_bodega.xlsx';
            document.body.appendChild(a);
            a.click();
            a.remove();
        } else {
            alert('Error al exportar Excel');
        }
    } catch (err) {
        console.error(err);
        alert('Error al conectar con el servidor');
    }
}

async function purgeMaintenance() {
    if (!confirm('¿Estás seguro de que deseas purgar los registros contabilizados con más de 1 mes de antigüedad? Esta acción no se puede deshacer.')) {
        return;
    }
    
    try {
        const res = await fetch(`${API_URL}/maintenance/purge-contabilizados`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (res.ok) {
            alert(`Purga completada:\nPedidos: ${data.orders_purged}\nInsumos: ${data.insumos_purged}\nIngresos: ${data.ingresos_purged}`);
            // Reload relevant views if active
            loadOrders();
            loadInsumos();
            loadIngresos();
            loadBankCloses();
        } else {
            alert('Error al realizar la purga: ' + (data.detail || 'Error desconocido'));
        }
    } catch (err) {
        console.error(err);
        alert('Error al conectar con el servidor');
    }
}

// Ventas Live logic
let currentVentasLiveStatus = 'pendientes';

function setVentasLiveFilter(status) {
    currentVentasLiveStatus = status;
    document.getElementById('tab-ventas-pendientes').classList.remove('active', 'outline-btn');
    document.getElementById('tab-ventas-pendientes').classList.add('outline-btn');
    document.getElementById('tab-ventas-contabilizados').classList.remove('active', 'outline-btn');
    document.getElementById('tab-ventas-contabilizados').classList.add('outline-btn');
    
    if (status === 'pendientes') {
        document.getElementById('tab-ventas-pendientes').classList.remove('outline-btn');
        document.getElementById('tab-ventas-pendientes').classList.add('active');
    } else {
        document.getElementById('tab-ventas-contabilizados').classList.remove('outline-btn');
        document.getElementById('tab-ventas-contabilizados').classList.add('active');
    }
    
    loadVentasLive();
}
window.setVentasLiveFilter = setVentasLiveFilter;

async function loadVentasLive() {
    const payment = document.getElementById('filter-ventas-payment').value;
    let url = `/orders?limit=100&is_live_sale=true`;
    if (payment !== 'all') url += `&payment_method=${payment}`;
    
    // We'll filter by status on the client side for simplicity if the backend doesn't support complex status grouping easily, 
    // but the backend DOES support &status=...
    if (currentVentasLiveStatus === 'Contabilizado') {
        url += `&status=Contabilizado`;
    }
    
    const res = await apiFetch(url);
    if (res && res.ok) {
        const data = await res.json();
        const tbody = document.querySelector('#ventas-live-table tbody');
        if (!tbody) return;
        
        // If "pendientes", we show everything except "Contabilizado"
        let items = data.items.filter(o => o.is_live_sale);
        if (currentVentasLiveStatus === 'pendientes') {
            items = items.filter(o => o.status !== 'Contabilizado');
        }
        
        tbody.innerHTML = items.map(o => {
            const date = new Date(o.created_at).toLocaleDateString('es-CL');
            
            // Reusing grouping logic from renderOrders
            const skusHtml = o.items.map(item => `<div style="padding: 4px 0; font-weight: 600; border-bottom: 1px dashed rgba(255,255,255,0.05);">${item.product ? item.product.sku : '-'}</div>`).join('');
            const namesHtml = o.items.map(item => `<div style="padding: 4px 0; border-bottom: 1px dashed rgba(255,255,255,0.05); text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 250px;" title="${item.product ? item.product.name : 'Producto Eliminado'}">${item.product ? item.product.name : 'Producto Eliminado'}</div>`).join('');
            const qtyHtml = o.items.map(item => `<div style="padding: 4px 0; border-bottom: 1px dashed rgba(255,255,255,0.05); font-weight: 500;">${item.quantity} ud</div>`).join('');
            
            const totalCommission = o.total_commission || 0;
            const totalTax = o.total_tax || 0;
            const totalProfit = o.total_real_profit || 0;
            
            const commissionVal = totalCommission > 0 ? `$${Math.round(totalCommission).toLocaleString('es-CL')}` : '-';
            const taxVal = totalTax > 0 ? `$${Math.round(totalTax).toLocaleString('es-CL')}` : '-';
            const profitVal = o.status === 'Pagado' ? `$${Math.round(totalProfit).toLocaleString('es-CL')}` : '-';
            const avgCost = o.items.length > 0 ? o.items.reduce((sum, item) => sum + item.cost_unit, 0) / o.items.length : 0;
            
            let statusClass = 'status-pendiente';
            if (o.status === 'Pagado') statusClass = 'status-pagado';
            else if (o.status === 'Contabilizado') statusClass = 'status-pagado';
            else if (o.status === 'Entregado') statusClass = 'status-entregado';
            else if (o.status === 'Preparado') statusClass = 'status-preparado';
            else if (o.status === 'Cancelado') statusClass = 'status-cancelado';

            return `
                <tr>
                    <td>#${o.id}</td>
                    <td><input type="checkbox" onchange="toggleClose('orders', ${o.id})" ${o.include_in_close ? 'checked' : ''} style="width: 20px; height: 20px; cursor: pointer; accent-color: var(--primary-color);"></td>
                    <td>${date}</td>
                    <td>${o.customer_name || 'Sin nombre'}</td>
                    <td>${skusHtml}</td>
                    <td>${namesHtml}</td>
                    <td>${qtyHtml}</td>
                    <td>$${Math.round(o.total).toLocaleString('es-CL')}</td>
                    <td><span style="font-weight: 500;">${o.payment_method !== '-' ? o.payment_method : '—'}</span></td>
                    <td>$${avgCost.toLocaleString('es-CL')}</td>
                    <td style="color: var(--success); font-weight: 600;">${profitVal}</td>
                    <td>${taxVal}</td>
                    <td>${commissionVal}</td>
                    <td>
                        <span class="status-badge ${statusClass}">
                            ${o.status}
                        </span>
                    </td>
                    <td>
                        <div style="display: flex; gap: 0.5rem; justify-content: center;">
                            <button class="btn outline-btn" style="padding:0.3rem 0.6rem; font-size:0.8rem; width: auto;" onclick="showReceiptModal(${o.id})" title="Ver Comprobante"><i class="fa-solid fa-receipt"></i> Ver</button>
                            <button class="btn outline-btn" style="padding:0.3rem 0.6rem; font-size:0.8rem; width: auto;" onclick="showStatusModal(${o.id}, '${o.status}', '${o.payment_method}')"><i class="fa-solid fa-exchange-alt"></i> Cambiar</button>
                            <button class="btn outline-btn" style="padding:0.3rem 0.6rem; font-size:0.8rem; width: auto;" onclick="showEditVentasLive(${o.id})"><i class="fa-solid fa-edit"></i> Editar</button>
                            <button class="btn outline-btn" style="padding:0.3rem 0.6rem; font-size:0.8rem; width: auto; color: var(--warning); border-color: rgba(239, 68, 68, 0.2);" onclick="deleteVentaLive(${o.id})"><i class="fa-solid fa-trash"></i> Borrar</button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    }
}
window.loadVentasLive = loadVentasLive;

async function deleteVentaLive(id) {
    if (!confirm('¿Estás seguro de que deseas eliminar esta venta live? Esto restaurará el stock de los productos.')) return;
    const res = await apiFetch(`/orders/${id}`, { method: 'DELETE' });
    if (res && res.ok) {
        loadVentasLive();
        loadProducts();
        loadDashboard();
    }
}
window.deleteVentaLive = deleteVentaLive;

function showEditVentasLive(orderId) {
    // We can reuse the existing order modal logic
    // But we need to make sure the data is loaded correctly.
    // If it's already in allOrders, we use it, otherwise we might need to fetch it.
    
    // For now, let's just use showEditOrderModal if it's in allOrders or window._dashboardData
    const order = allOrders.find(o => o.id === orderId) || (window._dashboardData ? window._dashboardData.ventas_live_pendientes.find(o => o.id === orderId) : null);
    
    if (order) {
        // We need the full order object with items
        // showEditOrderModal expects a full order.
        // If it's from dashboard, it might not have all items.
        // Let's fetch the full order to be sure.
        apiFetch(`/orders/${orderId}`).then(res => res.json()).then(fullOrder => {
            // Temporarily add to allOrders to avoid breaking showEditOrderModal logic
            if (!allOrders.find(o => o.id === orderId)) {
                allOrders.push(fullOrder);
            }
            showEditOrderModal(orderId);
        });
    } else {
        apiFetch(`/orders/${orderId}`).then(res => res.json()).then(fullOrder => {
            allOrders.push(fullOrder);
            showEditOrderModal(orderId);
        });
    }
}
window.showEditVentasLive = showEditVentasLive;

let pendingImportFile = null;

async function importSalesExcel(input) {
    if (!input.files || input.files.length === 0) return;
    pendingImportFile = input.files[0];
    
    const formData = new FormData();
    formData.append("file", pendingImportFile);
    
    showLoader();
    try {
        const res = await fetch(`${API_URL}/orders/import-excel-preview`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${token}`
            },
            body: formData
        });
        
        hideLoader();
        if (res.ok) {
            const data = await res.json();
            showImportPreview(data.orders);
        } else {
            const err = await res.json();
            alert("Error al procesar vista previa: " + (err.detail || "Error desconocido"));
        }
    } catch (err) {
        hideLoader();
        console.error(err);
        alert("Error de conexión al procesar vista previa.");
    } finally {
        input.value = "";
    }
}

function showImportPreview(orders) {
    const list = document.getElementById('import-preview-list');
    list.innerHTML = '';
    
    orders.forEach(order => {
        const orderEl = document.createElement('div');
        orderEl.style.border = '1px solid var(--border-color)';
        orderEl.style.borderRadius = '8px';
        orderEl.style.padding = '1rem';
        orderEl.style.background = 'var(--bg-color)';
        
        let itemsHtml = order.items.map(item => `
            <div style="display: flex; justify-content: space-between; font-size: 0.9rem; padding: 0.3rem 0; border-bottom: 1px dashed rgba(0,0,0,0.05);">
                <span><strong>${item.quantity}x</strong> ${item.name} <small style="color:var(--text-secondary)">(${item.sku})</small></span>
                <span>$${Math.round(item.total).toLocaleString('es-CL')}</span>
            </div>
        `).join('');
        
        orderEl.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.8rem; border-bottom: 1px solid rgba(0,0,0,0.1); padding-bottom: 0.5rem;">
                <span style="font-weight: 700; color: var(--primary-color);">${order.customer_name}</span>
                <span style="font-weight: 700; color: var(--success);">Total: $${Math.round(order.total).toLocaleString('es-CL')}</span>
            </div>
            <div>${itemsHtml}</div>
        `;
        list.appendChild(orderEl);
    });
    
    document.getElementById('import-preview-modal').classList.remove('hidden');
    document.getElementById('modal-backdrop').classList.remove('hidden');
    
    document.getElementById('confirm-import-btn').onclick = finalizeImport;
}

async function finalizeImport() {
    if (!pendingImportFile) return;
    
    const formData = new FormData();
    formData.append("file", pendingImportFile);
    
    closeModals();
    showLoader();
    
    try {
        const res = await fetch(`${API_URL}/orders/import-excel`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${token}`
            },
            body: formData
        });
        
        hideLoader();
        if (res.ok) {
            const data = await res.json();
            alert(data.message);
            loadVentasLive();
            loadDashboard();
            loadProducts(); // Update stock
        } else {
            const err = await res.json();
            alert("Error al importar: " + (err.detail || "Error desconocido"));
        }
    } catch (err) {
        hideLoader();
        console.error(err);
        alert("Error de conexión al importar.");
    } finally {
        pendingImportFile = null;
    }
}

window.importSalesExcel = importSalesExcel;

// Simple UI Loader
function showLoader() {
    let loader = document.getElementById('global-loader');
    if (!loader) {
        loader = document.createElement('div');
        loader.id = 'global-loader';
        loader.style.cssText = 'position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.5); z-index: 9999; display: flex; align-items: center; justify-content: center; color: white; font-size: 1.5rem; font-weight: bold;';
        loader.innerHTML = '<i class="fa-solid fa-spinner fa-spin" style="margin-right: 10px;"></i> Cargando...';
        document.body.appendChild(loader);
    }
    loader.style.display = 'flex';
}

function hideLoader() {
    const loader = document.getElementById('global-loader');
    if (loader) loader.style.display = 'none';
}


// ============================================================
// REPORTERÍA v2.0
// ============================================================

const REPORT_TABS = ['pedidos', 'insumos', 'ingresos', 'resumen'];
let currentReportTab = 'pedidos';
let reportData = {};
let pendingDelete = null;

function switchReportTab(tab) {
    currentReportTab = tab;
    document.querySelectorAll('.tab-btn').forEach((btn, idx) => {
        btn.classList.toggle('active', REPORT_TABS[idx] === tab);
    });
    document.querySelectorAll('.report-tab').forEach(el => {
        const matches = el.id === `report-tab-${tab}`;
        el.classList.toggle('hidden', !matches);
    });
}

async function fetchReportJson(url) {
    const res = await apiFetch(url);
    if (!res || !res.ok) {
        let detail = res ? `HTTP ${res.status}` : 'sin respuesta';
        try { const err = await res.json(); if (err.detail) detail = err.detail; } catch (e) {}
        throw new Error(detail);
    }
    return res.json();
}

async function loadReportData() {
    const dateFrom = document.getElementById('report-date-from').value;
    const dateTo = document.getElementById('report-date-to').value;

    if (!dateFrom || !dateTo) {
        alert('Selecciona un rango de fechas (Desde / Hasta)');
        return;
    }

    // Collect status filters for pedidos
    const selectedStatuses = Array.from(
        document.querySelectorAll('.status-filter:checked')
    ).map(cb => cb.value).join(',');

    try {
        // Pedidos archivados
        const ordersParams = new URLSearchParams({ date_from: dateFrom, date_to: dateTo });
        if (selectedStatuses) ordersParams.set('statuses', selectedStatuses);
        const ordersRes = await fetchReportJson(`/reports/orders?${ordersParams}`);
        reportData.orders = ordersRes;
        displayReportPedidos();

        // Insumos
        const insumosRes = await fetchReportJson(`/reports/insumos?date_from=${dateFrom}&date_to=${dateTo}`);
        reportData.insumos = insumosRes;
        displayReportInsumos();

        // Ingresos
        const ingresosRes = await fetchReportJson(`/reports/ingresos?date_from=${dateFrom}&date_to=${dateTo}`);
        reportData.ingresos = ingresosRes;
        displayReportIngresos();

        // Resumen
        const summaryRes = await fetchReportJson(`/reports/summary?date_from=${dateFrom}&date_to=${dateTo}`);
        reportData.summary = summaryRes;
        displayReportResumen();

        console.log('✅ Reportería cargada');
    } catch (err) {
        console.error('Error reportería:', err);
        alert('Error al cargar reportes: ' + err.message);
    }
}

function displayReportPedidos() {
    const tbody = document.getElementById('report-pedidos-tbody');
    tbody.innerHTML = '';
    const orders = reportData.orders?.items || [];

    const bar = document.getElementById('report-summary-bar-pedidos');
    bar.innerHTML = `<span>📦 ${orders.length} pedidos</span><span>💰 Total: $${(reportData.orders?.total_revenue || 0).toLocaleString('es-CL')}</span>`;

    if (orders.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-secondary);">Sin datos para el período</td></tr>';
        return;
    }
    orders.forEach(o => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>#${o.id}</td>
            <td>${o.customer_name}</td>
            <td><span class="status-badge">${o.status}</span></td>
            <td>$${(o.total || 0).toLocaleString('es-CL')}</td>
            <td>${o.payment_method || '-'}</td>
            <td>${o.created_at ? new Date(o.created_at).toLocaleDateString('es-CL') : '-'}</td>
            <td>${o.close_period || '-'}</td>
        `;
        tbody.appendChild(row);
    });
}

function displayReportInsumos() {
    const tbody = document.getElementById('report-insumos-tbody');
    tbody.innerHTML = '';
    const insumos = reportData.insumos?.items || [];

    const bar = document.getElementById('report-summary-bar-insumos');
    bar.innerHTML = `<span>🛒 ${insumos.length} insumos</span><span>💰 Total Costo: $${(reportData.insumos?.total_cost || 0).toLocaleString('es-CL')}</span>`;

    if (insumos.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-secondary);">Sin datos para el período</td></tr>';
        return;
    }
    insumos.forEach(i => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>#${i.id}</td>
            <td>${i.item}</td>
            <td>${i.sku || '-'}</td>
            <td>$${(i.cost || 0).toLocaleString('es-CL')}</td>
            <td>${i.payment_type}</td>
            <td>${i.date ? new Date(i.date).toLocaleDateString('es-CL') : '-'}</td>
            <td>${i.close_period || '-'}</td>
        `;
        tbody.appendChild(row);
    });
}

function displayReportIngresos() {
    const tbody = document.getElementById('report-ingresos-tbody');
    tbody.innerHTML = '';
    const ingresos = reportData.ingresos?.items || [];

    const bar = document.getElementById('report-summary-bar-ingresos');
    bar.innerHTML = `<span>💵 ${ingresos.length} ingresos</span><span>💰 Total: $${(reportData.ingresos?.total || 0).toLocaleString('es-CL')}</span>`;

    if (ingresos.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-secondary);">Sin datos para el período</td></tr>';
        return;
    }
    ingresos.forEach(i => {
        const total = (i.quantity || 0) * (i.final_price || 0);
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>#${i.id}</td>
            <td>${i.sku}</td>
            <td>${i.name}</td>
            <td>${i.quantity}</td>
            <td>$${(i.cost || 0).toLocaleString('es-CL')}</td>
            <td>$${(i.final_price || 0).toLocaleString('es-CL')}</td>
            <td>$${total.toLocaleString('es-CL')}</td>
            <td>${i.date ? new Date(i.date).toLocaleDateString('es-CL') : '-'}</td>
        `;
        tbody.appendChild(row);
    });
}

function displayReportResumen() {
    const s = reportData.summary?.summary || {};
    document.getElementById('summary-revenue').textContent = `$${(s.total_revenue_orders || 0).toLocaleString('es-CL')}`;
    document.getElementById('summary-cost').textContent = `$${(s.total_cost_orders || 0).toLocaleString('es-CL')}`;
    document.getElementById('summary-profit').textContent = `$${(s.total_profit_orders || 0).toLocaleString('es-CL')}`;
    document.getElementById('summary-insumos').textContent = `$${(s.total_insumos_cost || 0).toLocaleString('es-CL')}`;
    document.getElementById('summary-ingresos').textContent = `$${(s.total_ingresos || 0).toLocaleString('es-CL')}`;
    document.getElementById('summary-neto').textContent = `$${(s.net_profit || 0).toLocaleString('es-CL')}`;
}

function exportReportExcel() {
    let data = [];

    if (currentReportTab === 'pedidos') {
        data = (reportData.orders?.items || []).map(o => ({
            ID: o.id, Cliente: o.customer_name, Estado: o.status,
            Total: o.total, 'Método Pago': o.payment_method,
            Fecha: o.created_at ? new Date(o.created_at).toLocaleDateString('es-CL') : '-',
            Período: o.close_period
        }));
    } else if (currentReportTab === 'insumos') {
        data = (reportData.insumos?.items || []).map(i => ({
            ID: i.id, Item: i.item, SKU: i.sku, Costo: i.cost,
            'Tipo Pago': i.payment_type,
            Fecha: i.date ? new Date(i.date).toLocaleDateString('es-CL') : '-',
            Período: i.close_period
        }));
    } else if (currentReportTab === 'ingresos') {
        data = (reportData.ingresos?.items || []).map(i => ({
            ID: i.id, SKU: i.sku, Nombre: i.name, Cantidad: i.quantity,
            'Costo Unit.': i.cost, 'Precio Final': i.final_price,
            Total: (i.quantity || 0) * (i.final_price || 0),
            Fecha: i.date ? new Date(i.date).toLocaleDateString('es-CL') : '-'
        }));
    } else if (currentReportTab === 'resumen') {
        const s = reportData.summary?.summary || {};
        data = [
            { Concepto: 'Ingresos Órdenes', Monto: s.total_revenue_orders || 0 },
            { Concepto: 'Costo Órdenes', Monto: s.total_cost_orders || 0 },
            { Concepto: 'Ganancia Bruta', Monto: s.total_profit_orders || 0 },
            { Concepto: 'Insumos', Monto: s.total_insumos_cost || 0 },
            { Concepto: 'Ingresos Adicionales', Monto: s.total_ingresos || 0 },
            { Concepto: 'Ganancia Neta', Monto: s.net_profit || 0 }
        ];
    }

    if (!data.length) {
        alert('Carga datos primero con el botón Filtrar');
        return;
    }

    if (window.XLSX) {
        const ws = XLSX.utils.json_to_sheet(data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, currentReportTab);
        XLSX.writeFile(wb, `reporte_${currentReportTab}_${new Date().toISOString().split('T')[0]}.xlsx`);
    } else {
        // Load XLSX dynamically if not present
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.min.js';
        script.onload = () => exportReportExcel();
        document.head.appendChild(script);
    }
}

function showDeleteConfirm() {
    const dateFrom = document.getElementById('report-date-from').value;
    const dateTo = document.getElementById('report-date-to').value;

    if (!dateFrom || !dateTo) {
        alert('Selecciona rango de fechas primero');
        return;
    }

    let count = 0;
    if (currentReportTab === 'pedidos') count = (reportData.orders?.items || []).length;
    else if (currentReportTab === 'insumos') count = (reportData.insumos?.items || []).length;
    else if (currentReportTab === 'ingresos') count = (reportData.ingresos?.items || []).length;
    else {
        alert('No aplica borrado masivo en la pestaña Resumen. Selecciona otra.');
        return;
    }

    document.getElementById('delete-count').textContent = count;
    document.getElementById('delete-type').textContent = currentReportTab;

    pendingDelete = { data_type: currentReportTab, date_from: dateFrom, date_to: dateTo };

    document.getElementById('delete-confirm-modal').classList.remove('hidden');
    document.getElementById('delete-confirm-overlay').classList.remove('hidden');
    document.getElementById('delete-confirm-modal').style.zIndex = '1000';
    document.getElementById('delete-confirm-modal').style.position = 'fixed';
    document.getElementById('delete-confirm-modal').style.top = '50%';
    document.getElementById('delete-confirm-modal').style.left = '50%';
    document.getElementById('delete-confirm-modal').style.transform = 'translate(-50%, -50%)';
}

async function confirmDelete() {
    if (!pendingDelete) return;

    try {
        const params = new URLSearchParams(pendingDelete);
        const delRes = await apiFetch(`/reports/delete-bulk?${params}`, { method: 'POST' });
        const result = delRes ? await delRes.json() : { detail: 'Sin respuesta del servidor' };

        if (result.success) {
            alert(`✅ ${result.deleted_count} registros de "${result.data_type}" eliminados.`);
            loadReportData();
        } else {
            alert('Error: ' + (result.detail || 'Error desconocido'));
        }
    } catch (err) {
        console.error('Error borrado masivo:', err);
        alert('Error al borrar: ' + err.message);
    }
    cancelDelete();
}

function cancelDelete() {
    pendingDelete = null;
    document.getElementById('delete-confirm-modal').classList.add('hidden');
    document.getElementById('delete-confirm-overlay').classList.add('hidden');
}
