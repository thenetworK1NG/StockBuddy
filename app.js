/* ============================================================
   app.js — Budologist Stock Management PWA
   ============================================================ */

/* ─── State ──────────────────────────────────────────────── */
let allStock         = [];
let allSales         = [];
let stockIcons       = [];   /* loaded from icons/icons.json */
let inventoryFilter  = 'all';
let inventorySearch  = '';   /* live name search */
let filterLowStock   = false;
let filterPerGram    = false;
let filterStrain     = 'all';
let filterTag        = 'all';
let sellFilter       = 'all';
let selectedIcon     = null;   /* add-item form */
let editSelectedIcon = null;   /* edit modal */
let selectedSellItem = null;   /* sell step 2 */
let deferredInstall  = null;

/* ─── PWA Install ────────────────────────────────────────── */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(err =>
      console.warn('SW registration failed:', err)
    );
  });
}

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredInstall = e;
  document.getElementById('installBtn').hidden = false;
});

window.addEventListener('appinstalled', () => {
  document.getElementById('installBtn').hidden = true;
  deferredInstall = null;
});

document.getElementById('installBtn').addEventListener('click', async () => {
  if (!deferredInstall) return;
  deferredInstall.prompt();
  const { outcome } = await deferredInstall.userChoice;
  if (outcome === 'accepted') document.getElementById('installBtn').hidden = true;
  deferredInstall = null;
});

