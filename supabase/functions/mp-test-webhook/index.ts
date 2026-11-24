import { authenticatedPaymentId } from './handler.mjs';
import { verifySandboxPayment } from '../_shared/verify-sandbox-payment.mjs';
import { closePreference } from '../_shared/close-preference.mjs';

Deno.serve(async req => {
  if (req.method !== 'POST') return new Response(null,{status:405});
  const env = (name:string) => Deno.env.get(name)?.trim();
  const secret = env('MP_TEST_WEBHOOK_SECRET'), token = env('MP_TEST_CHECKOUT_ACCESS_TOKEN');
  const admin = env('SUPABASE_SERVICE_ROLE_KEY'), seller = env('MP_TEST_SELLER_ID');
  if (!secret || !token || !admin || !seller) return new Response(null,{status:503});
  try {
    const id = await authenticatedPaymentId(req,secret);
    if (!id) return new Response(null,{status:401});
    const payment = await fetch('https://api.mercadopago.com/v1/payments/'+id,{
      headers:{Authorization:'Bearer '+token}, redirect:'error',signal:AbortSignal.timeout(10000)});
    if (!payment.ok) return new Response(null,{status:502});
    const p = await payment.clone().json();
    const ref = /^KMD-QA-([\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12})$/i.exec(p.external_reference)?.[1];
    if (!ref || String(p.collector_id)!==seller) return new Response(null,{status:204});
    const url = env('SUPABASE_URL')+'/rest/v1/mp_sandbox_orders?reference=eq.'+ref;
    const headers = {apikey:admin,Authorization:'Bearer '+admin,'Content-Type':'application/json'};
    const rows = await fetch(url,{headers});
    if (!rows.ok) return new Response(null,{status:503});
    const [order] = await rows.json();
    if (!order) return new Response(null,{status:204});
    // Closing a matching checkout is protective; it never authorizes settlement.
    if (order.preference_id && order.seller_id===seller && String(p.id)===id &&
        p.transaction_amount===order.amount_cents/100 && p.currency_id===order.currency &&
        ['approved','authorized','in_process','pending','in_mediation'].includes(p.status)) {
      await closePreference({id:order.preference_id,reference:p.external_reference,seller,token});
    }
    if (p.live_mode !== false || order.review_reason) return new Response(null,{status:204});
    const result = await verifySandboxPayment({paymentId:id,token,expected:{
      reference:'KMD-QA-'+order.reference,sellerId:order.seller_id,
      currency:order.currency,amountCents:order.amount_cents},request:async()=>payment});
    if (result.approved && !order.payment_id) {
      const saved = await fetch(url+'&payment_id=is.null&review_reason=is.null',{method:'PATCH',headers,
        body:JSON.stringify({payment_id:id,paid_at:new Date().toISOString()})});
      if (!saved.ok) return new Response(null,{status:503});
    }
    return new Response(null,{status:204});
  } catch { return new Response(null,{status:503}); }
});
