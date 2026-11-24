const FIREBASE_DB_URL = "https://new-city-hardware-c8da1-default-rtdb.firebaseio.com";
    const ADMIN_SECRET_PASS = "nch2026";

    const urlParams = new URLSearchParams(window.location.search);
    let isAdminMode = localStorage.getItem('nch_is_admin') === 'true';

    if (urlParams.get('admin') === '1' && !isAdminMode) {
      const entered = prompt("অ্যাডমিন পাসওয়ার্ড দিন:");
      if (entered === ADMIN_SECRET_PASS) {
        isAdminMode = true;
        localStorage.setItem('nch_is_admin', 'true');
        alert("অ্যাডমিন মোড চালু হয়েছে! এখন প্রতিটি প্রোডাক্টের রেট আলাদাভাবে আপডেট করতে পারবেন।");
      } else if (entered !== null) {
        alert("ভুল পাসওয়ার্ড!");
      }
    } else if (urlParams.get('admin') === '0') {
      isAdminMode = false;
      localStorage.removeItem('nch_is_admin');
    }

    function applyAdminVisibility() {
      document.querySelectorAll('.admin-only-btn').forEach(btn => {
        if (isAdminMode) {
          btn.classList.remove('hidden');
          btn.classList.add('flex');
        } else {
          btn.classList.add('hidden');
          btn.classList.remove('flex');
        }
      });
    }

    document.addEventListener('DOMContentLoaded', applyAdminVisibility);

    let knownOrderIds = new Set(JSON.parse(localStorage.getItem('nch_known_cloud_ids') || '[]'));
    let cloudOrdersCache = [];
    let localConfirmedOrders = JSON.parse(localStorage.getItem('nch_local_confirmed_memos') || '[]');
    let activeMemoOrder = null;

    let orderDateMode = 'today';
    let orderSpecificDate = '';
    let memoDateMode = 'today';
    let memoSpecificDate = '';

    // =========================================================
    // INDIVIDUAL PRODUCT RATE UPDATE SYSTEM
    // =========================================================
    let customRatesMap = JSON.parse(localStorage.getItem('nch_custom_product_rates') || '{}');

    function getRateKey(product) {
      return `${encodeURIComponent(product.model)}__${encodeURIComponent(product.unit)}`;
    }

    function applyCustomRatesToProducts() {
      let updatedCount = 0;
      PRODUCTS.forEach(p => {
        if (typeof p.basePrice !== 'number') {
          p.basePrice = p.price;
        }
        const key = getRateKey(p);
        if (customRatesMap[key] !== undefined && !isNaN(parseFloat(customRatesMap[key]))) {
          p.price = parseFloat(customRatesMap[key]);
          p.isCustomRate = true;
          updatedCount++;
        } else {
          p.price = p.basePrice;
          p.isCustomRate = false;
        }
      });
      const badge = document.getElementById('updated-rate-count');
      if (badge) badge.textContent = updatedCount;
      const mgrBadge = document.getElementById('rate-mgr-updated-count');
      if (mgrBadge) mgrBadge.textContent = updatedCount;
    }

    async function syncCustomRatesFromFirebase() {
      try {
        const res = await fetch(`${FIREBASE_DB_URL}/product_rates.json`);
        if (!res.ok) return;
        const data = await res.json();
        if (data && typeof data === 'object') {
          customRatesMap = { ...customRatesMap, ...data };
          localStorage.setItem('nch_custom_product_rates', JSON.stringify(customRatesMap));
          applyCustomRatesToProducts();
          renderProducts();
        }
      } catch (e) {}
    }

    async function persistCustomRate(product, newPrice, reRender = true) {
      const key = getRateKey(product);
      customRatesMap[key] = Number(newPrice);
      localStorage.setItem('nch_custom_product_rates', JSON.stringify(customRatesMap));
      applyCustomRatesToProducts();
      if (reRender) renderProducts();

      try {
        await fetch(`${FIREBASE_DB_URL}/product_rates/${key}.json`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(Number(newPrice))
        });
      } catch (e) {}
    }

    function openRateManagerModal() {
      if (!isAdminMode) return;
      const m = document.getElementById('rate-manager-modal');
      m.classList.remove('hidden');
      m.classList.add('flex');
      renderRateManagerList();
    }

    function closeRateManagerModal() {
      const m = document.getElementById('rate-manager-modal');
      m.classList.add('hidden');
      m.classList.remove('flex');
    }

    function renderRateManagerList() {
      const container = document.getElementById('rate-manager-list');
      if (!container) return;

      const q = (document.getElementById('rate-manager-search')?.value || '').toLowerCase().trim();
      const list = PRODUCTS.filter(p =>
        !q || p.name.toLowerCase().includes(q) || String(p.model).toLowerCase().includes(q)
      ).slice(0, 80);

      if (list.length === 0) {
        container.innerHTML = `<div class="text-center py-8 text-sm text-slate-500">কোনো পণ্য পাওয়া যায়নি।</div>`;
        return;
      }

      container.innerHTML = list.map(p => `
        <div class="bg-white border border-slate-200 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="text-[11px] font-mono font-bold bg-slate-900 text-amber-400 px-2 py-0.5 rounded">#${p.model}</span>
              <span class="text-[11px] font-mono font-bold bg-amber-100 text-amber-900 px-2 py-0.5 rounded">${p.unit}</span>
              ${p.isCustomRate ? `<span class="text-[10px] font-bold bg-blue-100 text-blue-800 px-2 py-0.5 rounded">আপডেটেড (মূল: ৳${p.basePrice})</span>` : ''}
            </div>
            <div class="font-bold text-slate-900 text-sm mt-1 truncate">${p.name}</div>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <input type="number" step="any" min="0" id="mgr-rate-input-${p.id}" value="${p.price}" onkeydown="if(event.key==='Enter'){event.preventDefault();saveManagerRowRate(${p.id});}" class="w-24 border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-extrabold font-mono text-right outline-none focus:border-amber-500" />
            <button onclick="saveManagerRowRate(${p.id})" class="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-orange-600 text-white text-xs font-bold cursor-pointer">
              সেভ
            </button>
          </div>
        </div>
      `).join('');
    }

    async function saveManagerRowRate(productId) {
      if (!isAdminMode) return;
      const p = PRODUCTS.find(item => item.id === productId);
      const inp = document.getElementById(`mgr-rate-input-${productId}`);
      if (!p || !inp) return;
      const val = parseFloat(inp.value);
      if (isNaN(val) || val < 0) return;

      await persistCustomRate(p, val, true);
      renderRateManagerList();
      showToast(`"${p.name}" -> ৳${val} সেভ হয়েছে!`);
    }

    function downloadUpdatedRatesCSV() {
      const header = ["name", "model", "unit", "category", "price", "image"];
      const rows = PRODUCTS.map(p => [
        `"${String(p.name).replace(/"/g, '""')}"`,
        `"${String(p.model).replace(/"/g, '""')}"`,
        `"${String(p.unit).replace(/"/g, '""')}"`,
        `"${String(p.cat).replace(/"/g, '""')}"`,
        p.price,
        `"${String(p.image || '').replace(/"/g, '""')}"`
      ].join(","));
      const csvContent = "\uFEFF" + [header.join(","), ...rows].join("\n");
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "products_updated_rates.csv";
      a.click();
      URL.revokeObjectURL(url);
      showToast("আপডেটেড রেটসহ CSV ডাউনলোড হয়েছে!");
    }

    // =========================================================
    // DATE & ORDER FUNCTIONS
    // =========================================================
    function getLocalDateKey(dateInput) {
      const d = dateInput ? new Date(dateInput) : new Date();
      if (isNaN(d.getTime())) return '';
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    }

    function getOrderDateKey(order) {
      if (order.dateKey) return order.dateKey;
      if (order.timestamp) return getLocalDateKey(order.timestamp);
      if (order.date) {
        const parsed = new Date(order.date);
        if (!isNaN(parsed.getTime())) return getLocalDateKey(parsed);
      }
      return getLocalDateKey();
    }

    function formatDisplayDateGroup(dateKey) {
      const todayKey = getLocalDateKey();
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayKey = getLocalDateKey(yesterday);

      if (dateKey === todayKey) return `🟢 আজকের অর্ডার (${dateKey})`;
      if (dateKey === yesterdayKey) return `🟡 গতকালের অর্ডার (${dateKey})`;
      return `📅 তারিখ: ${dateKey}`;
    }

    function filterOrdersByDateMode(list, mode, specificDate) {
      const todayKey = getLocalDateKey();
      if (mode === 'today') return list.filter(o => getOrderDateKey(o) === todayKey);
      if (mode === 'backdate') return list.filter(o => getOrderDateKey(o) < todayKey);
      if (mode === 'specific' && specificDate) return list.filter(o => getOrderDateKey(o) === specificDate);
      return list;
    }

    function setOrderDateMode(mode) {
      orderDateMode = mode;
      if (mode !== 'specific') {
        orderSpecificDate = '';
        const inp = document.getElementById('order-specific-date');
        if (inp) inp.value = '';
      }
      updateOrderDateTabStyles();
      renderCloudOrdersModal();
    }

    function handleOrderSpecificDateChange(val) {
      if (!val) { setOrderDateMode('today'); return; }
      orderSpecificDate = val;
      orderDateMode = 'specific';
      updateOrderDateTabStyles();
      renderCloudOrdersModal();
    }

    function updateOrderDateTabStyles() {
      const activeCls = 'px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer bg-slate-900 text-amber-400';
      const inactiveCls = 'px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer bg-white text-slate-700 border border-slate-300';
      ['today', 'backdate', 'all'].forEach(m => {
        const btn = document.getElementById(`ord-tab-${m}`);
        if (btn) btn.className = (orderDateMode === m) ? activeCls : inactiveCls;
      });
    }

    function setMemoDateMode(mode) {
      memoDateMode = mode;
      if (mode !== 'specific') {
        memoSpecificDate = '';
        const inp = document.getElementById('memo-specific-date');
        if (inp) inp.value = '';
      }
      updateMemoDateTabStyles();
      renderConfirmedMemosList();
    }

    function handleMemoSpecificDateChange(val) {
      if (!val) { setMemoDateMode('today'); return; }
      memoSpecificDate = val;
      memoDateMode = 'specific';
      updateMemoDateTabStyles();
      renderConfirmedMemosList();
    }

    function updateMemoDateTabStyles() {
      const activeCls = 'px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer bg-emerald-700 text-white';
      const inactiveCls = 'px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer bg-white text-slate-700 border border-slate-200';
      ['today', 'backdate', 'all'].forEach(m => {
        const btn = document.getElementById(`memo-tab-${m}`);
        if (btn) btn.className = (memoDateMode === m) ? activeCls : inactiveCls;
      });
    }

    function getAllMergedOrders() {
      const map = new Map();
      localConfirmedOrders.forEach(o => { if (o && o.id) map.set(o.id, o); });
      if (isAdminMode) {
        cloudOrdersCache.forEach(o => { if (o && o.id) map.set(o.id, o); });
      }
      return Array.from(map.values()).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    }

    function saveLocalConfirmedOrder(orderObj) {
      const idx = localConfirmedOrders.findIndex(o => o.id === orderObj.id);
      if (idx >= 0) localConfirmedOrders[idx] = orderObj;
      else localConfirmedOrders.unshift(orderObj);
      localStorage.setItem('nch_local_confirmed_memos', JSON.stringify(localConfirmedOrders));
    }

    async function pushOrderToFirebase(orderObj) {
      saveLocalConfirmedOrder(orderObj);
      try {
        const res = await fetch(`${FIREBASE_DB_URL}/orders/${orderObj.id}.json`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(orderObj)
        });
        if (res.ok) {
          knownOrderIds.add(orderObj.id);
          localStorage.setItem('nch_known_cloud_ids', JSON.stringify([...knownOrderIds]));
          if (isAdminMode) fetchCloudOrders(false);
          else refreshOrderAndMemoViews();
        }
      } catch (err) {}
    }

    async function updateCloudOrderStatus(orderId, newStatus) {
      if (!isAdminMode) return;
      const localMatch = getAllMergedOrders().find(o => o.id === orderId);
      if (localMatch) {
        localMatch.status = newStatus;
        saveLocalConfirmedOrder(localMatch);
      }
      try {
        await fetch(`${FIREBASE_DB_URL}/orders/${orderId}.json`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus })
        });
        showToast(`অর্ডার #${orderId} এর স্ট্যাটাস "${newStatus}" করা হয়েছে!`);
        fetchCloudOrders(false);
      } catch (err) {}
    }

    async function fetchCloudOrders(notifyOnNew = true) {
      if (!isAdminMode) {
        refreshOrderAndMemoViews();
        return;
      }
      try {
        const res = await fetch(`${FIREBASE_DB_URL}/orders.json`);
        if (!res.ok) { refreshOrderAndMemoViews(); return; }
        const data = await res.json();
        const list = data ? Object.values(data).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)) : [];
        list.forEach(ord => {
          if (ord.id && !knownOrderIds.has(ord.id)) {
            knownOrderIds.add(ord.id);
            if (notifyOnNew) {
              playNotificationBeep();
              showToast(`🔔 নতুন অর্ডার এসেছে! #${ord.id} (${ord.customer?.name || 'গ্রাহক'} - ৳${ord.total})`);
            }
          }
        });
        localStorage.setItem('nch_known_cloud_ids', JSON.stringify([...knownOrderIds]));
        cloudOrdersCache = list;
        refreshOrderAndMemoViews();
      } catch (err) {
        refreshOrderAndMemoViews();
      }
    }

    function refreshOrderAndMemoViews() {
      const allOrders = getAllMergedOrders();
      const todayKey = getLocalDateKey();
      const todayOrders = allOrders.filter(o => getOrderDateKey(o) === todayKey);
      const backdateOrders = allOrders.filter(o => getOrderDateKey(o) < todayKey);
      const allConfirmed = allOrders.filter(o => ['Confirmed', 'Packed', 'Delivered'].includes(o.status || 'Confirmed'));
      const todayMemos = allConfirmed.filter(o => getOrderDateKey(o) === todayKey);
      const backdateMemos = allConfirmed.filter(o => getOrderDateKey(o) < todayKey);

      updateCloudOrderBadges(todayOrders.length, todayMemos.length);

      const setTxt = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
      setTxt('ord-count-today', todayOrders.length);
      setTxt('ord-count-backdate', backdateOrders.length);
      setTxt('ord-count-all', allOrders.length);
      setTxt('memo-count-today', todayMemos.length);
      setTxt('memo-count-backdate', backdateMemos.length);
      setTxt('memo-count-all', allConfirmed.length);

      renderCloudOrdersModal();
      renderConfirmedMemosList();
    }

    function updateCloudOrderBadges(todayOrdersCount, todayMemosCount) {
      ['live-cloud-order-count', 'mobile-live-ord-count', 'desktop-live-ord-badge'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = todayOrdersCount;
      });
      ['top-confirmed-memo-count', 'mobile-memo-count', 'desktop-memo-badge'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = todayMemosCount;
      });
    }

    function playNotificationBeep() {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.18);
      } catch (e) {}
    }

    function openA5MemoForOrder(orderId, autoPrint = false) {
      const order = getAllMergedOrders().find(o => o.id === orderId);
      if (!order) return;
      activeMemoOrder = order;
      const items = order.items || [];
      const subtotal = order.subtotal ?? items.reduce((s, it) => s + (it.price * it.qty), 0);
      const deliveryFee = order.deliveryFee ?? Math.max(0, (order.total || subtotal) - subtotal);
      const grandTotal = order.total ?? (subtotal + deliveryFee);

      document.getElementById('memo-id').textContent = `#${order.id}`;
      document.getElementById('memo-date').textContent = order.date || new Date().toLocaleString('bn-BD');
      document.getElementById('memo-status-badge').textContent = (order.status || 'CONFIRMED').toUpperCase();
      document.getElementById('memo-cust-name').textContent = order.customer?.name || 'সাধারণ ক্রেতা';
      document.getElementById('memo-cust-phone').textContent = order.customer?.phone || 'N/A';
      document.getElementById('memo-cust-address').textContent = order.customer?.address || 'দোকান পিকআপ';
      document.getElementById('memo-payment').textContent = order.payment || 'Cash on Delivery';
      document.getElementById('memo-source').textContent = order.source || 'Web Store';

      document.getElementById('memo-items-body').innerHTML = items.map((it, idx) => `
        <tr class="${idx % 2 === 1 ? 'bg-slate-50' : 'bg-white'}">
          <td class="border border-slate-800 py-1.5 px-1.5 text-center font-mono">${idx + 1}</td>
          <td class="border border-slate-800 py-1.5 px-2">
            <div class="font-bold text-slate-900">${it.name}</div>
            <div class="text-[10px] font-mono text-slate-600">Model: ${it.model || '-'}</div>
          </td>
          <td class="border border-slate-800 py-1.5 px-1.5 text-center font-mono font-bold">
            ${it.qty} <span class="text-[10px] font-normal">${it.unit || 'PCS'}</span>
          </td>
          <td class="border border-slate-800 py-1.5 px-1.5 text-right font-mono">৳${Number(it.price).toLocaleString()}</td>
          <td class="border border-slate-800 py-1.5 px-2 text-right font-mono font-extrabold">৳${(Number(it.price) * Number(it.qty)).toLocaleString()}</td>
        </tr>
      `).join('');

      document.getElementById('memo-subtotal').textContent = `৳${subtotal.toLocaleString()}`;
      document.getElementById('memo-delivery').textContent = `৳${deliveryFee.toLocaleString()}`;
      document.getElementById('memo-grand-total').textContent = `৳${grandTotal.toLocaleString()}`;

      closeLiveOrdersModal();
      closeConfirmedMemosModal();
      const modal = document.getElementById('a5-memo-modal');
      modal.classList.remove('hidden');
      modal.classList.add('flex');
      if (autoPrint) setTimeout(() => window.print(), 300);
    }

    function closeA5MemoModal() {
      const modal = document.getElementById('a5-memo-modal');
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    }

    function copyActiveMemoText() {
      if (!activeMemoOrder) return;
      const ord = activeMemoOrder;
      const lines = (ord.items || []).map((it, i) => `${i + 1}. ${it.name} (${it.qty} ${it.unit || 'PCS'} × ৳${it.price}) = ৳${it.qty * it.price}`).join('\n');
      const text = `*New City Hardware — Cash Memo*\nমেমো নং: #${ord.id}\nতারিখ: ${ord.date || ''}\nক্রেতা: ${ord.customer?.name || ''} (${ord.customer?.phone || ''})\nঠিকানা: ${ord.customer?.address || ''}\n------------------\n${lines}\n------------------\nসর্বমোট বিল: ৳${ord.total}`;
      navigator.clipboard?.writeText(text);
      showToast('মেমোর বিস্তারিত কপি হয়েছে!');
    }

    function openConfirmedMemosModal() {
      closeA5MemoModal();
      closeLiveOrdersModal();
      const m = document.getElementById('confirmed-memos-modal');
      m.classList.remove('hidden');
      m.classList.add('flex');
      updateMemoDateTabStyles();
      renderConfirmedMemosList();
    }

    function closeConfirmedMemosModal() {
      const m = document.getElementById('confirmed-memos-modal');
      m.classList.add('hidden');
      m.classList.remove('flex');
    }

    function renderConfirmedMemosList() {
      const container = document.getElementById('confirmed-memos-list');
      if (!container) return;
      const q = (document.getElementById('memo-search-input')?.value || '').toLowerCase().trim();
      const allOrders = getAllMergedOrders();
      let confirmedMemos = allOrders.filter(o => ['Confirmed', 'Packed', 'Delivered'].includes(o.status || 'Confirmed'));
      confirmedMemos = filterOrdersByDateMode(confirmedMemos, memoDateMode, memoSpecificDate);

      if (q) {
        confirmedMemos = confirmedMemos.filter(o =>
          (o.id || '').toLowerCase().includes(q) ||
          (o.customer?.name || '').toLowerCase().includes(q) ||
          (o.customer?.phone || '').toLowerCase().includes(q)
        );
      }

      const countLbl = document.getElementById('confirmed-memo-total-label');
      if (countLbl) countLbl.textContent = confirmedMemos.length;

      if (confirmedMemos.length === 0) {
        const emptyMsg = memoDateMode === 'today'
          ? 'আজকের তারিখে এখনো কোনো কনফার্মড মেমো তৈরি হয়নি। ব্যাক-ডেট মেমো দেখতে উপরের "ব্যাক-ডেট মেমো" বাটনে ক্লিক করুন।'
          : 'এই ফিল্টারে কোনো কনফার্মড মেমো পাওয়া যায়নি।';
        container.innerHTML = `<div class="text-center py-12 text-slate-500 text-sm">${emptyMsg}</div>`;
        return;
      }

      const groups = new Map();
      confirmedMemos.forEach(ord => {
        const dk = getOrderDateKey(ord);
        if (!groups.has(dk)) groups.set(dk, []);
        groups.get(dk).push(ord);
      });

      let html = '';
      groups.forEach((ordersInDate, dk) => {
        const dateTotal = ordersInDate.reduce((s, o) => s + (Number(o.total) || 0), 0);
        html += `
          <div class="space-y-2.5">
            <div class="flex items-center justify-between bg-emerald-950 text-emerald-200 px-3.5 py-2 rounded-xl text-xs font-bold">
              <span>${formatDisplayDateGroup(dk)}</span>
              <span class="font-mono">মোট: ${ordersInDate.length} টি মেমো • ৳${dateTotal.toLocaleString()}</span>
            </div>
            ${ordersInDate.map(ord => `
              <div class="bg-white border border-emerald-200 hover:border-emerald-500 rounded-xl p-4 shadow-2xs transition flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div class="space-y-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="font-mono font-extrabold text-slate-900 text-sm">#${ord.id}</span>
                    <span class="text-[11px] font-bold bg-emerald-100 text-emerald-900 px-2 py-0.5 rounded-full">✓ ${ord.status || 'Confirmed'}</span>
                    <span class="text-[11px] font-bold bg-slate-100 text-slate-700 px-2 py-0.5 rounded">${ord.source || 'Web Store'}</span>
                    <span class="text-[11px] text-slate-500">${ord.date || ''}</span>
                  </div>
                  <div class="text-xs text-slate-800">
                    <strong>ক্রেতা:</strong> ${ord.customer?.name || ''} • <span class="font-mono">${ord.customer?.phone || ''}</span>
                  </div>
                  <div class="text-[11px] text-slate-500">
                    মোট আইটেম: <strong>${(ord.items || []).length} টি</strong> (${(ord.items || []).map(i => `${i.name} × ${i.qty} ${i.unit || 'PCS'}`).join(', ')})
                  </div>
                </div>
                <div class="flex sm:flex-col items-center sm:items-end justify-between gap-2 shrink-0 border-t sm:border-t-0 pt-2 sm:pt-0">
                  <div class="text-base font-extrabold text-emerald-700 font-mono">৳${(ord.total || 0).toLocaleString()}</div>
                  <div class="flex items-center gap-1.5">
                    <button onclick="openA5MemoForOrder('${ord.id}', false)" class="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold cursor-pointer">🧾 মেমো দেখুন</button>
                    <button onclick="openA5MemoForOrder('${ord.id}', true)" class="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-extrabold cursor-pointer">🖨️ A5 প্রিন্ট</button>
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
        `;
      });
      container.innerHTML = html;
    }

    function openLiveOrdersModal() {
      const m = document.getElementById('live-orders-modal');
      m.classList.remove('hidden');
      m.classList.add('flex');
      updateOrderDateTabStyles();
      fetchCloudOrders(false);
    }

    function closeLiveOrdersModal() {
      const m = document.getElementById('live-orders-modal');
      m.classList.add('hidden');
      m.classList.remove('flex');
    }

    function renderCloudOrdersModal() {
      const container = document.getElementById('cloud-orders-list');
      if (!container) return;
      const allList = getAllMergedOrders();
      const list = filterOrdersByDateMode(allList, orderDateMode, orderSpecificDate);

      if (list.length === 0) {
        const msg = orderDateMode === 'today'
          ? 'আজকের তারিখে এখনো কোনো নতুন অর্ডার আসেনি। পুরনো ব্যাক-ডেটের অর্ডার দেখতে উপরের "ব্যাক-ডেট অর্ডার" বাটনে ক্লিক করুন।'
          : 'এই তারিখে কোনো অর্ডার পাওয়া যায়নি।';
        container.innerHTML = `<div class="text-center py-10 text-slate-500 text-sm">${msg}</div>`;
        return;
      }

      const groups = new Map();
      list.forEach(ord => {
        const dk = getOrderDateKey(ord);
        if (!groups.has(dk)) groups.set(dk, []);
        groups.get(dk).push(ord);
      });

      let html = '';
      groups.forEach((ordersInDate, dk) => {
        const dayTotal = ordersInDate.reduce((s, o) => s + (Number(o.total) || 0), 0);
        html += `
          <div class="space-y-3">
            <div class="flex items-center justify-between bg-slate-900 text-amber-300 px-3.5 py-2 rounded-xl text-xs font-bold">
              <span>${formatDisplayDateGroup(dk)}</span>
              <span class="font-mono">${ordersInDate.length} টি অর্ডার • ৳${dayTotal.toLocaleString()}</span>
            </div>
            ${ordersInDate.map(ord => `
              <div class="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs space-y-2.5">
                <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
                  <div>
                    <span class="font-mono font-extrabold text-slate-900 text-sm">#${ord.id}</span>
                    <span class="ml-2 text-[11px] font-bold bg-amber-100 text-amber-900 px-2 py-0.5 rounded">${ord.source || 'App/Web'}</span>
                    <span class="ml-1 text-[11px] font-bold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded">${ord.status || 'Confirmed'}</span>
                    <div class="text-[11px] text-slate-500 mt-0.5">${ord.date || ''}</div>
                  </div>
                  <div class="text-right">
                    <div class="text-base font-extrabold text-orange-600 font-mono">৳${(ord.total || 0).toLocaleString()}</div>
                    <div class="text-[11px] text-slate-500">${ord.payment || 'COD'}</div>
                  </div>
                </div>
                <div class="text-xs text-slate-700 bg-slate-50 p-2.5 rounded-lg">
                  <div><strong>ক্রেতা:</strong> ${ord.customer?.name || ''} | <strong>মোবাইল:</strong> <span class="font-mono">${ord.customer?.phone || ''}</span></div>
                  <div><strong>ঠিকানা:</strong> ${ord.customer?.address || ''}</div>
                  <div class="mt-1.5 pt-1.5 border-t border-slate-200 space-y-0.5">
                    ${(ord.items || []).map(it => `<div class="flex justify-between"><span>• ${it.name} [${it.model}] × ${it.qty} ${it.unit}</span><span class="font-mono font-bold">৳${it.price * it.qty}</span></div>`).join('')}
                  </div>
                </div>
                <div class="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <div class="flex gap-1.5">
                    <button onclick="openA5MemoForOrder('${ord.id}', false)" class="px-3 py-1.5 rounded-lg bg-slate-900 text-white hover:bg-slate-800 text-xs font-bold cursor-pointer">🧾 মেমো দেখুন</button>
                    <button onclick="openA5MemoForOrder('${ord.id}', true)" class="px-3 py-1.5 rounded-lg bg-amber-500 text-slate-950 hover:bg-amber-400 text-xs font-extrabold cursor-pointer">🖨️ A5 প্রিন্ট</button>
                  </div>
                  <div class="flex gap-1.5">
                    <button onclick="updateCloudOrderStatus('${ord.id}', 'Confirmed')" class="px-2.5 py-1 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 text-xs font-bold cursor-pointer">Confirmed</button>
                    <button onclick="updateCloudOrderStatus('${ord.id}', 'Packed')" class="px-2.5 py-1 rounded-lg bg-amber-50 text-amber-800 hover:bg-amber-100 text-xs font-bold cursor-pointer">Packed</button>
                    <button onclick="updateCloudOrderStatus('${ord.id}', 'Delivered')" class="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 text-xs font-bold cursor-pointer">Delivered ✓</button>
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
        `;
      });
      container.innerHTML = html;
    }

    const PRODUCTS_CSV_URL = "products.csv";
    let PRODUCTS = [];

    async function loadProductsFromCSV() {
      try {
        const res = await fetch(PRODUCTS_CSV_URL + "?t=" + Date.now());
        if (!res.ok) throw new Error("HTTP " + res.status);
        const text = await res.text();
        const lines = text.trim().split(/\r?\n/);
        const products = [];
        for (let i = 1; i < lines.length; i++) {
          const cols = [];
          let cur = "", inQuote = false;
          for (const ch of lines[i]) {
            if (ch === '"') { inQuote = !inQuote; continue; }
            if (ch === ',' && !inQuote) { cols.push(cur); cur = ""; continue; }
            cur += ch;
          }
          cols.push(cur);
          const name  = (cols[0] || "").trim();
          const model = (cols[1] || "").trim();
          const unit  = (cols[2] || "PC").trim().toUpperCase();
          const cat   = (cols[3] || "General Hardware").trim();
          const price = parseFloat(cols[4]) || 0;
          const image = (cols[5] || "").trim();
          if (name) products.push({ name, model, unit, cat, price, basePrice: price, image });
        }
        return products;
      } catch (err) {
        return [];
      }
    }

    const CATEGORIES = [
      { id: 'ALL', bn: 'সব পণ্য' },
      { id: 'Locks & Door Hardware', bn: 'তালা ও দরজার হার্ডওয়্যার' },
      { id: 'Power Tools & Parts', bn: 'পাওয়ার টুলস ও পার্টস' },
      { id: 'Paint & Brushes', bn: 'রং ও ব্রাশ' },
      { id: 'Wheels & Casters', bn: 'চাকা ও বেয়ারিং' },
      { id: 'Hand Tools', bn: 'হ্যান্ড টুলস ও প্লাস' },
      { id: 'Fasteners & Bolts', bn: 'নাট, বোল্ট ও পিন' },
      { id: 'Electrical & Tape', bn: 'ইলেকট্রিক্যাল ও টেপ' },
      { id: 'General Hardware', bn: 'জেনারেল হার্ডওয়্যার' }
    ];

    let state = {
      selectedCategory: 'ALL',
      searchQuery: '',
      selectedUnit: 'ALL',
      sortBy: 'default',
      visibleLimit: 24,
      cardQuantities: {},
      cart: JSON.parse(localStorage.getItem('nch_cart_v1') || '[]')
    };

    function getCategoryBnName(catId) {
      const found = CATEGORIES.find(c => c.id === catId);
      return found ? found.bn : catId;
    }

    function renderCategoryTabs() {
      const container = document.getElementById('category-tabs');
      container.innerHTML = CATEGORIES.map(cat => {
        const count = cat.id === 'ALL' ? PRODUCTS.length : PRODUCTS.filter(p => p.cat === cat.id).length;
        const isActive = state.selectedCategory === cat.id;
        return `
          <button onclick="selectCategory('${cat.id}')" class="shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold border transition cursor-pointer ${isActive ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-200 hover:border-amber-400'}">
            <span>${cat.bn}</span>
            <span class="px-2 py-0.5 rounded-full text-[11px] font-mono ${isActive ? 'bg-amber-500 text-slate-950' : 'bg-slate-100 text-slate-600'}">${count}</span>
          </button>
        `;
      }).join('');
    }

    function selectCategory(catId) { state.selectedCategory = catId; state.visibleLimit = 24; renderCategoryTabs(); renderProducts(); }
    function handleFilterChange() {
      state.searchQuery = document.getElementById('search-input').value.trim();
      state.selectedUnit = document.getElementById('unit-filter').value;
      state.sortBy = document.getElementById('sort-select').value;
      state.visibleLimit = 24;
      document.getElementById('clear-search-btn').classList.toggle('hidden', state.searchQuery.length === 0);
      renderProducts();
    }
    function clearSearch() { document.getElementById('search-input').value = ''; handleFilterChange(); }
    function resetFilters() {
      state.selectedCategory = 'ALL'; state.searchQuery = ''; state.selectedUnit = 'ALL'; state.sortBy = 'default'; state.visibleLimit = 24;
      document.getElementById('search-input').value = ''; document.getElementById('unit-filter').value = 'ALL'; document.getElementById('sort-select').value = 'default';
      document.getElementById('clear-search-btn').classList.add('hidden');
      renderCategoryTabs(); renderProducts();
    }

    function getFilteredProducts() {
      const q = state.searchQuery.toLowerCase();
      let list = PRODUCTS.filter(p => {
        const matchCat = state.selectedCategory === 'ALL' || p.cat === state.selectedCategory;
        const matchUnit = state.selectedUnit === 'ALL' || p.unit === state.selectedUnit;
        const matchQ = !q || p.name.toLowerCase().includes(q) || p.model.toLowerCase().includes(q);
        return matchCat && matchUnit && matchQ;
      });
      if (state.sortBy === 'price-asc') list = [...list].sort((a, b) => a.price - b.price);
      if (state.sortBy === 'price-desc') list = [...list].sort((a, b) => b.price - a.price);
      if (state.sortBy === 'name-asc') list = [...list].sort((a, b) => a.name.localeCompare(b.name, 'bn'));
      return list;
    }

    function updateCardQty(productId, delta) {
      const next = Math.max(1, (parseInt(state.cardQuantities[productId], 10) || 1) + delta);
      state.cardQuantities[productId] = next;
      const el = document.getElementById(`card-qty-${productId}`);
      if (el) el.value = next;
    }

    function handleCardDirectInput(productId, val) {
      const parsed = parseInt(val, 10);
      state.cardQuantities[productId] = (!isNaN(parsed) && parsed > 0) ? parsed : 1;
    }

    function loadMoreProducts() { state.visibleLimit += 24; renderProducts(); }

    function renderProducts() {
      const filtered = getFilteredProducts();
      const container = document.getElementById('product-container');
      const emptyState = document.getElementById('empty-state');
      const loadMoreWrapper = document.getElementById('load-more-wrapper');
      document.getElementById('results-count').textContent = filtered.length;

      if (filtered.length === 0) {
        container.innerHTML = ''; emptyState.classList.remove('hidden'); loadMoreWrapper.classList.add('hidden'); return;
      }
      emptyState.classList.add('hidden');
      const visibleItems = filtered.slice(0, state.visibleLimit);
      const remaining = filtered.length - visibleItems.length;
      loadMoreWrapper.classList.toggle('hidden', remaining <= 0);
      if (remaining > 0) document.getElementById('remaining-count').textContent = `+${remaining}`;

      container.innerHTML = visibleItems.map(product => {
        const qty = state.cardQuantities[product.id] || 1;
        return `
          <div class="bg-white border border-slate-200 hover:border-amber-400 rounded-2xl p-4 flex flex-col justify-between shadow-xs transition">
            <div>
              <div class="w-full aspect-square mb-3 rounded-xl overflow-hidden bg-slate-50 border border-slate-100 flex items-center justify-center">
                <img src="images/${product.model}.jpg"
                     alt="${product.name}"
                     class="w-full h-full object-contain p-3 transition-transform duration-200 hover:scale-105"
                     loading="lazy"
                     onerror="
                       if(!this.dataset.try){ this.dataset.try=1; this.src='images/${product.model}.png'; }
                       else if(this.dataset.try==1){ this.dataset.try=2; this.src='images/${product.model}.webp'; }
                       else { this.parentElement.innerHTML='<div class=\'text-slate-400 text-xs\'>ছবি নেই</div>'; }
                     ">
              </div>
              <div class="flex items-center justify-between gap-2 mb-2.5">
                <span class="text-[11px] font-mono font-bold bg-slate-900 text-amber-400 px-2.5 py-0.5 rounded-md">Model: ${product.model}</span>
                <span class="text-[11px] font-mono font-bold uppercase px-2 py-0.5 rounded bg-amber-100 text-amber-900">${product.unit}</span>
              </div>
              <h4 class="font-bold text-slate-900 text-base leading-snug mb-2">${product.name}</h4>
              <p class="text-xs text-slate-500 mb-3">${getCategoryBnName(product.cat)}</p>
            </div>
            <div class="pt-2.5 border-t border-slate-100 space-y-2.5">
              <div class="flex items-baseline justify-between gap-1">
                <div>
                  <span class="text-xl font-extrabold text-slate-900 font-mono">৳${product.price.toLocaleString()}</span>
                  <span class="text-xs text-slate-500">/ ${product.unit}</span>
                </div>
                <span class="text-[11px] font-bold text-emerald-700">✓ ইন স্টক</span>
              </div>
              <div class="flex items-center gap-2">
                <div class="flex items-center border border-slate-200 rounded-xl bg-slate-50 overflow-hidden">
                  <button onclick="updateCardQty(${product.id}, -1)" class="w-7 h-9 font-bold text-slate-700 bg-slate-100 cursor-pointer">−</button>
                  <input type="number" id="card-qty-${product.id}" value="${qty}" min="1" oninput="handleCardDirectInput(${product.id}, this.value)" class="w-10 text-center text-xs font-extrabold font-mono bg-transparent outline-none" />
                  <button onclick="updateCardQty(${product.id}, 1)" class="w-7 h-9 font-bold text-slate-700 bg-slate-100 cursor-pointer">+</button>
                </div>
                <button onclick="addToCart(${product.id})" class="flex-1 h-9 bg-slate-900 hover:bg-orange-600 text-white font-bold text-xs rounded-xl transition cursor-pointer">
                  + কার্টে যোগ করুন
                </button>
              </div>
            </div>
          </div>
        `;
      }).join('');
    }

    function saveCart() { localStorage.setItem('nch_cart_v1', JSON.stringify(state.cart)); }
    function addToCart(productId) {
      const product = PRODUCTS.find(p => p.id === productId);
      if (!product) return;
      const inputEl = document.getElementById(`card-qty-${productId}`);
      const qtyToAdd = inputEl ? (parseInt(inputEl.value, 10) || 1) : (state.cardQuantities[productId] || 1);
      const existing = state.cart.find(item => item.id === productId);
      if (existing) existing.qty += qtyToAdd;
      else state.cart.push({ ...product, qty: qtyToAdd });
      saveCart(); renderCart();
      showToast(`"${product.name}" (${qtyToAdd} ${product.unit}) কার্টে যোগ হয়েছে!`);
    }
    function updateCartItemQty(id, delta) {
      const idx = state.cart.findIndex(i => i.id === id);
      if (idx === -1) return;
      state.cart[idx].qty += delta;
      if (state.cart[idx].qty <= 0) state.cart.splice(idx, 1);
      saveCart(); renderCart();
    }
    function clearCart() { state.cart = []; saveCart(); renderCart(); }
    function getCartTotals() {
      const totalItems = state.cart.reduce((s, i) => s + i.qty, 0);
      const subtotal = state.cart.reduce((s, i) => s + i.price * i.qty, 0);
      const deliveryFee = subtotal > 0 ? parseInt(document.getElementById('delivery-zone').value, 10) : 0;
      return { totalItems, subtotal, deliveryFee, grandTotal: subtotal + deliveryFee };
    }
    function renderCart() {
      const { totalItems, subtotal, grandTotal } = getCartTotals();
      document.getElementById('desktop-cart-badge').textContent = totalItems;
      document.getElementById('desktop-cart-total').textContent = `৳${subtotal.toLocaleString()}`;
      document.getElementById('mobile-cart-badge').textContent = totalItems;
      document.getElementById('mobile-cart-total').textContent = `৳${subtotal.toLocaleString()}`;
      document.getElementById('drawer-item-count').textContent = totalItems;

      const container = document.getElementById('cart-items-container');
      const footer = document.getElementById('cart-footer');
      if (state.cart.length === 0) {
        footer.classList.add('hidden');
        container.innerHTML = `<div class="text-center py-12 text-slate-500 text-sm">আপনার কার্ট খালি!</div>`;
        return;
      }
      footer.classList.remove('hidden');
      document.getElementById('cart-subtotal').textContent = `৳${subtotal.toLocaleString()}`;
      document.getElementById('cart-grand-total').textContent = `৳${grandTotal.toLocaleString()}`;
      container.innerHTML = state.cart.map(item => `
        <div class="bg-white border border-slate-200 rounded-xl p-3 flex items-center justify-between gap-2">
          <div class="min-w-0 flex-1">
            <div class="text-[10px] font-mono font-bold text-amber-700">#${item.model} • ${item.unit}</div>
            <h5 class="font-bold text-slate-900 text-sm truncate">${item.name}</h5>
            <div class="text-xs font-mono text-slate-600">৳${item.price} × ${item.qty} = <strong>৳${item.price * item.qty}</strong></div>
          </div>
          <div class="flex items-center border border-slate-200 rounded-lg bg-slate-50">
            <button onclick="updateCartItemQty(${item.id}, -1)" class="w-6 h-6 text-xs font-bold cursor-pointer">−</button>
            <span class="w-6 text-center text-xs font-bold font-mono">${item.qty}</span>
            <button onclick="updateCartItemQty(${item.id}, 1)" class="w-6 h-6 text-xs font-bold cursor-pointer">+</button>
          </div>
        </div>
      `).join('');
    }
    function toggleCart(open) {
      const drawer = document.getElementById('cart-drawer');
      const backdrop = document.getElementById('cart-backdrop');
      if (open) { renderCart(); backdrop.classList.remove('hidden'); setTimeout(() => drawer.classList.remove('translate-x-full'), 10); }
      else { drawer.classList.add('translate-x-full'); setTimeout(() => backdrop.classList.add('hidden'), 280); }
    }
    function openCheckoutModal() {
      if (state.cart.length === 0) return;
      toggleCart(false);
      document.getElementById('checkout-summary-total').textContent = `৳${getCartTotals().grandTotal.toLocaleString()}`;
      const m = document.getElementById('checkout-modal'); m.classList.remove('hidden'); m.classList.add('flex');
    }
    function closeCheckoutModal() { const m = document.getElementById('checkout-modal'); m.classList.add('hidden'); m.classList.remove('flex'); }

    function submitOrder(event) {
      event.preventDefault();
      const name = document.getElementById('cust-name').value.trim();
      const phone = document.getElementById('cust-phone').value.trim();
      const shop = document.getElementById('cust-shop').value.trim();
      const address = document.getElementById('cust-address').value.trim();
      const payment = document.querySelector('input[name="payment-method"]:checked').value;
      const { subtotal, deliveryFee, grandTotal } = getCartTotals();
      const orderNo = 'NCH-' + Math.floor(100000 + Math.random() * 900000);
      const now = new Date();
      const dateStr = now.toLocaleString('bn-BD', { dateStyle: 'medium', timeStyle: 'short' });
      const dateKey = getLocalDateKey(now);

      const orderPayload = {
        id: orderNo,
        source: 'Web Store',
        timestamp: now.getTime(),
        dateKey: dateKey,
        date: dateStr,
        customer: { name: shop ? `${name} (${shop})` : name, phone, address },
        payment,
        deliveryFee,
        subtotal,
        total: grandTotal,
        status: 'Confirmed',
        items: state.cart.map(i => ({ name: i.name, model: i.model, unit: i.unit, qty: i.qty, price: i.price }))
      };

      pushOrderToFirebase(orderPayload);

      clearCart();
      closeCheckoutModal();
      document.getElementById('checkout-form').reset();

      openA5MemoForOrder(orderNo, false);
      showToast('অর্ডার কনফার্ম হয়েছে এবং A5 মেমো তৈরি হয়েছে!');
    }

    function openBulkModal() { const m = document.getElementById('bulk-modal'); m.classList.remove('hidden'); m.classList.add('flex'); }
    function closeBulkModal() { const m = document.getElementById('bulk-modal'); m.classList.add('hidden'); m.classList.remove('flex'); }
    function submitBulkQuote(e) { e.preventDefault(); closeBulkModal(); showToast('কোটেশন কপি হয়েছে!'); }

    function showToast(message) {
      const container = document.getElementById('toast-container');
      const toast = document.createElement('div');
      toast.className = 'bg-slate-900 text-white border border-amber-500/50 px-4 py-3 rounded-xl shadow-xl text-xs sm:text-sm font-medium flex items-center gap-2.5';
      toast.innerHTML = `<span class="w-2 h-2 rounded-full bg-amber-400"></span><span>${message}</span>`;
      container.appendChild(toast);
      setTimeout(() => toast.remove(), 4000);
    }

    window.addEventListener('DOMContentLoaded', async () => {
      const loaded = await loadProductsFromCSV();

      PRODUCTS = loaded.map((item, idx) => ({
        id: idx + 1,
        name: item.name,
        model: String(item.model),
        unit: item.unit,
        cat: item.cat,
        price: item.price,
        basePrice: item.price,
        image: item.image || ""
      }));

      applyCustomRatesToProducts();
      PRODUCTS.forEach(p => { state.cardQuantities[p.id] = 1; });

      renderCategoryTabs();
      renderProducts();
      renderCart();
      refreshOrderAndMemoViews();
      syncCustomRatesFromFirebase();
      fetchCloudOrders(false);
      setInterval(() => fetchCloudOrders(true), 5000);
    });