/* ─── Helpers ────────────────────────────────────────────── */
function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function fmt(num) {
  return 'R\u202f' + Number(num || 0).toLocaleString('en-ZA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function fmtDate(date) {
  if (!date) return '—';
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' });
}

function fmtQty(qty, unit) {
  const n = Number(qty || 0);
  const q = n % 1 === 0 ? String(n) : n.toFixed(2);
  return unit ? `${q} ${unit}` : q;
}

function iconSrc(icon) {
  return (icon && icon !== 'none') ? `icons/${icon}.png` : null;
}

function catLabel(cat) {
  return { weed: 'Weed', edibles: 'Edibles', vapes: 'Vapes' }[cat] || cat;
}

const TAG_LABELS = {
  'tunnel':            'Tunnel',
  'indoor':            'Indoor',
  'exotic-greenhouse': 'Exotic GH',
  'greenhouse':        'Greenhouse',
  'outdoor':           'Outdoor'
};

function renderTagBadges(tags) {
  if (!tags || typeof tags !== 'object') return '';
  return Object.keys(tags)
    .filter(k => tags[k])
    .map(k => `<span class="tag-badge tag-${esc(k)}">${esc(TAG_LABELS[k] || k)}</span>`)
    .join('');
}

/* ─── Toast ──────────────────────────────────────────────── */
let toastTimer;
function showToast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast ${type} show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

/* ─── Icon Registry ──────────────────────────────────────── */

/**
 * Fetch icons/icons.json and cache the list in stockIcons.
 * To add a new icon: drop the PNG into stock/icons/ and add
 * a line to icons.json — no code changes needed.
 */
async function loadIcons() {
  try {
    const res  = await fetch('icons/icons.json');
    stockIcons = await res.json();
  } catch (err) {
    console.warn('Could not load icons.json, falling back to empty list', err);
    stockIcons = [];
  }
}

/**
 * Build (or rebuild) an icon picker inside `containerId`.
 * @param {string}      containerId  — 'iconPicker' or 'editIconPicker'
 * @param {boolean}     isEdit       — true = use data-edit-icon attr
 * @param {string|null} currentValue — icon id that should start selected
 */
function buildIconPicker(containerId, isEdit, currentValue) {
  const container = document.getElementById(containerId);
  const attr      = isEdit ? 'edit-icon' : 'icon';

  container.innerHTML = `
    <button type="button" class="icon-opt${!currentValue ? ' selected' : ''}"
            data-${attr}="none" aria-label="No icon">
      <span class="icon-none-label">None</span>
    </button>
    ${stockIcons.map(icon => `
    <button type="button" class="icon-opt${currentValue === icon.id ? ' selected' : ''}"
            data-${attr}="${esc(icon.id)}" aria-label="${esc(icon.label)} icon">
      <img src="icons/${esc(icon.file)}" alt="${esc(icon.label)}">
    </button>`).join('')}`;

  /* Single delegated listener — overwrite any previous one */
  container.onclick = e => {
    const btn = e.target.closest('.icon-opt');
    if (!btn) return;
    container.querySelectorAll('.icon-opt').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    const val = isEdit ? btn.dataset.editIcon : btn.dataset.icon;
    if (isEdit) {
      editSelectedIcon = (val === 'none') ? null : val;
    } else {
      selectedIcon = (val === 'none') ? null : val;
    }
  };
}

/* ─── Sale Animation ─────────────────────────────────────── */
let saleAnimTimer;

function playSaleAnimation(item, qty, total) {
  const overlay = document.getElementById('saleAnim');
  overlay.hidden = false;

  const src = iconSrc(item.icon);

  /* Build HTML */
  overlay.innerHTML = `
    <div class="sale-anim-ring"></div>
    <div class="sale-anim-ring"></div>
    <div class="sale-anim-ring"></div>
    <div class="sale-anim-icon-wrap">
      <div class="sale-anim-icon-box">
        ${src
          ? `<img src="${esc(src)}" alt="${esc(item.name)}">`
          : `<div class="sale-anim-icon-placeholder">📦</div>`}
      </div>
      <div class="sale-anim-text">
        <div class="sale-anim-name">${esc(item.name)}</div>
        <div class="sale-anim-qty">${esc(fmtQty(qty, item.unit))} sold</div>
        <div class="sale-anim-total">${esc(fmt(total))}</div>
      </div>
    </div>`;

  /* Spawn particles in a circle */
  const count = 14;
  for (let i = 0; i < count; i++) {
    const p    = document.createElement('div');
    p.className = 'sale-particle';
    const angle  = (i / count) * 360;
    const dist   = 120 + Math.random() * 80;
    const rad    = (angle * Math.PI) / 180;
    const tx     = Math.cos(rad) * dist;
    const ty     = Math.sin(rad) * dist;
    const size   = 5 + Math.random() * 7;
    const delay  = 0.05 + Math.random() * 0.18;
    const dur    = 0.8 + Math.random() * 0.5;
    const hue    = Math.random() > 0.5 ? '#3ecf6e' : '#22d3ee';
    p.style.cssText = `
      width:${size}px; height:${size}px;
      background:${hue};
      --p-to: translate(${tx}px, ${ty}px);
      animation-duration:${dur}s;
      animation-delay:${delay}s;`;
    overlay.appendChild(p);
  }

  /* Auto-dismiss after animation */
  clearTimeout(saleAnimTimer);
  saleAnimTimer = setTimeout(() => {
    overlay.hidden = true;
    overlay.innerHTML = '';
  }, 2800);
}

/* ─── Tab Navigation ─────────────────────────────────────── */
function switchTab(name) {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    const active = btn.dataset.tab === name;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll('.tab-section').forEach(sec => {
    sec.classList.toggle('active', sec.id === name);
  });
  if (name === 'inventory') loadAndRenderStock();
  if (name === 'sell')      renderSellGrid();
  if (name === 'history')   loadAndRenderSales();
}

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

/* ─── Inventory: Load & Render ───────────────────────────── */
async function loadAndRenderStock() {
  const loader = document.getElementById('inventoryLoader');
  loader.hidden = false;
  try {
    allStock = await getAllStock();
    renderInventory();
  } catch (err) {
    console.error(err);
    showToast('Failed to load stock', 'error');
  } finally {
    loader.hidden = true;
  }
}

function renderInventory() {
  const grid    = document.getElementById('stockGrid');
  const empty   = document.getElementById('inventoryEmpty');
  const summary = document.getElementById('summaryBar');

  let filtered = inventoryFilter === 'all'
    ? [...allStock]
    : allStock.filter(i => i.category === inventoryFilter);

  /* Name search */
  if (inventorySearch) {
    const q = inventorySearch;
    filtered = filtered.filter(i => i.name.toLowerCase().includes(q));
  }

  /* Low stock toggle (qty > 0 and <= 5) */
  if (filterLowStock) {
    filtered = filtered.filter(i => i.quantity > 0 && i.quantity <= 5);
  }

  /* Per-gram toggle */
  if (filterPerGram) {
    filtered = filtered.filter(i => i.unit === 'g');
  }

  /* Strain filter */
  if (filterStrain !== 'all') {
    filtered = filtered.filter(i => i.strain === filterStrain);
  }

  /* Tag filter */
  if (filterTag !== 'all') {
    filtered = filtered.filter(i => i.tags && i.tags[filterTag]);
  }

  if (filtered.length === 0) {
    grid.innerHTML = '';
    empty.hidden   = false;
    summary.hidden = true;
    return;
  }

  empty.hidden   = false;
  summary.hidden = false;
  empty.hidden   = true;

  /* Summary */
  const totalValue = filtered.reduce((s, i) => s + i.quantity * i.price, 0);
  document.getElementById('summaryCount').textContent = filtered.length;
  document.getElementById('summaryValue').textContent = fmt(totalValue);

  grid.innerHTML = filtered.map(item => {
    const src      = iconSrc(item.icon);
    const lowStock = item.quantity > 0 && item.quantity <= 5;
    const noStock  = item.quantity <= 0;

    return `
      <div class="stock-card cat-${esc(item.category)}">
        <div class="card-icon-area">
          ${src
            ? `<img src="${esc(src)}" alt="${esc(item.name)}" class="card-icon-img">`
            : `<div class="card-icon-placeholder"></div>`}
        </div>
        <div class="card-body">
          <div class="card-top">
            <span class="card-name">${esc(item.name)}</span>
            <span class="cat-badge cat-${esc(item.category)}">${esc(catLabel(item.category))}</span>
          </div>
          ${item.strain ? `<div class="card-meta"><span class="strain-badge strain-${esc(item.strain)}">${esc(item.strain.charAt(0).toUpperCase() + item.strain.slice(1))}</span></div>` : ''}
          ${renderTagBadges(item.tags) ? `<div class="card-tags">${renderTagBadges(item.tags)}</div>` : ''}
          <div class="card-qty${lowStock ? ' qty-low' : ''}${noStock ? ' qty-low' : ''}">
            <span class="qty-num">${esc(String(item.quantity % 1 === 0 ? item.quantity : item.quantity.toFixed(2)))}</span>
            ${item.unit ? `<span class="qty-unit">${esc(item.unit)}</span>` : ''}
            ${item.gramsInfo ? `<span class="qty-grams-info">${esc(item.gramsInfo)}</span>` : ''}
            ${lowStock && !noStock ? '<span class="qty-low-badge">Low</span>' : ''}
            ${noStock ? '<span class="qty-low-badge" style="background:var(--danger-bg);color:var(--danger)">Out</span>' : ''}
          </div>
          ${item.price ? `<div class="card-price">${esc(fmt(item.price))} ${item.unit ? `/ ${esc(item.unit)}` : ''}</div>` : ''}
          <div class="card-actions">
            <button class="card-btn btn-adj btn-minus" data-id="${esc(item.id)}" data-delta="-1" aria-label="Remove 1">−</button>
            <button class="card-btn btn-adj btn-plus"  data-id="${esc(item.id)}" data-delta="1"  aria-label="Add 1">+</button>
            <button class="card-btn btn-edit" data-id="${esc(item.id)}" aria-label="Edit item">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
            <button class="card-btn btn-del" data-id="${esc(item.id)}" data-name="${esc(item.name)}" aria-label="Delete item">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                <path d="M10 11v6"/><path d="M14 11v6"/>
                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
              </svg>
            </button>
          </div>
        </div>
      </div>`;
  }).join('');

  /* Bind card buttons */
  grid.querySelectorAll('.btn-adj').forEach(btn => {
    btn.addEventListener('click', () =>
      handleAdjust(btn.dataset.id, Number(btn.dataset.delta))
    );
  });
  grid.querySelectorAll('.btn-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = allStock.find(i => i.id === btn.dataset.id);
      if (item) openEditModal(item);
    });
  });
  grid.querySelectorAll('.btn-del').forEach(btn => {
    btn.addEventListener('click', () => handleDeleteItem(btn.dataset.id, btn.dataset.name));
  });
}

