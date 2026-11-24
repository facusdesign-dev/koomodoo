// Close the hosted checkout, not the payment. Retrying this operation is safe.
export async function closePreference({id, reference, seller, token, request=fetch, now=Date.now()}) {
  if (!/^[\d]+-[\da-f-]{36}$/i.test(id) || !reference || !seller || !token) throw Error('Invalid checkout binding');
  const url='https://api.mercadopago.com/checkout/preferences/'+id;
  const call=async (method, body) => {
    const res=await request(url,{method,redirect:'error',signal:AbortSignal.timeout(10000),
      headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body && JSON.stringify(body)});
    if(!res.ok) throw Error('Preference '+method+': '+res.status);
    return res.json();
  };
  const read=async()=>{
    const p=await call('GET');
    if(p.id!==id || p.external_reference!==reference || String(p.collector_id)!==seller) throw Error('Checkout mismatch');
    return p.expires===true && Date.parse(p.expiration_date_to)<=now;
  };
  if(await read()) return;
  await call('PUT',{expires:true,expiration_date_from:new Date(now-86400000).toISOString(),
    expiration_date_to:new Date(now-1000).toISOString()});
  if(!await read()) throw Error('Closure not confirmed');
}
