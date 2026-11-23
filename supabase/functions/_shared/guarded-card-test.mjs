// Server only: claim is the service-role RPC; finish must compare-and-set by attempt ID.
// Do not expose as a browser endpoint without checking order ownership first.
export async function guardedCardTest({order,previous=null,cardToken,method,email,identification,issuer,token,seller,claim,finish,request=fetch}) {
  if (!cardToken || !method || !email || !token || !seller) throw Error('Faltan datos de prueba');
  const api='https://api.mercadopago.com';
  const headers={Authorization:'Bearer '+token};
  const get=async path=>{
    const r=await request(api+path,{headers,redirect:'error',signal:AbortSignal.timeout(10000)});
    if(!r.ok) throw Error('No se pudo verificar la respuesta');
    return r.json();
  };
  const user=await get('/users/me');
  if(!token.startsWith('TEST-') || String(user.id)!==seller || user.site_id!=='MLU') throw Error('Se requiere credencial de prueba del vendedor asignado');
  const lock=await claim(order,previous);
  if(!lock.send) return {state:lock.state};
  if(lock.seller!==seller || lock.currency!=='UYU' || !Number.isSafeInteger(lock.amountCents) || lock.amountCents<=0)
    throw Error('Pedido incompatible; revisar antes de reintentar');
  const reference='KMD-CARD-'+lock.attempt;
  const amount=lock.amountCents/100;
  const response=await request(api+'/v1/payments',{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),
    headers:{...headers,'Content-Type':'application/json','X-Idempotency-Key':lock.attempt},
    body:JSON.stringify({token:cardToken,payment_method_id:method,installments:1,transaction_amount:amount,
      issuer_id:/^\d{1,12}$/.test(String(issuer))?String(issuer):undefined,
      payer:{email,identification:identification && /^[\w-]{1,16}$/.test(identification.type) &&
        /^[\w-]{1,24}$/.test(identification.number)?{type:identification.type,number:identification.number}:undefined},
      external_reference:reference,description:'Koomodoo - ensayo sin entrega'})});
  if(!response.ok) {
    const error=await response.json().catch(()=>({}));
    const code=String(error?.cause?.[0]?.code??'');
    console.warn('card-pilot: provider request not accepted',{attempt:lock.attempt,http:response.status,
      code:/^[a-z\d_-]{1,48}$/i.test(code)?code:'unknown'});
    return {state:'processing'};
  }
  const {id}=await response.json();
  if(!/^\d+$/.test(String(id))) return {state:'processing'};
  const p=await get('/v1/payments/'+id);
  if(String(p.id)!==String(id)||p.live_mode!==false||String(p.collector_id)!==seller||
    p.currency_id!=='UYU'||p.transaction_amount!==amount||p.external_reference!==reference) return {state:'processing'};
  const state=p.status==='rejected'?'rejected':
    p.status==='approved'&&p.status_detail==='accredited'&&p.transaction_amount_refunded===0?'approved':'processing';
  if(state!=='processing' && !await finish(order,lock.attempt,state,String(id))) return {state:'review'};
  return {state,attempt:lock.attempt};
}

export function sandboxAttemptStore(admin) {
  async function rpc(name,args) {
    const {data,error}=await admin.rpc(name,args);
    if(error) throw Error('No se pudo verificar el estado del intento');
    return data;
  }
  return {
    claim:(order,previous)=>rpc('claim_mp_test_attempt',{p_order:order,p_previous:previous}),
    finish:(order,attempt,state,payment)=>rpc('finish_mp_test_attempt',{
      p_order:order,p_attempt:attempt,p_state:state,p_payment:payment})
  };
}
