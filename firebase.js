/* ============================================================
   firebase.js — Budologist Stock App
   Uses the SAME Firebase Realtime Database as the main app.
   Firebase Compat SDK loaded via CDN in index.html.
   ============================================================ */

const _firebaseConfig = {
  apiKey:            "AIzaSyCW625XFVSBubJXeg7TOgjiiCNVg9ESipc",
  authDomain:        "budmemberapp.firebaseapp.com",
  databaseURL:       "https://budmemberapp-default-rtdb.firebaseio.com",
  projectId:         "budmemberapp",
  storageBucket:     "budmemberapp.firebasestorage.app",
  messagingSenderId: "269040218229",
  appId:             "1:269040218229:web:3ca449a0b0dd1801ce083c"
};

firebase.initializeApp(_firebaseConfig);
const db = firebase.database();

/* ============================================================
   STOCK CRUD
   /stock/{itemId}
   ============================================================ */

async function addStockItem(data) {
  const ref = await db.ref('stock').push({
    name:       data.name.trim(),
    category:   data.category,
    quantity:   Number(data.quantity) || 0,
    unit:       data.hasGrams ? 'g' : '',
    gramsInfo:  data.gramsInfo        || null,
    price:      Number(data.price)    || 0,
    icon:       data.icon             || null,
    strain:     data.strain           || null,
    tags:       data.tags             || {},
    createdAt:  firebase.database.ServerValue.TIMESTAMP,
    updatedAt:  firebase.database.ServerValue.TIMESTAMP
  });
  return ref.key;
}

async function getAllStock() {
  const snap = await db.ref('stock').orderByChild('createdAt').once('value');
  const items = [];
  snap.forEach(child => {
    const d = child.val();
    items.push({
      id:         child.key,
      name:       d.name      || '',
      category:   d.category  || 'weed',
      quantity:   d.quantity  ?? 0,
      unit:       d.unit      || '',
      gramsInfo:  d.gramsInfo || null,
      price:      d.price     || 0,
      icon:       d.icon      || null,
      strain:     d.strain    || null,
      tags:       d.tags      || {},
      createdAt:  d.createdAt || 0
    });
  });
  return items.reverse(); /* newest first */
}

async function updateStockItem(id, data) {
  await db.ref('stock').child(id).update({
    name:       data.name.trim(),
    category:   data.category,
    quantity:   Number(data.quantity) || 0,
    unit:       data.hasGrams ? 'g' : '',
    gramsInfo:  data.gramsInfo        || null,
    price:      Number(data.price)    || 0,
    icon:       data.icon             || null,
    strain:     data.strain           || null,
    tags:       data.tags             || {},
    updatedAt:  firebase.database.ServerValue.TIMESTAMP
  });
}

async function deleteStockItem(id) {
  await db.ref('stock').child(id).remove();
}

/**
 * Atomically adjust the quantity of a stock item by `delta`.
 * Quantity cannot go below 0.
 */
async function adjustStockQuantity(id, delta) {
  await db.ref('stock').child(id).transaction(item => {
    if (!item) return item;
    item.quantity  = Math.max(0, (item.quantity || 0) + delta);
    item.updatedAt = Date.now();
    return item;
  });
}

/* ============================================================
   SALES
   /sales/{saleId}
   ============================================================ */

/**
 * Record a sale and atomically deduct the sold quantity from stock.
 */
async function recordSale(saleData) {
  /* Deduct from stock first */
  await db.ref('stock').child(saleData.itemId).transaction(item => {
    if (!item) return item;
    item.quantity  = Math.max(0, (item.quantity || 0) - saleData.quantity);
    item.updatedAt = Date.now();
    return item;
  });

  /* Write sale record */
  const ref = await db.ref('sales').push({
    itemId:       saleData.itemId,
    itemName:     saleData.itemName,
    category:     saleData.category,
    quantity:     saleData.quantity,
    unit:         saleData.unit,
    pricePerUnit: saleData.pricePerUnit,
    total:        saleData.total,
    note:         saleData.note || '',
    soldAt:       firebase.database.ServerValue.TIMESTAMP
  });
  return ref.key;
}

async function getAllSales() {
  const snap = await db.ref('sales').orderByChild('soldAt').once('value');
  const sales = [];
  snap.forEach(child => {
    const d = child.val();
    sales.push({
      id:           child.key,
      itemId:       d.itemId       || '',
      itemName:     d.itemName     || '',
      category:     d.category     || '',
      quantity:     d.quantity     || 0,
      unit:         d.unit         || '',
      pricePerUnit: d.pricePerUnit || 0,
      total:        d.total        || 0,
      note:         d.note         || '',
      soldAt:       d.soldAt ? new Date(d.soldAt) : null
    });
  });
  return sales.reverse(); /* newest first */
}

async function deleteSale(id) {
  await db.ref('sales').child(id).remove();
}
