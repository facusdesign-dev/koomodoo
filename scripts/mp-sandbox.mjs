// Server-side smoke test only. Never import into the storefront.
import { pathToFileURL } from 'node:url';

export async function prepareSandbox({token,seller,app,request=fetch}) {
  if(!token || !/^\d+$/.test(seller||'') || !/^\d+$/.test(app||'')) throw Error('Faltan el token OAuth del vendedor de prueba, su ID y el ID de la aplicación.');
  async function api(path,options={}) {
    const result=await request('https://api.mercadopago.com'+path,{...options,redirect:'error',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'}});
    if(!result.ok)throw Error('Mercado Pago: '+result.status+' en '+path);
    return result.json();
  }
  const me=await api('/users/me');
  if(String(me.id)!==seller || me.site_id!=='MLU' || !me.tags?.includes('test_user'))throw Error('Se requiere el vendedor ficticio de Uruguay. No se creó el checkout.');
  const pref=await api('/checkout/preferences',{method:'POST',body:JSON.stringify({
    items:[{title:'KOOMODOO · prueba sin entrega',quantity:1,currency_id:'UYU',unit_price:100}],
    marketplace_fee:5,external_reference:'qa-koomodoo-'+crypto.randomUUID()
  })});
  if(String(pref.collector_id)!==seller || String(pref.client_id)!==app || Number(pref.marketplace_fee)!==5)throw Error('No se pudo verificar vendedor, aplicación y comisión de prueba.');
  const url=new URL(pref.sandbox_init_point);
  if(url.origin!=='https://sandbox.mercadopago.com.uy'||url.username||url.password)throw Error('No se recibió una URL de pruebas de Uruguay.');
  return url.href;
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  prepareSandbox({token:process.env.MP_TEST_SELLER_OAUTH_TOKEN,seller:process.env.MP_TEST_SELLER_ID,app:process.env.MP_TEST_APP_ID})
    .then(url=>console.log('Checkout ficticio: '+url)).catch(e=>{console.error(e.message);process.exitCode=1;});
}
