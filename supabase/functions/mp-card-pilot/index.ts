import { guardedCardTest } from '../_shared/guarded-card-test.mjs';
const env=(k:string)=>Deno.env.get(k)?.trim()||'';
const sb=env('SUPABASE_URL');
const cors={'Access-Control-Allow-Origin':'https://koomodoo.vercel.app','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Cache-Control':'no-store'};
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:cors});
Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response(null,{headers:cors});
  if(req.method!=='POST')return reply({},405);
  const auth=req.headers.get('authorization');
  if(!auth?.startsWith('Bearer '))return reply({},401);
  try {
    const who=await fetch(sb+'/auth/v1/user',{headers:{apikey:env('SUPABASE_ANON_KEY'),Authorization:auth}});
    if(!who.ok)return reply({},401);
    const {id}=await who.json();
    if(!/^[0-9a-f-]{36}$/i.test(id))return reply({},401);
    const admin=env('SUPABASE_SERVICE_ROLE_KEY');
    const headers={apikey:admin,Authorization:'Bearer '+admin,'Content-Type':'application/json'};
    const b=await req.json();
    if(b.cartOrder!=null && !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(b.cartOrder))return reply({},400);
    const rows=await fetch(sb+'/rest/v1/mp_sandbox_orders?archived_at=is.null&buyer_id=eq.'+id+
      '&cart_order_id='+(b.cartOrder?'eq.'+b.cartOrder:'is.null'),{headers});
    if(!rows.ok)return reply({},503);
    const [o]=await rows.json();
    if(!o)return reply({state:'unassigned'},403);
    if(o.preference_id||o.review_reason||o.amount_cents<=0||o.amount_cents>10000||o.currency!=='UYU')return reply({state:'review'});
    const pk=env('MP_BRICKS_TEST_PUBLIC_KEY'),token=env('MP_BRICKS_TEST_ACCESS_TOKEN');
    if(!pk || !token.startsWith('TEST-'))return reply({state:'configuration'},503);
    if(b.action==='status'){
      let state=o.attempt_state;
      let closed=false;
      if(o.cart_order_id && ['ready','rejected','processing'].includes(state)){
        const cart=await fetch(sb+'/rest/v1/orders?select=status,expires_at&id=eq.'+o.cart_order_id,{headers});
        if(!cart.ok)return reply({},503);
        const [reservation]=await cart.json();
        closed=!reservation||reservation.status!=='pending_payment'||Date.parse(reservation.expires_at)<=Date.now();
      }
      if(state==='processing' && o.attempt_id){
        const ref='KMD-CARD-'+o.attempt_id;
        const read=async(path:string)=>{
          const r=await fetch('https://api.mercadopago.com'+path,{headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(6000)});
          if(!r.ok)throw Error('Consulta no disponible');return r.json();
        };
        const hits=await read('/v1/payments/search?limit=2&external_reference='+encodeURIComponent(ref));
        if(hits.paging?.total>1)state='review';
        if(hits.paging?.total===1 && /^\d+$/.test(String(hits.results?.[0]?.id))){
          const pid=String(hits.results[0].id),p=await read('/v1/payments/'+pid);
          if(String(p.id)!==pid || p.external_reference!==ref || p.live_mode!==false ||
            String(p.collector_id)!==o.seller_id || p.transaction_amount!==o.amount_cents/100 || p.currency_id!==o.currency)state='review';
          else{
            const verified=p.status==='rejected'?'rejected':p.status==='approved'&&p.status_detail==='accredited'&&p.transaction_amount_refunded===0?'approved':null;
            if(verified && await rpc('finish_mp_test_attempt',{p_order:o.reference,p_attempt:o.attempt_id,p_state:verified,p_payment:pid}))state=verified;
          }
        }
      }
      if(closed && ['ready','rejected'].includes(state))state='closed';
      if(closed && state==='processing')state='closed_pending';
      return reply({state,order:o.reference,amount:o.amount_cents/100,previous:state==='rejected'?o.attempt_id:null,publicKey:pk});
    }
    if(b.order!==o.reference)return reply({state:'review'},409);
    if(b.action!=='pay'||!/^\w{16,128}$/.test(b.token||'')||!/^\w{1,40}$/.test(b.method||'')||
       typeof b.email!=='string'||b.email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email)||/@testuser\.com$/i.test(b.email)||
       !(b.previous==null||/^[a-f\d-]{36}$/i.test(b.previous)))return reply({state:'invalid'},400);
    async function rpc(name:string,args:unknown){
      const r=await fetch(sb+'/rest/v1/rpc/'+name,{method:'POST',headers,body:JSON.stringify(args)});
      if(!r.ok)throw Error('RPC');
      const result=await r.json();
      if(name==='finish_mp_test_attempt' && result && o.cart_order_id){
        const check=await fetch(sb+'/rest/v1/mp_sandbox_orders?select=review_reason&reference=eq.'+o.reference,{headers});
        if(!check.ok)throw Error('No se pudo verificar la liquidación');
        const [settled]=await check.json();return !!settled && !settled.review_reason;
      }
      return result;
    }
    return reply(await guardedCardTest({order:o.reference,previous:b.previous??null,cardToken:b.token,method:b.method,email:b.email,
      identification:b.identification,issuer:b.issuer,
      token,seller:o.seller_id,
      claim:(order:string,previous:string|null)=>rpc('claim_mp_test_attempt',{p_order:order,p_previous:previous}),
      finish:(order:string,attempt:string,state:string,payment:string)=>rpc('finish_mp_test_attempt',{p_order:order,p_attempt:attempt,p_state:state,p_payment:payment})
    }));
  }catch{return reply({state:'unknown'},503);}
});
