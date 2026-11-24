// Server only. Expected values must come from the stored checkout, never the browser.
export async function verifySandboxPayment({ paymentId, token, expected, request = fetch }) {
  if (!/^\d+$/.test(String(paymentId)) || !token || !expected?.reference ||
      !/^\d+$/.test(String(expected.sellerId)) || expected.currency !== 'UYU' ||
      !Number.isSafeInteger(expected.amountCents) || expected.amountCents <= 0) {
    throw Error('Datos de verificacion incompletos');
  }
  const response = await request('https://api.mercadopago.com/v1/payments/' + paymentId, {
    headers: { Authorization: 'Bearer ' + token }, redirect: 'error',
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw Error('Consulta de pago: HTTP ' + response.status);
  const p = await response.json();
  if (p.live_mode !== false || String(p.id) !== String(paymentId) ||
      String(p.collector_id) !== String(expected.sellerId) || p.currency_id !== expected.currency ||
      p.external_reference !== expected.reference || p.transaction_amount !== expected.amountCents / 100) {
    throw Error('El pago no coincide con el pedido de prueba');
  }
  return { paymentId: String(p.id), status: p.status,
    approved: p.status === 'approved' && p.status_detail === 'accredited' && p.transaction_amount_refunded === 0 };
}
