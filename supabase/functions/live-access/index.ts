import { createClient } from 'npm:@supabase/supabase-js@2.119.0';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const allowedOrigins = new Set(['https://koomodoo.vercel.app', 'http://127.0.0.1:8765', 'http://localhost:8765']);
let videoHealthUntil = 0;
function response(req: Request, data: unknown, status = 200) {
  const origin = req.headers.get('Origin') || '';
  return new Response(JSON.stringify(data), { status, headers: {
    'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Vary': 'Origin',
    ...(allowedOrigins.has(origin) ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  } });
}
function envKey(name: string, legacy: string) {
  const keys = JSON.parse(Deno.env.get(name) || '{}');
  return keys.default || Deno.env.get(legacy) || '';
}
const base64 = (value: Uint8Array) => btoa(String.fromCharCode(...value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
async function jwt(key: string, secret: string, grants: Record<string, unknown>, identity?: string) {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) => base64(new TextEncoder().encode(JSON.stringify(value)));
  const body = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ iss: key, ...(identity ? { sub: identity } : {}), iat: now, nbf: now - 5, exp: now + 60, jti: crypto.randomUUID(), video: grants })}`;
  const signing = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return `${body}.${base64(new Uint8Array(await crypto.subtle.sign('HMAC', signing, new TextEncoder().encode(body))))}`;
}
async function provider(url: string, key: string, secret: string, action: string, room: string, extra = {}) {
  const grant = action === 'ListRooms' ? { roomList: true } : action === 'CreateRoom' ? { roomCreate: true } : action === 'ListParticipants' ? { roomAdmin: true, room } : { roomCreate: true, roomAdmin: true, room };
  const result = await fetch(`${url.replace(/^wss:/, 'https:')}/twirp/livekit.RoomService/${action}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await jwt(key, secret, grant)}` },
    body: JSON.stringify({ ...(action === 'ListRooms' ? { names: [] } : action === 'CreateRoom' ? { name: room } : { room }), ...extra }), signal: AbortSignal.timeout(12000),
  });
  if (!result.ok) {
    if (action === 'DeleteRoom' && result.status === 404) return {};
    throw new Error('No se pudo comunicar con el servidor de video. Intenta nuevamente.');
  }
  return result.json();
}
export async function handle(req: Request) {
  if (req.method === 'OPTIONS') return response(req, {}, 200);
  if (req.method !== 'POST') return response(req, { error: 'Metodo no permitido' }, 405);
  if (req.headers.has('Origin') && !allowedOrigins.has(req.headers.get('Origin')!)) return response(req, { error: 'Origen no permitido' }, 403);
  try {
    const authorization = req.headers.get('Authorization') || '';
    if (!authorization.startsWith('Bearer ')) return response(req, { error: 'Inicia sesion para usar PULSO' }, 401);
    const url = Deno.env.get('SUPABASE_URL')!;
    const client = createClient(url, envKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY'), {
      global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error: authError } = await client.auth.getUser(authorization.slice(7));
    if (authError || !user) return response(req, { error: 'Tu sesion vencio. Ingresa nuevamente.' }, 401);
    const input = await req.json();
    const videoURL = Deno.env.get('LIVEKIT_URL') || '';
    const apiKey = Deno.env.get('LIVEKIT_API_KEY') || '';
    const secret = Deno.env.get('LIVEKIT_API_SECRET') || '';
    const configured = /^wss:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(videoURL) && !!apiKey && !!secret;
    if (input.action === 'status') {
      if (!configured) return response(req, { configured: false });
      // A syntactically valid key is not proof the provider accepts it.
      if (Date.now() >= videoHealthUntil) {
        try { await provider(videoURL, apiKey, secret, 'ListRooms', ''); }
        catch { return response(req, { error: 'LiveKit no respondio o rechazo las credenciales. Revisa la configuracion del servidor.', code: 'VIDEO_UNAVAILABLE' }, 503); }
        videoHealthUntil = Date.now() + 30000;
      }
      return response(req, { configured: true, providerChecked: true });
    }
    if (!configured) return response(req, { error: 'El video todavia no esta configurado. Falta vincular la cuenta del proveedor.', code: 'VIDEO_NOT_CONFIGURED' }, 503);
    const admin = createClient(url, envKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });
    if (input.action === 'prepare') {
      const title = String(input.title || '').trim();
      if (!Array.isArray(input.productIds)) return response(req, { error: 'Elegi los productos de PULSO.' }, 400);
      const ids = [...new Set(input.productIds || [])] as string[];
      if (title.length < 3 || title.length > 100 || !ids.length || ids.length > 12 || ids.some(id => !UUID.test(id))) return response(req, { error: 'Escribi un titulo de 3 a 100 caracteres y elegi entre 1 y 12 productos.' }, 400);
      const { count, error: countError } = await admin.from('live_rooms').select('*', { count: 'exact', head: true }).eq('user_id', user.id).gte('created_at', new Date(Date.now() - 86400000).toISOString());
      if (countError) throw countError;
      if ((count || 0) >= 12) return response(req, { error: 'Alcanzaste el limite de 12 preparaciones por dia del piloto.' }, 429);
      const { data: products, error: productsError } = await client.from('products').select('id').in('id', ids).eq('user_id', user.id).eq('status', 'published');
      if (productsError) throw productsError;
      if (products?.length !== ids.length) return response(req, { error: 'Solo podes mostrar tus productos publicados.' }, 403);
      const { data: row, error } = await admin.from('live_rooms').insert({ user_id: user.id, title }).select().single();
      if (error) {
        if (error.code === '23505') return response(req, { error: 'Ya tenes un PULSO abierto. Volve a PULSO y finalizalo antes de crear otro.' }, 409);
        throw error;
      }
      try {
        const linked = await admin.from('live_room_products').insert(ids.map((id, position) => ({ room_id: row.id, product_id: id, position })));
        if (linked.error) throw linked.error;
        await provider(videoURL, apiKey, secret, 'CreateRoom', row.id, { max_participants: 10, empty_timeout: 60, departure_timeout: 20 });
      } catch (error) {
        await admin.from('live_rooms').update({ status: 'ended', ended_at: new Date().toISOString() }).eq('id', row.id);
        throw error;
      }
      return response(req, { room: row });
    }
    if (!UUID.test(input.roomId || '')) return response(req, { error: 'PULSO invalido' }, 400);
    const { data: room, error } = await admin.from('live_rooms').select('*').eq('id', input.roomId).maybeSingle();
    if (error) throw error;
    if (!room) return response(req, { error: 'No encontramos este PULSO' }, 404);
    const owner = room.user_id === user.id;
    const fresh = Date.parse(room.lease_until) > Date.now();
    if (input.action === 'end') {
      if (!owner) return response(req, { error: 'Solo el vendedor puede finalizar PULSO' }, 403);
      await provider(videoURL, apiKey, secret, 'DeleteRoom', room.id);
      const ended = await admin.from('live_rooms').update({ status: 'ended', ended_at: new Date().toISOString(), lease_until: new Date().toISOString() }).eq('id', room.id);
      if (ended.error) throw ended.error;
      return response(req, { ended: true });
    }
    if (room.status === 'ended') return response(req, { error: 'Este PULSO ya termino' }, 410);
    if (input.action === 'token') {
      if (!owner && (room.status !== 'live' || !fresh)) return response(req, { error: 'Este PULSO no esta disponible' }, 410);
      if (owner && room.status === 'live' && !fresh) return response(req, { error: 'PULSO vencio. Finalizalo y prepara uno nuevo.' }, 410);
      return response(req, { url: videoURL, hostId: room.user_id, token: await jwt(apiKey, secret, { roomJoin: true, room: room.id, canPublish: owner, canPublishSources: owner ? ['camera', 'microphone'] : [], canSubscribe: true, canPublishData: false, canUpdateOwnMetadata: false }, user.id) });
    }
    if (!owner) return response(req, { error: 'Accion solo disponible para el vendedor' }, 403);
    if (input.action === 'activate') {
      const participants = await provider(videoURL, apiKey, secret, 'ListParticipants', room.id);
      const publisher = participants.participants?.find((p: { identity: string }) => p.identity === user.id);
      if (!publisher?.tracks?.some((t: { type: string | number; muted: boolean }) => (t.type === 'VIDEO' || t.type === 1) && !t.muted)) return response(req, { error: 'Primero conecta y publica tu camara.' }, 409);
      const activated = await admin.from('live_rooms').update({ status: 'live', started_at: room.started_at || new Date().toISOString(), lease_until: new Date(Date.now() + 90000).toISOString() }).eq('id', room.id).neq('status', 'ended').select().single();
      if (activated.error) throw activated.error;
      return response(req, { room: activated.data });
    }
    if (input.action === 'heartbeat') {
      const updated = await admin.from('live_rooms').update({ lease_until: new Date(Date.now() + 90000).toISOString() }).eq('id', room.id).eq('status', 'live').gt('lease_until', new Date().toISOString()).select('id').maybeSingle();
      if (updated.error) throw updated.error;
      if (!updated.data) return response(req, { error: 'PULSO dejo de estar activo. Finalizalo y volve a iniciar.' }, 410);
      return response(req, { ok: true });
    }
    return response(req, { error: 'Accion invalida' }, 400);
  } catch (error) {
    console.error('[KMD live-access]', error instanceof Error ? error.message : 'Unexpected error');
    return response(req, { error: 'No se pudo completar la operacion de PULSO. Intenta nuevamente.' }, 500);
  }
}
Deno.serve(handle);
