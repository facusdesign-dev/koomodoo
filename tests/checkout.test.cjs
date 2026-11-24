const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function setup(reviewCart, reserveOrder) {
  const element = () => ({ replaceChildren() {}, append() {}, style: {} });
  const context = { window: {}, setInterval() {}, console: { error() {},warn() {} },
    crypto: { randomUUID: () => 'same-key' }, escHtml: String, updateBadges() {}, nav() {}, toast() {},
    currentPage: 'carrito', KMD: { session: { user: { id: 'buyer' } } },
    CommerceModule: { reviewCart, reserveOrder }, Delivery:{choose(){}},
    document: { getElementById: element, createElement: element },
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
