export async function authenticatedPaymentId(req, secret, now = Date.now()) {
  const ids = new URL(req.url).searchParams.getAll('data.id');
  const rid = req.headers.get('x-request-id') || '';
  const parts = (req.headers.get('x-signature') || '').split(',').map(x => x.trim().split('='));
  const {ts, v1} = Object.fromEntries(parts);
  if (!secret || ids.length !== 1 || !/^\d{1,24}$/.test(ids[0]) || !/^[\w-]{1,160}$/.test(rid) ||
      parts.length !== 2 || !/^(?:\d{10}|\d{13})$/.test(ts) || !/^[\da-f]{64}$/i.test(v1) ||
      Math.abs(now - Number(ts) * (ts.length === 10 ? 1000 : 1)) > 300000) return null;
  const encode = s => new TextEncoder().encode(s);
  const key = await crypto.subtle.importKey('raw', encode(secret), {name:'HMAC', hash:'SHA-256'}, false, ['verify']);
  const bytes = Uint8Array.from(v1.match(/../g), x => parseInt(x,16));
  return await crypto.subtle.verify('HMAC',key,bytes,encode('id:'+ids[0]+';request-id:'+rid+';ts:'+ts+';')) ? ids[0] : null;
}
