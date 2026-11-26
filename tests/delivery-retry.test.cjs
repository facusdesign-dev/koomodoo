const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { setImmediate: settle } = require('node:timers/promises');

class Element {
  constructor() {
    this.children = [];
    this.value = '';
    this.style = {};
  }
  append(...nodes) {
    for (const n of nodes) if (typeof n === 'object') n.parentElement = this;
    this.children.push(...nodes);
  }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  insertBefore(node, ref) { this.children.splice(this.children.indexOf(ref), 0, node); }
  get options() { return this.children; }
  add(option) { this.append(option); }
}

test('retiro sin stock: el reintento reserva solo el envio elegido', async () => {
  const pickup = { id: 'punto', mode: 'pickup', label: 'Local', fee: 0, zone: 'Salto', eta: 'Hoy' };
  const agency = { ...pickup, id: 'agencia', mode: 'agency', label: 'Agencia', fee: 80 };
  const item = { pid: 'p', variantId: 'v', sellerId: 's', currency: 'UYU', qty: 1, price: 200 };
  const destination = 'Sucursal Centro';
  const calls = [], messages = [];
  let stock = 0;
  const db = {
    from(table) {
      const data = {
        products: { status: 'published', currency: 'UYU', user_id: 's', title: 'Producto' },
        product_variants: [{ id: 'v', price: 200, stock, label: 'Unica' }],
        public_profiles: [], shop_delivery: [pickup, agency],
      };
      assert.ok(Object.hasOwn(data, table), table);
      const read = () => ({ data: data[table] });
      return { select() { return this; }, eq() { return this; }, single: read, order: read, in: read };
    },
    rpc(name, args) {
      calls.push({ name, args: structuredClone(args) });
      return { data: { id: 'pedido', status: 'pending_payment' } };
    },
  };
  const roots = new Map();
  const ctx = vm.createContext({
    sessionStorage: require('./tab-storage.cjs')(),
    cart: [item], currentPage: 'carrito', KMD: { session: { user: { id: 'comprador' } } },
    getSB: () => db, crypto: { randomUUID: () => 'test-key' }, escHtml: String,
    setInterval() {}, updateBadges() {}, nav() {}, toast: msg => messages.push(msg),
    document: {
      createElement: () => new Element(),
      getElementById(id) {
        if (!roots.has(id)) roots.set(id, new Element());
        return roots.get(id);
      },
    },
    Option: class { constructor(text, value) { Object.assign(this, { text, value }); } },
  });
  ctx.window = ctx;
  for (const file of ['commerce.js', 'commerce-ui.js', 'delivery.js']) {
    vm.runInContext(fs.readFileSync(require.resolve('../' + file), 'utf8'), ctx, { filename: file });
  }
  function choose(option) {
    const section = roots.get('cart-items').children[0];
    const form = section.children.find(n => n.children?.some(l => l.children?.[0]?.onchange));
    assert.ok(form, 'El carrito debe permitir elegir la entrega');
    const [zone, method, address] = form.children.map(label => label.children[0]);
    zone.value = option.zone;
    zone.onchange();
    assert.ok(method.options.some(o => o.value === option.id));
    method.value = option.id;
    method.onchange();
    return { address, button: section.children.find(n => n.className === 'ck-btn') };
  }

  ctx.CommerceUI.renderCart();
  await settle();
  const first = choose(pickup);
  assert.equal(first.button.disabled, false);
  first.button.onclick();
  await settle();
  assert.match(messages.at(-1), /stock insuficiente/i);
  assert.equal(calls.length, 0);
  assert.equal(ctx.cart.length, 1);

  stock = 1;
  const retry = choose(agency);
  assert.equal(retry.button.disabled, true);
  retry.address.value = destination;
  retry.address.oninput();
  assert.equal(retry.button.disabled, false);
  retry.button.onclick();
  await settle();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'reserve_delivery_order');
  assert.deepEqual(calls[0].args.p_delivery, { ...agency, destination });
  assert.deepEqual(calls[0].args.p_items, [{ variant_id: 'v', quantity: 1, expected_unit_price: 200 }]);
  assert.equal(ctx.cart.length, 0);
});
