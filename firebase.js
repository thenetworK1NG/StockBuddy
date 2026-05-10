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
    name:        data.name.trim(),
    category:    data.category,
    quantity:    Number(data.quantity) || 0,
    unit:        data.hasGrams ? 'g' : '',
    gramsInfo:   data.gramsInfo        || null,
    price:       Number(data.price)    || 0,
    icon:        data.icon             || null,
    strain:      data.strain           || null,
    tags:        data.tags             || {},
    soldOut:     data.soldOut     || false,
    infoMessage: data.infoMessage || null,
    createdAt:   firebase.database.ServerValue.TIMESTAMP,
    updatedAt:   firebase.database.ServerValue.TIMESTAMP
  });
  return ref.key;
}

async function getAllStock() {
  const snap = await db.ref('stock').orderByChild('createdAt').once('value');
  const items = [];
  snap.forEach(child => {
    const d = child.val();
    items.push({
      id:          child.key,
      name:        d.name        || '',
      category:    d.category    || 'weed',
      quantity:    d.quantity    ?? 0,
      unit:        d.unit        || '',
      gramsInfo:   d.gramsInfo   || null,
      price:       d.price       || 0,
      icon:        d.icon        || null,
      strain:      d.strain      || null,
      tags:        d.tags        || {},
      soldOut:         d.soldOut         || false,
      hiddenFromMenu:   d.hiddenFromMenu   || false,
      infoMessage:      d.infoMessage      || null,
      createdAt:        d.createdAt        || 0
    });
  });
  return items.reverse(); /* newest first */
}

async function updateStockItem(id, data) {
  await db.ref('stock').child(id).update({
    name:        data.name.trim(),
    category:    data.category,
    quantity:    Number(data.quantity) || 0,
    unit:        data.hasGrams ? 'g' : '',
    gramsInfo:   data.gramsInfo        || null,
    price:       Number(data.price)    || 0,
    icon:        data.icon             || null,
    strain:      data.strain           || null,
    tags:        data.tags             || {},
    soldOut:     data.soldOut     || false,
    infoMessage: data.infoMessage || null,
    updatedAt:   firebase.database.ServerValue.TIMESTAMP
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
 * Search members by name, member number, or phone number.
 * Returns up to 10 matches from the local members list.
 */
async function searchMembers(query) {
  if (!query || query.trim().length < 2) return [];
  const snap = await db.ref('members').once('value');
  const q    = query.trim().toLowerCase();
  const results = [];
  snap.forEach(child => {
    const d = child.val();
    if (
      (d.memberName   || '').toLowerCase().includes(q) ||
      (d.memberNumber || '').toLowerCase().includes(q) ||
      (d.phoneNumber  || '').toLowerCase().includes(q)
    ) {
      results.push({
        id:           child.key,
        memberNumber: d.memberNumber || '',
        memberName:   d.memberName   || '',
        phoneNumber:  d.phoneNumber  || '',
        membershipType: d.membershipType || ''
      });
    }
    if (results.length >= 10) return true; /* stop iterating */
  });
  return results;
}

/**
 * Record a sale and atomically deduct the sold quantity from stock.
 * If saleData.memberId is provided, also increments the member's
 * totalSpent and purchaseCount fields.
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
    memberId:     saleData.memberId     || null,
    memberNumber: saleData.memberNumber || null,
    memberName:   saleData.memberName   || null,
    soldAt:       firebase.database.ServerValue.TIMESTAMP
  });

  /* If a member is linked, atomically update their purchase stats */
  if (saleData.memberId) {
    await db.ref('members').child(saleData.memberId).transaction(member => {
      if (!member) return member;
      member.totalSpent    = (member.totalSpent    || 0) + saleData.total;
      member.purchaseCount = (member.purchaseCount || 0) + 1;
      return member;
    });
  }

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
      memberId:     d.memberId     || null,
      memberNumber: d.memberNumber || null,
      memberName:   d.memberName   || null,
      soldAt:       d.soldAt ? new Date(d.soldAt) : null
    });
  });
  return sales.reverse(); /* newest first */
}

async function deleteSale(id) {
  await db.ref('sales').child(id).remove();
}

/* ============================================================
   VISIBILITY TOGGLE
   ============================================================ */

async function setHiddenFromMenu(id, hidden) {
  await db.ref('stock').child(id).update({
    hiddenFromMenu: hidden,
    updatedAt:      firebase.database.ServerValue.TIMESTAMP
  });
}

/* ============================================================
   REVERSE SALE
   Restores stock, reverses member stats, deletes the record.
   ============================================================ */

async function reverseSale(sale) {
  /* 1. Restore stock quantity */
  await db.ref('stock').child(sale.itemId).transaction(item => {
    if (!item) return item;
    item.quantity  = +(((item.quantity || 0) + sale.quantity).toFixed(2));
    item.updatedAt = Date.now();
    return item;
  });

  /* 2. Reverse member totalSpent + purchaseCount if linked */
  if (sale.memberId) {
    await db.ref('members').child(sale.memberId).transaction(member => {
      if (!member) return member;
      member.totalSpent    = Math.max(0, +(((member.totalSpent || 0) - sale.total).toFixed(2)));
      member.purchaseCount = Math.max(0, (member.purchaseCount || 0) - 1);
      return member;
    });
  }

  /* 3. Delete the sale record */
  await db.ref('sales').child(sale.id).remove();
}