/* ─── Inventory: Category Filter ────────────────────────── */
document.querySelectorAll('[data-cat]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-cat]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    inventoryFilter = btn.dataset.cat;
    renderInventory();
  });
});
/* Search */
document.getElementById('stockSearch').addEventListener('input', e => {
  inventorySearch = e.target.value.trim().toLowerCase();
  renderInventory();
});

/* Low stock toggle */
document.getElementById('filterLowBtn').addEventListener('click', () => {
  filterLowStock = !filterLowStock;
  document.getElementById('filterLowBtn').classList.toggle('active', filterLowStock);
  renderInventory();
});

/* Per-gram toggle */
document.getElementById('filterGramBtn').addEventListener('click', () => {
  filterPerGram = !filterPerGram;
  document.getElementById('filterGramBtn').classList.toggle('active', filterPerGram);
  renderInventory();
});

/* Strain filter */
document.querySelectorAll('.strain-filter').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.strain-filter').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    filterStrain = btn.dataset.strain;
    renderInventory();
  });
});

/* Tag filter */
document.querySelectorAll('.tag-filter').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tag-filter').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    filterTag = btn.dataset.tag;
    renderInventory();
  });
});

/* Search clear button */
const _searchInput = document.getElementById('stockSearch');
const _searchClear = document.getElementById('searchClearBtn');
_searchInput.addEventListener('input', () => {
  _searchClear.hidden = _searchInput.value === '';
});
_searchClear.addEventListener('click', () => {
  _searchInput.value = '';
  _searchClear.hidden = true;
  inventorySearch = '';
  renderInventory();
});

