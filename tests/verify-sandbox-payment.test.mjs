import test from 'node:test';
import assert from 'node:assert/strict';
import { verifySandboxPayment } from '../supabase/functions/_shared/verify-sandbox-payment.mjs';

const payment = { id: 11, collector_id: 12, external_reference: 'qa-123', live_mode: false,
  currency_id: 'UYU', transaction_amount: 100, status: 'approved', status_detail: 'accredited', transaction_amount_refunded: 0 };
const verify = (changes, status = 200) => verifySandboxPayment({ paymentId: '11', token: 'fixture',
  expected: { sellerId: '12', reference: 'qa-123', currency: 'UYU', amountCents: 10000 },
  request: async () => Response.json({ ...payment, ...changes }, { status }) });

test('only an accredited and unrefunded payment qualifies', async () => {
  assert.equal((await verify({})).approved, true);
  for (const changes of [{status:'pending'}, {status:'rejected'}, {status_detail:'pending_review'}, {transaction_amount_refunded:5}])
    assert.equal((await verify(changes)).approved, false);
});
test('wrong order, seller, amount, currency, environment or payment ID fails closed', async () => {
  for (const changes of [{id:22},{collector_id:13},{external_reference:'other'},{live_mode:true},{currency_id:'USD'},{transaction_amount:99}])
    await assert.rejects(verify(changes), /no coincide/);
  await assert.rejects(verify({}, 503), /HTTP 503/);
});
