const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function setup(reviewCart, reserveOrder, sessionStorage = require('./tab-storage.cjs')()) {
  const roots = new Map();
  const element = () => ({ children: [], replaceChildren() { this.children=[]; }, append(...nodes) { this.children.push(...nodes); }, style: {} });
  const context = { window: {}, setInterval() {}, console: { error() {},warn() {} },
    sessionStorage, crypto: { randomUUID: () => 'same-key' }, escHtml: String, updateBadges() {}, nav() {}, toast() {},
    currentPage: 'carrito', KMD: { session: { user: { id: 'buyer' } } },
    CommerceModule: { reviewCart, reserveOrder }, Delivery:{choose(){}},
    document: { getElementById(id) { if (!roots.has(id)) roots.set(id,element()); return roots.get(id); }, createElement: element },
    cart: [{ pid: 'p', variantId: 'v', sellerId: 'seller', currency: 'UYU', qty: 1, price: 1000 }],
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../commerce-ui.js'), 'utf8'), context);
  return context;
}
test('price change requires a second explicit confirmation before reserving', async () => {
  let reservations = 0;
  const context = setup(async items => ({ items: items.map(x => ({ ...x, price: 1200 })), priceChanged: items[0].price !== 1200 }), async () => {
    reservations++; return { id: 'order', status: 'pending_payment' };
  });
  await context.window.CommerceUI.checkout();
  assert.equal(reservations, 0);
  assert.equal(context.cart[0].price, 1200);
  await context.window.CommerceUI.checkout();
  assert.equal(reservations, 1);
});
test('uncertain response retries same intent without checking already reserved stock', async () => {
  let reviews = 0;
  const keys = [];
  const context = setup(async items => { reviews++; return { items, priceChanged: false }; }, async (items, key) => {
    keys.push(key);
    if (keys.length === 1) throw new TypeError('Failed to fetch');
    return { id: 'order', status: 'pending_payment' };
  });
  await context.window.CommerceUI.checkout();
  await context.window.CommerceUI.checkout();
  assert.equal(reviews, 1);
  assert.deepEqual(keys, ['same-key', 'same-key']);
  assert.equal(context.cart.length, 0);
});
test('reservar una tienda no modifica las otras tiendas ni monedas',async()=>{
  let selected;
  const ctx=setup(async items=>({items,priceChanged:false}),async items=>{selected=items;return {id:'order',status:'pending_payment'};});
  ctx.cart.push({...ctx.cart[0],sellerId:'other',variantId:'b'},{...ctx.cart[0],currency:'USD',variantId:'c'});
  await ctx.window.CommerceUI.checkout('seller:UYU');
  assert.equal(selected.length,1);assert.equal(selected[0].variant_id,'v');assert.equal(ctx.cart.length,2);
});
test('una respuesta perdida no confirma silenciosamente una entrega distinta', async () => {
  const calls = [], notices = [];
  const pickup = { id: 'p', mode: 'pickup' };
  const shipping = { id: 's', mode: 'local', destination: 'Destino de prueba' };
  const ctx = setup(async items => ({ items }), async (_items, key, delivery) => {
    calls.push({ key, delivery });
    if (calls.length === 1) throw new TypeError('Respuesta perdida');
    return { id: 'pedido-original', status: 'pending_payment' };
  });
  ctx.toast = message => notices.push(message);
  await ctx.window.CommerceUI.checkout('seller:UYU', pickup);
  await ctx.window.CommerceUI.checkout('seller:UYU', shipping);
  assert.equal(calls.length, 1);
  assert.equal(ctx.cart.length, 1);
  assert.match(notices.at(-1), /recuper/i);
  await ctx.window.CommerceUI.checkout('seller:UYU');
  assert.deepEqual(structuredClone(calls), [calls[0], calls[0]]);
  assert.equal(calls[1].delivery.mode, 'pickup');
  assert.equal(ctx.cart.length, 0);
});
test('tras refrescar con carrito vacio solo el comprador puede recuperar su pedido original', async () => {
  const storage = require('./tab-storage.cjs')(), orders = new Map(), requests = [];
  const reserve = async (items,key,delivery) => {
    requests.push(JSON.stringify({items,key,delivery}));
    if (!orders.has(key)) orders.set(key,{id:'original',status:'pending_payment'});
    if (requests.length === 1) throw new TypeError('Respuesta perdida');
    return orders.get(key);
  };
  const first = setup(async items => ({items}), reserve, storage);
  await first.window.CommerceUI.checkout('seller:UYU',{mode:'agency',destination:'Centro'});
  const after = setup(() => assert.fail('No volver a consultar stock'), reserve, storage);
  after.crypto.randomUUID = () => assert.fail('No generar otra clave');
  after.cart = [];
  const summary = after.document.getElementById('cart-summary');
  after.KMD.session.user.id = 'otra-cuenta';
  after.window.CommerceUI.renderCart();
  assert.equal(summary.children.length,0);
  await after.window.CommerceUI.checkout();
  assert.equal(requests.length,1);
  after.KMD.session.user.id = 'buyer';
  after.window.CommerceUI.renderCart();
  assert.equal(summary.children[0].textContent,'Recuperar mi reserva');
  await summary.children[0].onclick();
  assert.equal(requests.length,2);
  assert.equal(requests[1],requests[0]);
  assert.equal(orders.size,1);
  assert.equal(summary.children.length,0);
});
test('si no se puede guardar el intento no envia la reserva', async () => {
  const storage = require('./tab-storage.cjs')();
  storage.setItem = () => { throw new Error('storage unavailable'); };
  let calls=0;
  const ctx=setup(async items=>({items}),async()=>{calls++;},storage);
  await ctx.window.CommerceUI.checkout();
  assert.equal(calls,0);
  assert.equal(ctx.cart.length,1);
});