/* Grams info row visibility — add form */
document.getElementById('itemHasGrams').addEventListener('change', function () {
  document.getElementById('itemGramsInfoRow').hidden = !this.checked;
  if (!this.checked) document.getElementById('itemGramsInfo').value = '';
});

/* Grams info row visibility — edit modal */
document.getElementById('editHasGrams').addEventListener('change', function () {
  document.getElementById('editGramsInfoRow').hidden = !this.checked;
  if (!this.checked) document.getElementById('editGramsInfo').value = '';
});
/* ─── Inventory: Adjust Quantity ─────────────────────────── */
async function handleAdjust(id, delta) {
  try {
    await adjustStockQuantity(id, delta);
    /* Update local cache without full reload */
    const item = allStock.find(i => i.id === id);
    if (item) item.quantity = Math.max(0, item.quantity + delta);
    renderInventory();
  } catch (err) {
    console.error(err);
    showToast('Failed to update quantity', 'error');
  }
}

/* ─── Inventory: Delete Item ─────────────────────────────── */
async function handleDeleteItem(id, name) {
  if (!confirm(`Delete "${name}" from stock? This cannot be undone.`)) return;
  try {
    await deleteStockItem(id);
    allStock = allStock.filter(i => i.id !== id);
    renderInventory();
    showToast(`"${name}" removed`);
  } catch (err) {
    console.error(err);
    showToast('Failed to delete item', 'error');
  }
}

/* ─── Add Item Form ──────────────────────────────────────── */

