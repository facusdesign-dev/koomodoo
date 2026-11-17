window.CommerceUI = (() => {
  let intent = null;
  let checkingOut = false;
  let inventory = [];
  const money = (value, code = 'UYU') => new Intl.NumberFormat('es-UY', { style: 'currency', currency: code }).format(Number(value));
  const escape = value => escHtml(String(value ?? ''));
  const errorMessage = error => error?.message || 'No se pudo completar la operacion.';
  async function refreshCatalog() {
    const { data, error } = await getSB().from('products').select('*').eq('status', 'published').order('created_at', { ascending: false }).limit(100);
    if (error) throw error;
    PRODUCT_STORE.splice(0, PRODUCT_STORE.length, ...(data || []).map(normalizeProductRecord));
  }

  function variantEditor() {
    const colors = splitValues(document.getElementById('pub-colors').value);
    const sizes = splitValues(document.getElementById('pub-sizes').value);
    const previous = new Map(inventory.map(row => [row.label, row]));
    inventory = (colors.length ? colors : ['']).flatMap(color => (sizes.length ? sizes : ['']).map(size => {
      const label = [color, size].filter(Boolean).join(' / ') || 'Unica';
      return previous.get(label) || { label, attributes: { color, size }, price: Number(document.getElementById('pub-price').value), stock: colors.length || sizes.length ? 0 : Number(document.getElementById('pub-stock').value) };
    }));
    if (window.Catalog && document.getElementById('pub-axis-fields')) {
      try { const axes=Catalog.publishAxes();inventory=Catalog.combinations(axes,document.getElementById('pub-price').value,axes.length?0:document.getElementById('pub-stock').value).map(row=>previous.get(row.label)||row); }
      catch(error){toast(error.message);return;}
    }
    if (inventory.length > 100) { inventory = []; toast('Limite: 100 combinaciones por producto.'); return; }
    const box = document.getElementById('pub-inventory');
    box.replaceChildren();
    for (const row of inventory) {
      const line = document.createElement('div');
      line.style.cssText = 'display:grid;grid-template-columns:1fr 95px 75px;gap:8px;align-items:center;margin:8px 0';
      const title = document.createElement('span'); title.textContent = row.label;
      const price = document.createElement('input'); price.className = 'fi'; price.type = 'number'; price.min = '0.01'; price.step = '0.01'; price.value = row.price; price.setAttribute('aria-label', `Precio ${row.label}`);
      price.oninput = () => { row.price = Number(price.value); };
      const stock = document.createElement('input'); stock.className = 'fi'; stock.type = 'number'; stock.min = '0'; stock.step = '1'; stock.value = row.stock; stock.setAttribute('aria-label', `Stock ${row.label}`);
      stock.oninput = () => { row.stock = Number(stock.value); };
      line.append(title, price, stock); box.append(line);
    }
  }
  function getInventory() {
    if (window.Catalog && document.getElementById('pub-axis-fields')) {
      const axes=Catalog.publishAxes();
      if(!axes.length)return Catalog.combinations([],document.getElementById('pub-price').value,document.getElementById('pub-stock').value);
      const expected=Catalog.combinations(axes,1).map(row=>row.label);
      if(JSON.stringify(expected)!==JSON.stringify(inventory.map(row=>row.label)))throw new Error('Genera las variantes de esta categoria antes de publicar.');
      if(!inventory.some(row=>row.stock>0))throw new Error('Carga stock para al menos una variante.');
      return inventory.map(row=>({...row}));
    }
    const colors = splitValues(document.getElementById('pub-colors').value);
    const sizes = splitValues(document.getElementById('pub-sizes').value);
    const expected = (colors.length ? colors : ['']).flatMap(color => (sizes.length ? sizes : ['']).map(size => [color, size].filter(Boolean).join(' / ') || 'Unica'));
    if (!colors.length && !sizes.length) return [{ label: 'Unica', attributes: {}, price: Number(document.getElementById('pub-price').value), stock: Number(document.getElementById('pub-stock').value) }];
    if (!inventory.length || JSON.stringify(expected) !== JSON.stringify(inventory.map(row => row.label))) throw new Error('Genera las variantes y asigna su stock antes de publicar.');
    if (!inventory.some(row => row.stock > 0)) throw new Error('Carga stock para al menos una variante.');
    return inventory.map(row => ({ ...row }));
  }
  function resetInventory() { inventory = []; document.getElementById('pub-inventory')?.replaceChildren(); }

  function modal() {
    document.getElementById('commerce-detail')?.remove();
    const overlay = document.createElement('div'); overlay.id = 'commerce-detail';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:2500;display:flex;align-items:center;justify-content:center;padding:16px';
    const panel = document.createElement('section'); panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-label', 'Detalle del producto');
    panel.style.cssText = 'background:var(--bg2);color:var(--t);border:1px solid var(--b2);border-radius:20px;padding:24px;width:100%;max-width:520px;max-height:90vh;overflow:auto';
    const close = document.createElement('button'); close.className = 'btn-p btn-sec'; close.textContent = 'Cerrar'; close.onclick = () => overlay.remove();
    overlay.onclick = event => { if (event.target === overlay) overlay.remove(); };
    panel.append(close); overlay.append(panel); document.body.append(overlay);
    return { overlay, panel };
  }
  async function showProduct(id) {
    const { overlay, panel } = modal();
    const content = document.createElement('div'); content.textContent = 'Cargando producto...'; panel.append(content);
    try {
      const { product: p, variants } = await CommerceModule.getProductDetails(id);
      content.innerHTML = `<h2 style="margin:18px 0">${escape(p.title)}</h2><p style="white-space:pre-wrap;margin:12px 0">${escape(p.description)}</p>`;
      for (const url of p.media_urls || []) {
        if (!/^https:\/\//.test(url)) continue;
        const img = document.createElement('img'); img.src = url; img.alt = p.title; img.style.cssText = 'width:100%;max-height:260px;object-fit:contain;border-radius:12px;margin-bottom:10px'; content.append(img);
      }
      if (p.variants?.details) { const specs=document.createElement('dl');specs.className='product-specs';for(const [key,value] of Object.entries(p.variants.details)){if(!value)continue;const term=document.createElement('dt'),description=document.createElement('dd');term.textContent=window.Catalog?Catalog.config(p.category,p.variants.subcategory).details.find(f=>f.key===key)?.label||key:key;description.textContent=String(value);specs.append(term,description);}content.append(specs); }
      const select = document.createElement('select'); select.className = 'fi'; select.setAttribute('aria-label', 'Variante del producto');
      const remaining = variant => Math.max(0, Number(variant.stock) - Number(cart.find(item => item.variantId === variant.id)?.qty || 0));
      for (const variant of variants) {
        const option = document.createElement('option'); option.value = variant.id; option.disabled = remaining(variant) <= 0;
        option.textContent = `${variant.label} · ${money(variant.price, p.currency)} · ${remaining(variant)} para agregar`; select.append(option);
      }
      const available = variants.find(v => remaining(v) > 0); select.value = available?.id || variants[0]?.id || '';
      const quantityLabel = document.createElement('label'); quantityLabel.textContent = 'Cantidad';
      const quantity = document.createElement('input'); quantity.type = 'number'; quantity.min = '1'; quantity.step = '1'; quantity.value = '1'; quantity.className = 'fi'; quantity.setAttribute('aria-label', 'Cantidad para agregar'); quantityLabel.append(quantity);
      const availability = document.createElement('div'); availability.setAttribute('role', 'status'); availability.style.cssText = 'font-size:12px;line-height:1.6;margin:14px 0';
      let selectionVersion = 0;
      const remove = document.createElement('button'); remove.className = 'btn-p btn-sec';
      remove.onclick = () => {
        if (checkingOut) { toast('Espera a que termine el pedido actual.'); return; }
        selectionVersion++; cart = cart.filter(item => item.pid !== p.id); intent = null;
        updateBadges(); quantity.value = '1'; updateSelection(); toast('Producto quitado del carrito.');
      };
      const add = document.createElement('button'); add.className = 'pub-btn'; add.style.marginTop = '15px';
      function updateSelection() {
        const variant = variants.find(row => row.id === select.value), count = remaining(variant || { id: '', stock: 0 });
        const inCart = Number(cart.find(item => item.variantId === variant?.id)?.qty || 0);
        const amount = Number(quantity.value), valid = Number.isInteger(amount) && amount > 0 && amount <= count && inCart + amount <= 99;
        quantity.max = String(Math.max(0, Math.min(99 - inCart, count))); quantity.disabled = count === 0 || inCart >= 99;
        add.disabled = !valid;
        add.textContent = count > 0 ? 'Confirmar y agregar al carrito' : 'Sin unidades para agregar';
        availability.replaceChildren();
        const stats = document.createElement('dl'); stats.style.cssText = 'display:grid;grid-template-columns:1fr auto;gap:8px 16px;padding:14px;background:var(--surf);border-radius:12px;margin:0 0 12px';
        for (const [label, value] of [['Cantidad en tienda', variant?.total_stock ?? variant?.stock ?? 0], ['Disponible', variant?.stock ?? 0], ['En tu carrito', inCart]]) {
          const name = document.createElement('dt'); name.textContent = label;
          const number = document.createElement('dd'); number.textContent = String(value); number.style.cssText = 'margin:0;font-weight:800'; stats.append(name, number);
        }
        const note = document.createElement('p'); note.textContent = 'El carrito no reserva ni descuenta stock. El stock total se descuenta unicamente al aprobarse el pago.';
        const pending = document.createElement('p'); pending.style.cssText = 'font-size:11px;color:var(--t3);margin-top:6px';
        pending.textContent = 'Un pedido pendiente puede apartar disponibilidad por 15 minutos; no equivale a una venta pagada.';
        const selection = document.createElement('p'); selection.style.marginTop = '8px';
        selection.textContent = count > 0 ? `Si agregas ${valid ? amount : 0}, podras agregar ${Math.max(0, count - (valid ? amount : 0))} mas a tu carrito.`
          : Number(variant?.stock || 0) > 0 ? 'Ya tenes en el carrito todas las unidades disponibles de esta variante.'
          : Number(variant?.reserved_stock || 0) > 0 ? 'Sin disponibilidad por reservas pendientes.' : 'Agotado.';
        availability.append(stats, note, pending, selection);
        const productQuantity = cart.filter(item => item.pid === p.id).reduce((sum, item) => sum + item.qty, 0);
        remove.textContent = productQuantity ? `Quitar producto del carrito (${productQuantity})` : 'Este producto no esta en tu carrito';
        remove.disabled = !productQuantity;
        for (const option of select.children) {
          const row = variants.find(v => v.id === option.value); option.disabled = !row || remaining(row) <= 0;
          if (row) option.textContent = `${row.label} · ${money(row.price, p.currency)} · ${remaining(row)} para agregar`;
        }
      }
      select.onchange = () => { quantity.value = '1'; updateSelection(); };
      quantity.oninput = updateSelection; updateSelection();
      add.onclick = async () => {
        if (checkingOut) { toast('Espera a que termine de confirmarse el pedido actual.'); return; }
        const v = variants.find(row => row.id === select.value), amount = Number(quantity.value);
        if (!v || !Number.isInteger(amount) || amount < 1 || amount > remaining(v) || amount + Number(cart.find(item => item.variantId === v.id)?.qty || 0) > 99) { updateSelection(); return; }
        if (p.user_id === KMD.session?.user?.id) { toast('No puedes comprar tu propio producto.'); return; }
        add.disabled = true; add.textContent = 'Verificando disponibilidad...';
        const version = selectionVersion;
        try {
          const fresh = await CommerceModule.getProductDetails(p.id);
          const current = fresh.variants.find(row => row.id === v.id);
          if (!current || fresh.product.status !== 'published' || current.stock - Number(cart.find(item => item.variantId === v.id)?.qty || 0) < amount) throw new Error('El stock cambio. Volve a abrir el producto para actualizarlo.');
          if (Number(current.price) !== Number(v.price)) throw new Error('El precio cambio. Volve a abrir el producto para revisar el nuevo precio.');
          if (!overlay.isConnected || version !== selectionVersion) return;
        const previous = cart.find(item => item.variantId === v.id);
        if (previous) previous.qty += amount;
        else cart.push({ pid: p.id, variantId: v.id, variantLabel: v.label, title: p.title, price: Number(v.price), currency: p.currency, sellerId: p.user_id, qty: amount });
        intent = null; updateBadges(); overlay.remove(); toast('Producto agregado al carrito.'); if (currentPage === 'carrito') renderCart();
        } catch (error) { if (overlay.isConnected && version === selectionVersion) { availability.textContent = errorMessage(error); add.disabled = false; add.textContent = 'Reintentar agregar'; } }
      };
      const cancel = document.createElement('button'); cancel.className = 'btn-p btn-sec'; cancel.textContent = 'Cancelar seleccion'; cancel.onclick = () => overlay.remove();
      if (p.user_id === KMD.session?.user?.id) {
        const full = document.createElement('button');full.className='pub-btn';full.textContent='Editar publicacion completa';full.onclick=()=>ProductEditor.open(p.id);content.append(full);
        const edit = document.createElement('button'); edit.className = 'pub-btn'; edit.textContent = 'Editar precio y stock';
        edit.onclick = () => editInventory(p.id); content.append(edit); edit.focus();
      } else { content.append(select, quantityLabel, availability, remove, cancel, add); select.focus(); }
    } catch (error) { content.textContent = errorMessage(error); console.error('[KMD] product details:', error); }
  }
  async function editInventory(id) {
    const { overlay, panel } = modal();
    panel.setAttribute('aria-label', 'Editar precio y stock');
    const content = document.createElement('div'); content.textContent = 'Cargando inventario...'; panel.append(content);
    try {
      const { product, variants } = await CommerceModule.getProductDetails(id);
      if (product.user_id !== KMD.session?.user?.id) throw new Error('Solo el vendedor puede editar el inventario.');
      content.replaceChildren();
      const title = document.createElement('h2'); title.textContent = product.title; title.style.margin = '16px 0'; content.append(title);
      const note = document.createElement('p'); note.textContent = 'Editas disponibilidad para nuevos pedidos. El stock total de tienda incluye tambien las reservas pendientes y solo baja al aprobarse el pago. Cancelar o vencer libera disponibilidad, sin aumentar el total. Los precios de pedidos existentes no cambian.';
      note.style.cssText = 'font-size:12px;color:var(--t3);line-height:1.6;margin:12px 0'; content.append(note);
      const form = document.createElement('form');
      const fields = variants.map(variant => {
        const label = document.createElement('h3'); label.textContent = variant.label; label.style.cssText = 'font-size:14px;margin:18px 0 8px'; form.append(label);
        const pair = document.createElement('div'); pair.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:12px';
        const inputs = [['Precio ' + product.currency, variant.price, '0.01', '0.01'], ['Stock disponible', variant.stock, '0', '1']].map(([text, value, min, step]) => {
          const wrapper = document.createElement('label'); wrapper.textContent = text;
          const input = document.createElement('input'); input.className = 'fi'; input.type = 'number'; input.required = true;
          input.value = value; input.min = min; input.step = step; input.setAttribute('aria-label', `${text} ${variant.label}`);
          wrapper.append(input); pair.append(wrapper); return input;
        });
        form.append(pair); return { variant, price: inputs[0], stock: inputs[1] };
      });
      const status = document.createElement('p'); status.setAttribute('role', 'status'); status.style.margin = '12px 0'; form.append(status);
      const save = document.createElement('button'); save.type = 'submit'; save.className = 'pub-btn'; save.textContent = 'Guardar precio y stock'; form.append(save);
      form.onsubmit = async event => {
        event.preventDefault(); if (save.disabled || !form.reportValidity()) return;
        const values = fields.map(({ variant, price, stock }) => ({ ...variant, price: Number(price.value), stock: Number(stock.value) }));
        save.disabled = true; save.textContent = 'Guardando...'; status.textContent = '';
        try {
          await CommerceModule.saveInventory(id, values);
        } catch (error) {
          status.textContent = errorMessage(error); save.disabled = false; save.textContent = 'Guardar precio y stock'; return;
        }
        // Saving succeeded even if refreshing the surrounding catalogue fails.
        try { await refreshCatalog(); if (currentPage === 'marketplace') renderProdGrid(); else if (currentPage === 'perfil') setPTab(0); }
        catch (error) { console.error('[KMD] catalog refresh after edit:', error); }
        overlay.remove(); toast('Precio y stock guardados.');
      };
      content.append(form);
    } catch (error) { content.textContent = errorMessage(error); console.error('[KMD] inventory editor:', error); }
  }
  function renderCart() {
    const box = document.getElementById('cart-items');
    const summary = document.getElementById('cart-summary');
    document.getElementById('cart-count').textContent = cart.length ? `(${cart.reduce((n, row) => n + row.qty, 0)} articulos)` : '';
    box.replaceChildren(); summary.replaceChildren();
    if (!cart.length) { box.innerHTML = '<div class="empty"><div class="empty-t">Carrito vacio</div><div class="empty-s">Selecciona un producto del marketplace.</div></div>'; return; }
    for (const item of cart) {
      const line = document.createElement('div'); line.className = 'ci';
      line.innerHTML = `<div style="flex:1"><div class="ci-nm">${escape(item.title)}</div><div class="ci-sl">${escape(item.variantLabel)}</div><div class="ci-pr">${money(item.price * item.qty, item.currency)}</div></div>`;
      for (const [label, delta] of [['-', -1], ['+', 1]]) {
        const btn = document.createElement('button'); btn.className = 'qb'; btn.textContent = label;
        btn.onclick = () => { if (checkingOut) return; item.qty = Math.min(99, item.qty + delta); if (item.qty <= 0) cart.splice(cart.indexOf(item), 1); intent = null; renderCart(); updateBadges(); };
        if (delta === 1) { const qty = document.createElement('span'); qty.textContent = String(item.qty); line.append(qty); }
        line.append(btn);
      }
      const remove = document.createElement('button'); remove.className = 'btn-p btn-sec'; remove.textContent = 'Quitar';
      remove.onclick = () => { if (checkingOut) return; cart.splice(cart.indexOf(item), 1); intent = null; renderCart(); updateBadges(); };
      line.append(remove);
      box.append(line);
    }
    const currencies = [...new Set(cart.map(row => row.currency))];
    summary.innerHTML = `<div class="cs-t">Resumen del pedido</div>${currencies.map(code => `<div class="cs-row"><span>Total ${code}</span><strong>${money(cart.filter(row => row.currency === code).reduce((n, row) => n + row.price * row.qty, 0), code)}</strong></div>`).join('')}<p style="font-size:12px;color:var(--t3);line-height:1.6;margin:12px 0">El carrito no reserva unidades. Crear un pedido retiene disponibilidad por 15 minutos, pero no descuenta el stock total de tienda: eso sucede solo con pago aprobado. Al cancelar o vencer se libera la reserva. Prueba sin cobros; envio a coordinar.</p>`;
    const btn = document.createElement('button'); btn.id = 'create-order-btn'; btn.className = 'ck-btn'; btn.textContent = 'Crear pedido sin pagar'; btn.disabled = checkingOut; btn.onclick = checkout; summary.append(btn);
  }
  async function checkout() {
    if (checkingOut || !cart.length) return;
    if (!KMD.session?.user?.id) { openAuthModal('login'); return; }
    if (new Set(cart.map(row => row.sellerId)).size !== 1 || new Set(cart.map(row => row.currency)).size !== 1) { toast('Crea un pedido por vendedor y moneda.'); return; }
    checkingOut = true; renderCart();
    try {
      // Preserve the submitted intent after an uncertain network response. A retry
      // must retrieve the same order, not re-check already reserved stock first.
      if (!intent) {
        const reviewed = await CommerceModule.reviewCart(cart);
        cart = reviewed.items;
        if (reviewed.priceChanged) {
          throw new Error('Un precio cambio. Actualizamos el carrito: revisa el nuevo total y confirma nuevamente. No se creo un pedido.');
        }
        intent = { items: cart.map(row => ({ variant_id: row.variantId, quantity: row.qty, expected_unit_price: row.price })), key: crypto.randomUUID() };
      }
      const order = await CommerceModule.reserveOrder(intent.items, intent.key);
      if (order?.status === 'expired' || order?.status === 'cancelled' ||
          (order?.expires_at && Date.parse(order.expires_at) <= Date.now())) {
        intent = null;
        throw new Error('La reserva anterior termino. Revisa el stock e intenta crear un nuevo pedido.');
      }
      if (!order?.id || order.status !== 'pending_payment') throw new Error('No se pudo confirmar el pedido pendiente de pago.');
      cart = []; intent = null; updateBadges(); nav('pedidos');
      toast('Pedido creado. Reserva de 15 minutos, sin cobro.');
    } catch (error) {
      if (/^[0-9A-Z]{5}$/.test(error?.code || '')) intent = null;
      console.error('[KMD] reserve order:', error); toast(errorMessage(error));
    }
    finally { checkingOut = false; if (currentPage === 'carrito') renderCart(); }
  }
  let ordersRenderVersion = 0;
  async function renderOrders({ silent = false } = {}) {
    const version = ++ordersRenderVersion;
    const box = document.getElementById('orders-list');
    if (!silent) box.textContent = 'Cargando pedidos...';
    try {
      const orders = await CommerceModule.listOrders();
      if (version !== ordersRenderVersion) return;
      box.dataset.hasPending = String(orders.some(order => order.status === 'pending_payment'));
      box.replaceChildren();
      if (!orders.length) { box.innerHTML = '<div class="empty"><div class="empty-t">Todavia no hay pedidos</div></div>'; return; }
      for (const order of orders) {
        const row = document.createElement('article'); row.className = 'or-card';
        const ownPurchase = order.buyer_id === KMD.session.user.id;
        const state = orderDisplayState(order);
        row.innerHTML = `<div class="or-top"><strong>${ownPurchase ? 'Tu compra' : 'Pedido recibido'} #${escape(order.id.slice(0, 8))}</strong><strong>${money(order.total, order.currency)}</strong></div><p>${escape(state.text)}</p>${(order.order_items || []).map(item => `<p style="margin:8px 0">${escape(item.product_title)} · ${escape(item.variant_label)} · ${item.quantity} × ${money(item.unit_price, order.currency)}</p>`).join('')}`;
        if (state.deadline) {
          const deadline = document.createElement('p'); deadline.style.cssText = 'font-size:12px;color:var(--t3);margin:8px 0';
          deadline.textContent = `Reserva hasta ${new Date(state.deadline).toLocaleString('es-UY')}. Sin cobro.`;
          row.append(deadline);
        }
        const chat = document.createElement('button'); chat.className = 'btn-p btn-sec'; chat.textContent = ownPurchase ? 'Hablar con vendedor' : 'Hablar con comprador'; chat.onclick = () => openChatWith(ownPurchase ? order.seller_id : order.buyer_id); row.append(chat);
        if (order.status === 'pending_payment') {
          const cancel = document.createElement('button'); cancel.className = 'btn-p btn-sec'; cancel.style.margin = '8px'; cancel.textContent = state.overdue ? 'Verificar y liberar reserva' : 'Cancelar y liberar stock';
          cancel.onclick = async () => { cancel.disabled = true; try { const result = await CommerceModule.cancelOrder(order.id); await refreshCatalog(); await renderOrders(); toast(result.status === 'expired' ? 'Reserva vencida. Stock liberado.' : 'Pedido cancelado. Stock liberado.'); } catch (error) { toast(errorMessage(error)); cancel.disabled = false; } };
          row.append(cancel);
        }
        box.append(row);
      }
    } catch (error) { if (!silent && version === ordersRenderVersion) box.textContent = errorMessage(error); console.error('[KMD] orders:', error); }
  }
  function orderDisplayState(order, now = Date.now()) {
    if (order.status === 'expired') return { text: 'Reserva vencida. Stock liberado.' };
    if (order.status === 'cancelled') return { text: 'Cancelado. Stock devuelto.' };
    if (order.status === 'paid') return { text: 'Pago confirmado' };
    const deadline = Date.parse(order.expires_at);
    if (Number.isFinite(deadline) && deadline <= now) return { text: 'Plazo vencido. Verificando liberacion de stock...', overdue: true };
    return { text: 'Pendiente de pago · Sin cobro', deadline: Number.isFinite(deadline) ? deadline : null };
  }
  let refreshingOrders = false;
  setInterval(async () => {
    if (currentPage !== 'pedidos' || document.hidden || refreshingOrders || !KMD.session?.user?.id ||
        document.getElementById('orders-list')?.dataset.hasPending !== 'true') return;
    refreshingOrders = true;
    try { await renderOrders({ silent: true }); } finally { refreshingOrders = false; }
  }, 30000);
  return { money, variantEditor, getInventory, resetInventory, showProduct, editInventory, renderCart, checkout, renderOrders, refreshCatalog, orderDisplayState };
})();
