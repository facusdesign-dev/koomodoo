// One operator-initiated sandbox rehearsal. No order or payment mutations.
const app='6562544751655464', redirect='https://qbpvrfouhsycbzgzltih.supabase.co/functions/v1/mp-test-callback';
const headers={'cache-control':'no-store','referrer-policy':'no-referrer','content-type':'text/plain; charset=utf-8'};
const reply=(body:string,status:number)=>new Response(body,{status,headers});
Deno.serve(async req=>{
  if(req.method!=='GET')return reply('Metodo no permitido.',405);
  const params=new URL(req.url).searchParams;
  const code=params.get('code'),state=params.get('state');
  if(!code||!state)return reply('Este retorno requiere una autorizacion de prueba iniciada por el operador.',400);
  const secret=Deno.env.get('MP_PILOT_CLIENT_SECRET'),seller=Deno.env.get('MP_TEST_SELLER_ID');
  const verifier=Deno.env.get('MP_PILOT_PKCE_VERIFIER'),expected=Deno.env.get('MP_PILOT_STATE');
  const until=Number(Deno.env.get('MP_PILOT_EXPIRES_MS'));
  if(!secret||!seller||!verifier||!expected||expected.length<32||!Number.isFinite(until)||until<=Date.now()||until>Date.now()+900000)
    return reply('El ensayo privado no esta habilitado.',403);
  if(state!==expected)return reply('Autorizacion de prueba no valida.',403);
  try{
    const res=await fetch('https://api.mercadopago.com/oauth/token',{method:'POST',redirect:'error',headers:{'content-type':'application/json'},body:JSON.stringify({client_id:app,client_secret:secret,grant_type:'authorization_code',code,redirect_uri:redirect,code_verifier:verifier,test_token:true})});
    if(!res.ok)return reply('Mercado Pago no autorizo este ensayo.',403);
    const access=await res.json();
    if(access.live_mode!==false||String(access.user_id)!==seller||!access.access_token)return reply('Se requiere el vendedor ficticio autorizado.',403);
    const auth={Authorization:'Bearer '+access.access_token};
    const who=await fetch('https://api.mercadopago.com/users/me',{headers:auth,redirect:'error'});
    if(!who.ok)return reply('No se pudo validar la cuenta de prueba.',403);
    const me=await who.json();
    if(String(me.id)!==seller||me.site_id!=='MLU'||!me.tags?.includes('test_user'))return reply('Cuenta de prueba no valida.',403);
    const result=await fetch('https://api.mercadopago.com/checkout/preferences',{method:'POST',redirect:'error',headers:{...auth,'content-type':'application/json'},body:JSON.stringify({items:[{title:'Koomodoo piloto sin entrega',currency_id:'UYU',unit_price:100,quantity:1}],marketplace_fee:5,external_reference:'qa-'+crypto.randomUUID()})});
    if(!result.ok)return reply('No se pudo crear la preferencia de prueba.',502);
    const pref=await result.json(),target=new URL(pref.sandbox_init_point);
    if(target.origin!=='https://sandbox.mercadopago.com.uy'||target.username||target.password||String(pref.collector_id)!==seller||String(pref.client_id)!==app||Number(pref.marketplace_fee)!==5)return reply('No se pudo verificar el checkout de prueba.',502);
    return new Response(null,{status:303,headers:{...headers,location:target.href}});
  }catch{return reply('No se pudo completar el ensayo privado.',502);}
});