document.getElementById('itemForm').addEventListener('submit', async e => {
  e.preventDefault();

  const nameVal = document.getElementById('itemName').value.trim();
  const qtyVal  = document.getElementById('itemQty').value;
  if (!nameVal)      { showToast('Please enter an item name', 'error'); return; }
  if (qtyVal === '')  { showToast('Please enter a quantity', 'error'); return; }

  const submitBtn = document.getElementById('itemSubmitBtn');
  submitBtn.disabled    = true;
  submitBtn.textContent = 'Saving…';

  const tagMap = {};
  document.querySelectorAll('input[name="tag"]:checked').forEach(cb => { tagMap[cb.value] = true; });

  const data = {
    name:      nameVal,
    category:  document.querySelector('input[name="category"]:checked').value,
    strain:    document.querySelector('input[name="strain"]:checked')?.value || null,
    quantity:  qtyVal,
    hasGrams:  document.getElementById('itemHasGrams').checked,
    gramsInfo: document.getElementById('itemHasGrams').checked
                 ? (document.getElementById('itemGramsInfo').value.trim() || null)
                 : null,
    price:     document.getElementById('itemPrice').value || 0,
    icon:      selectedIcon,
    tags:      tagMap
  };

  try {
    await addStockItem(data);
    showToast(`"${data.name}" added to stock`);
    document.getElementById('itemForm').reset();
    document.getElementById('itemHasGrams').checked = false;
    document.getElementById('itemGramsInfoRow').hidden = true;
    document.getElementById('itemGramsInfo').value = '';
    document.querySelectorAll('input[name="tag"]').forEach(cb => cb.checked = false);
    /* Reset icon picker to 'None' */
    selectedIcon = null;
    buildIconPicker('iconPicker', false, null);
    /* Refresh and switch to inventory */
    allStock = await getAllStock();
    switchTab('inventory');
  } catch (err) {
    console.error(err);
    showToast('Failed to add item', 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <line x1="12" y1="5" x2="12" y2="19"/>
        <line x1="5" y1="12" x2="19" y2="12"/>
      </svg>
      Add to Stock`;
  }
});

/* ─── Edit Modal ─────────────────────────────────────────── */
function openEditModal(item) {
  document.getElementById('editName').value  = item.name;
  document.getElementById('editQty').value   = item.quantity;
  document.getElementById('editHasGrams').checked = item.unit === 'g';
  document.getElementById('editGramsInfoRow').hidden = item.unit !== 'g';
  document.getElementById('editGramsInfo').value = (item.unit === 'g' && item.gramsInfo) ? item.gramsInfo : '';
  document.getElementById('editPrice').value = item.price || '';
  document.getElementById('editItemId').value = item.id;

  /* Category */
  const catRadio = document.querySelector(`input[name="editCategory"][value="${item.category}"]`);
  if (catRadio) catRadio.checked = true;

  /* Strain */
  const strainVal   = item.strain || '';
  const strainRadio = document.querySelector(`input[name="editStrain"][value="${strainVal}"]`);
  if (strainRadio) strainRadio.checked = true;

  /* Tags */
  const tags = item.tags || {};
  document.querySelectorAll('input[name="editTag"]').forEach(cb => {
    cb.checked = !!tags[cb.value];
  });

  /* Icon */
  editSelectedIcon = item.icon || null;
  buildIconPicker('editIconPicker', true, editSelectedIcon);

  document.getElementById('editModal').hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeEditModal() {
  document.getElementById('editModal').hidden = true;
  document.body.style.overflow = '';
}

document.getElementById('closeEditModal').addEventListener('click', closeEditModal);
document.getElementById('editModal').addEventListener('click', e => {
  if (e.target === document.getElementById('editModal')) closeEditModal();
});

/* Edit icon picker is built dynamically in openEditModal via buildIconPicker() */

document.getElementById('editForm').addEventListener('submit', async e => {
  e.preventDefault();

  const id   = document.getElementById('editItemId').value;
  const editTagMap = {};
  document.querySelectorAll('input[name="editTag"]:checked').forEach(cb => { editTagMap[cb.value] = true; });
  const data = {
    name:      document.getElementById('editName').value.trim(),
    category:  document.querySelector('input[name="editCategory"]:checked').value,
    strain:    document.querySelector('input[name="editStrain"]:checked')?.value || null,
    quantity:  Number(document.getElementById('editQty').value),
    hasGrams:  document.getElementById('editHasGrams').checked,
    gramsInfo: document.getElementById('editHasGrams').checked
                 ? (document.getElementById('editGramsInfo').value.trim() || null)
                 : null,
    price:     Number(document.getElementById('editPrice').value) || 0,
    icon:      editSelectedIcon,
    tags:      editTagMap
  };

  if (!data.name) { showToast('Please enter an item name', 'error'); return; }

  const submitBtn = document.getElementById('editSubmitBtn');
  submitBtn.disabled    = true;
  submitBtn.textContent = 'Saving…';

  try {
    await updateStockItem(id, data);
    closeEditModal();
    showToast('Item updated');
    allStock = await getAllStock();
    renderInventory();
  } catch (err) {
    console.error(err);
    showToast('Failed to save changes', 'error');
  } finally {
    submitBtn.disabled    = false;
    submitBtn.textContent = 'Save Changes';
  }
});

/* ─── Sell Tab ───────────────────────────────────────────── */
function renderSellGrid() {
  const grid  = document.getElementById('sellItemGrid');
  const empty = document.getElementById('sellEmpty');

  if (allStock.length === 0) {
    grid.innerHTML  = '';
    empty.hidden    = false;
    return;
  }
  empty.hidden = true;

  const filtered = sellFilter === 'all'
    ? allStock
    : allStock.filter(i => i.category === sellFilter);

  grid.innerHTML = filtered.map(item => {
    const src         = iconSrc(item.icon);
    const outOfStock  = item.quantity <= 0;
    const lowStock    = item.quantity > 0 && item.quantity <= 5;

    return `
      <div class="stock-card sell-card cat-${esc(item.category)}${outOfStock ? ' out-of-stock' : ''}"
           data-sell-id="${esc(item.id)}"
           ${outOfStock ? '' : 'role="button" tabindex="0"'}
           aria-label="${esc(item.name)}">
        <div class="card-icon-area">
          ${src
            ? `<img src="${esc(src)}" alt="${esc(item.name)}" class="card-icon-img">`
            : `<div class="card-icon-placeholder"></div>`}
        </div>
        <div class="card-body">
          <div class="card-top">
            <span class="card-name">${esc(item.name)}</span>
            <span class="cat-badge cat-${esc(item.category)}">${esc(catLabel(item.category))}</span>
          </div>
          ${item.strain ? `<div class="card-meta"><span class="strain-badge strain-${esc(item.strain)}">${esc(item.strain.charAt(0).toUpperCase() + item.strain.slice(1))}</span></div>` : ''}
          ${renderTagBadges(item.tags) ? `<div class="card-tags">${renderTagBadges(item.tags)}</div>` : ''}
          <div class="card-qty${lowStock ? ' qty-low' : ''}${outOfStock ? ' qty-low' : ''}">
            <span class="qty-num">${esc(String(item.quantity % 1 === 0 ? item.quantity : item.quantity.toFixed(2)))}</span>
            ${item.unit ? `<span class="qty-unit">${esc(item.unit)}</span>` : ''}
            ${item.gramsInfo ? `<span class="qty-grams-info">${esc(item.gramsInfo)}</span>` : ''}
            ${lowStock && !outOfStock ? '<span class="qty-low-badge">Low</span>' : ''}
          </div>
          ${item.price ? `<div class="card-price">${esc(fmt(item.price))} ${item.unit ? `/ ${esc(item.unit)}` : ''}</div>` : ''}
          ${outOfStock ? '<div class="out-of-stock-label">Out of Stock</div>' : ''}
        </div>
      </div>`;
  }).join('');

  grid.querySelectorAll('.sell-card:not(.out-of-stock)').forEach(card => {
    const activate = () => {
      const item = allStock.find(i => i.id === card.dataset.sellId);
      if (item && item.quantity > 0) selectSellItem(item);
    };
    card.addEventListener('click', activate);
    card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') activate(); });
  });
}

/* Sell: category filter */
document.querySelectorAll('[data-sell-cat]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-sell-cat]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    sellFilter = btn.dataset.sellCat;
    renderSellGrid();
  });
});

function selectSellItem(item) {
  selectedSellItem = item;

  const src = iconSrc(item.icon);
  document.getElementById('sellSelectedCard').innerHTML = `
    <div class="selected-item-card">
      ${src ? `<img src="${esc(src)}" class="selected-item-icon" alt="">` : ''}
      <div>
        <div class="selected-item-name">${esc(item.name)}</div>
        <div class="selected-item-meta">
          <span class="cat-badge cat-${esc(item.category)}">${esc(catLabel(item.category))}</span>
          ${item.strain ? `<span class="strain-badge strain-${esc(item.strain)}">${esc(item.strain.charAt(0).toUpperCase() + item.strain.slice(1))}</span>` : ''}
          ${renderTagBadges(item.tags)}
          <span>${esc(fmtQty(item.quantity, item.unit))} in stock</span>
          ${item.price ? `<span>${esc(fmt(item.price))} ${item.unit ? `/ ${esc(item.unit)}` : ''}</span>` : ''}
        </div>
      </div>
    </div>`;

  document.getElementById('sellQty').max   = item.quantity;
  document.getElementById('sellQty').value = '';
  document.getElementById('totalPreview').textContent = 'R\u202f0.00';
  document.getElementById('sellNote').value = '';

  document.getElementById('sellStep1').hidden = true;
  document.getElementById('sellStep2').hidden = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* Back button */
document.getElementById('sellBackBtn').addEventListener('click', () => {
  document.getElementById('sellStep1').hidden = false;
  document.getElementById('sellStep2').hidden = true;
  selectedSellItem = null;
});

/* Live total */
document.getElementById('sellQty').addEventListener('input', () => {
  if (!selectedSellItem) return;
  const qty   = parseFloat(document.getElementById('sellQty').value) || 0;
  const total = qty * (selectedSellItem.price || 0);
  document.getElementById('totalPreview').textContent = fmt(total);
});

/* Sell form submit */
document.getElementById('sellForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (!selectedSellItem) return;

  const qty = parseFloat(document.getElementById('sellQty').value);
  if (!qty || qty <= 0) {
    showToast('Enter a valid quantity', 'error');
    return;
  }
  if (qty > selectedSellItem.quantity) {
    showToast(`Only ${fmtQty(selectedSellItem.quantity, selectedSellItem.unit)} available`, 'error');
    return;
  }

  const submitBtn = e.target.querySelector('[type="submit"]');
  submitBtn.disabled    = true;
  submitBtn.textContent = 'Recording…';

  const saleData = {
    itemId:       selectedSellItem.id,
    itemName:     selectedSellItem.name,
    category:     selectedSellItem.category,
    quantity:     qty,
    unit:         selectedSellItem.unit,
    pricePerUnit: selectedSellItem.price,
    total:        qty * (selectedSellItem.price || 0),
    note:         document.getElementById('sellNote').value.trim()
  };

  try {
    await recordSale(saleData);

    /* Play sale animation before resetting the UI */
    playSaleAnimation(selectedSellItem, qty, saleData.total);

    showToast(`Sold ${fmtQty(qty, selectedSellItem.unit)} of ${selectedSellItem.name}`);

    /* Reset sell flow */
    document.getElementById('sellStep1').hidden = false;
    document.getElementById('sellStep2').hidden = true;
    selectedSellItem = null;

    /* Refresh stock data */
    allStock = await getAllStock();
    renderSellGrid();
  } catch (err) {
    console.error(err);
    showToast('Failed to record sale', 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
      Record Sale`;
  }
});

/* ─── Sales History ──────────────────────────────────────── */
async function loadAndRenderSales() {
  const loader = document.getElementById('historyLoader');
  loader.hidden = false;
  try {
    allSales = await getAllSales();
    renderHistory();
  } catch (err) {
    console.error(err);
    showToast('Failed to load sales', 'error');
  } finally {
    loader.hidden = true;
  }
}

function renderHistory() {
  const listEl    = document.getElementById('salesList');
  const emptyEl   = document.getElementById('historyEmpty');
  const summaryEl = document.getElementById('salesSummary');

  if (allSales.length === 0) {
    listEl.innerHTML  = '';
    emptyEl.hidden    = false;
    summaryEl.hidden  = true;
    return;
  }

  emptyEl.hidden   = false;
  summaryEl.hidden = false;
  emptyEl.hidden   = true;

  const totalRevenue = allSales.reduce((s, sale) => s + sale.total, 0);
  document.getElementById('salesTotalCount').textContent   = allSales.length;
  document.getElementById('salesTotalRevenue').textContent = fmt(totalRevenue);

  listEl.innerHTML = allSales.map(sale => `
    <div class="sale-row">
      <div class="sale-info">
        <div class="sale-header">
          <span class="sale-name">${esc(sale.itemName)}</span>
          <span class="cat-badge cat-${esc(sale.category)}">${esc(catLabel(sale.category))}</span>
        </div>
        <div class="sale-details">
          <span>${esc(fmtQty(sale.quantity, sale.unit))}</span>
          ${sale.pricePerUnit ? `<span>× ${esc(fmt(sale.pricePerUnit))}</span>` : ''}
          <span class="sale-total">= ${esc(fmt(sale.total))}</span>
        </div>
        ${sale.note ? `<div class="sale-note">"${esc(sale.note)}"</div>` : ''}
        <div class="sale-date">${esc(fmtDate(sale.soldAt))}</div>
      </div>
      <button class="sale-del-btn" data-sale-id="${esc(sale.id)}" aria-label="Delete sale record">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
          <path d="M10 11v6"/><path d="M14 11v6"/>
        </svg>
      </button>
    </div>`).join('');

  listEl.querySelectorAll('.sale-del-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this sale record?')) return;
      try {
        await deleteSale(btn.dataset.saleId);
        allSales = allSales.filter(s => s.id !== btn.dataset.saleId);
        renderHistory();
        showToast('Sale record deleted');
      } catch (err) {
        console.error(err);
        showToast('Failed to delete sale', 'error');
      }
    });
  });
}

/* ─── Init ───────────────────────────────────────────────── */

/**
 * Preload all icon images into the browser's image cache.
 * Resolves when every image has either loaded or errored —
 * so it never blocks the UI indefinitely.
 */
function preloadImages(icons) {
  return Promise.all(
    icons.map(icon => new Promise(resolve => {
      const img    = new Image();
      img.onload   = resolve;
      img.onerror  = resolve; /* don't stall on a missing file */
      img.src      = `icons/${icon.file}`;
    }))
  );
}

(async () => {
  const loaderEl   = document.getElementById('appLoader');
  const barFill    = document.getElementById('loaderBarFill');
  const statusEl   = document.getElementById('loaderStatus');

  function setProgress(pct, label) {
    barFill.style.width = `${pct}%`;
    if (label) statusEl.textContent = label;
  }

  setProgress(8, 'Loading icons…');
  await loadIcons();

  setProgress(35, 'Building UI…');
  buildIconPicker('iconPicker', false, null);

  setProgress(55, 'Caching images…');
  await preloadImages(stockIcons);

  setProgress(75, 'Loading stock…');
  await loadAndRenderStock();

  setProgress(100, 'Ready');

  /* Small pause so the bar visibly hits 100% before fading */
  await new Promise(r => setTimeout(r, 220));

  loaderEl.classList.add('done');
  /* Remove from DOM after fade completes so it can't block touches */
  loaderEl.addEventListener('transitionend', () => { loaderEl.hidden = true; }, { once: true });
})();
