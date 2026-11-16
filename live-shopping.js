/* Media never passes through Supabase: LiveKit is the SFU, Supabase is the shop. */
window.LiveShopping = (() => {
  let sdkPromise, connection = null, localTracks = [], active = null;
  let channel = null, poll = null, heartbeat = null, directoryPoll = null;
  let busy = false, generation = 0, previewGeneration = 0, roomProducts = [], refreshing = false;
  const $ = id => document.getElementById(id);
  const userId = () => KMD.session?.user?.id;
  const sdk = () => sdkPromise ||= import('https://cdn.jsdelivr.net/npm/livekit-client@2.24.1/dist/livekit-client.esm.mjs').catch(error => { sdkPromise = null; throw error; });
  const errorText = error => /Permission|NotAllowed/i.test(error?.name || '')
    ? 'Permiti el acceso a camara y microfono para continuar.'
    : /NotFound/i.test(error?.name || '') ? 'No encontramos una camara o un microfono disponible.'
    : error?.message || 'No se pudo completar la accion. Intenta nuevamente.';
  const showError = error => { console.error('[KMD live]', error); toast(errorText(error)); };
  function status(text) { if ($('live-status')) $('live-status').textContent = text; }
  function button(text, handler, className = 'btn-p btn-sec') {
    const element = document.createElement('button'); element.type = 'button'; element.className = className;
    element.textContent = text; element.onclick = handler; return element;
  }
  async function api(action, data = {}) {
    if (!userId()) throw new Error('Inicia sesion para participar del vivo.');
    const { data: result, error } = await getSB().functions.invoke('live-access', { body: { action, ...data } });
    if (error) {
      let message;
      try { message = (await error.context?.json())?.error; } catch {}
      throw new Error(message || error.message || 'No pudimos conectar con el servidor del vivo.');
    }
    if (result?.error) throw new Error(result.error);
    return result;
  }
  function stopPreview() {
    previewGeneration++;
    for (const track of localTracks) { track.stop(); track.detach().forEach(el => el.remove()); }
    localTracks = [];
    if ($('live-preview')) $('live-preview').replaceChildren();
  }
  async function preview() {
    const control = $('live-preview-btn'); if (control) control.disabled = true;
    try {
      stopPreview();
      const version = previewGeneration;
      const { createLocalTracks } = await sdk();
      const tracks = await createLocalTracks({ audio: { echoCancellation: true, noiseSuppression: true }, video: { facingMode: 'user', resolution: { width: 720, height: 1280, frameRate: 24 } } });
      if (version !== previewGeneration) { tracks.forEach(track => track.stop()); return; }
      localTracks = tracks;
      const video = localTracks.find(track => track.kind === 'video').attach();
      video.muted = true; video.playsInline = true; $('live-preview').append(video);
      $('live-setup-status').textContent = 'Vista previa privada. Todavia no estas transmitiendo.';
    } catch (error) { stopPreview(); $('live-setup-status').textContent = errorText(error); }
    finally { if (control) control.disabled = false; }
  }
  async function openStudio() {
    if (!userId()) { openAuthModal('login'); return; }
    const modal = $('live-start-modal'); modal.classList.add('open');
    const list = $('live-product-picker'); list.textContent = 'Cargando tus productos...';
    const start = $('live-start-btn'); start.disabled = true;
    $('live-setup-status').textContent = 'Comprobando el servicio de video...';
    try {
      const config = await api('status');
      $('live-setup-status').textContent = config.configured
        ? 'Video disponible. Elegi tus productos y proba la camara antes de iniciar.'
        : 'Falta vincular LiveKit. Podes probar la camara, pero el vivo aun no esta habilitado.';
      const { data, error } = await getSB().from('products').select('id,title,price,currency').eq('user_id', userId()).eq('status', 'published').order('created_at', { ascending: false }).limit(100);
      if (error) throw error;
      list.replaceChildren();
      if (!data.length) list.textContent = 'Primero publica un producto en Crear contenido. Solo se muestran tus productos publicados.';
      for (const product of data) {
        const label = document.createElement('label'); label.className = 'live-pick';
        const input = document.createElement('input'); input.type = 'checkbox'; input.value = product.id;
        const text = document.createElement('span'); text.textContent = `${product.title} · ${CommerceUI.money(product.price, product.currency)}`;
        label.append(input, text); list.append(label);
      }
      start.disabled = !config.configured || !data.length;
    } catch (error) { list.textContent = 'No se pudieron cargar los productos.'; $('live-setup-status').textContent = errorText(error); }
  }
  function closeStudio() {
    if (busy) return;
    stopPreview(); $('live-start-modal').classList.remove('open');
  }
  async function start() {
    if (busy) return;
    const ids = [...document.querySelectorAll('#live-product-picker input:checked')].map(input => input.value);
    const title = $('live-title-inp').value.trim();
    if (title.length < 3 || title.length > 100) { toast('Escribi un titulo de 3 a 100 caracteres.'); return; }
    if (!ids.length || ids.length > 12) { toast('Elegi entre 1 y 12 productos para tu vivo.'); return; }
    busy = true; $('live-start-btn').disabled = true;
    $('live-setup-status').textContent = 'Preparando la transmision...';
    let prepared = null;
    try {
      if (!localTracks.length) await preview();
      if (!localTracks.some(track => track.kind === 'video')) throw new Error('Necesitamos tu camara para iniciar.');
      const result = await api('prepare', { title, productIds: ids }); prepared = result.room;
      active = prepared; roomProducts = [];
      $('live-start-modal').classList.remove('open');
      // Move the existing preview tracks rather than opening the camera twice.
      const tracks = localTracks; localTracks = [];
      nav('live');
      await connect(prepared, tracks);
      const activated = await api('activate', { roomId: prepared.id }); active = activated.room;
      currentLiveSession = normalizeLiveRecord(active);
      await watchRoom(); await refreshRoom();
      heartbeat = setInterval(async () => {
        if (!connection || !active || connection.state !== 'connected') return;
        try { await api('heartbeat', { roomId: active.id }); }
        catch (error) { status(errorText(error)); }
      }, 25000);
      status('Estas en vivo. Los productos que destaques aparecen abajo para tu audiencia.');
      renderStories(); renderRP();
    } catch (error) {
      stopPreview(); await disconnect();
      if (prepared) { try { await api('end', { roomId: prepared.id }); } catch (cleanupError) { console.error('[KMD live cleanup]', cleanupError); } }
      active = null; currentLiveSession = null;
      $('live-start-modal').classList.add('open'); $('live-setup-status').textContent = errorText(error);
      await directory();
    } finally { busy = false; $('live-start-btn').disabled = false; }
  }
  function drawShell() {
    $('live-directory').hidden = true; $('live-player-layout').hidden = false;
    $('live-title').textContent = active.title;
    $('live-status').textContent = 'Conectando al video...';
    $('live-products').replaceChildren(); $('live-comments').replaceChildren();
    $('live-media').replaceChildren(); $('live-audio').replaceChildren();
    const controls = $('live-controls'); controls.replaceChildren();
    controls.append(button('Activar sonido', async () => {
      try { await connection?.startAudio(); await connection?.startVideo(); } catch (error) { showError(error); }
    }));
    if (active.user_id === userId()) {
      const mic = button('Silenciar microfono', async () => {
        mic.disabled = true;
        try {
          const participant = connection.localParticipant;
          await participant.setMicrophoneEnabled(!participant.isMicrophoneEnabled);
          mic.textContent = participant.isMicrophoneEnabled ? 'Silenciar microfono' : 'Activar microfono';
        } catch (error) { showError(error); } finally { mic.disabled = false; }
      });
      controls.append(mic, button('Finalizar vivo', () => end(), 'btn-p btn-pri'));
    } else controls.append(button('Salir del vivo', () => { nav('home'); }));
  }
  async function connect(row, tracks = []) {
    active = row; drawShell();
    try {
    const { Room, RoomEvent } = await sdk();
    const access = await api('token', { roomId: row.id });
    const room = new Room({ adaptiveStream: true, dynacast: true }); connection = room;
    function attach(track, participant) {
      if (participant.identity !== row.user_id) return;
      const element = track.attach();
      if (track.kind === 'video') {
        element.playsInline = true; element.muted = participant.isLocal;
        $('live-media').replaceChildren(element); status('Video conectado');
      } else if (!participant.isLocal) $('live-audio').append(element);
    }
    room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => attach(track, participant));
    room.on(RoomEvent.TrackUnsubscribed, track => track.detach().forEach(element => element.remove()));
    room.on(RoomEvent.LocalTrackPublished, publication => { if (publication.track) attach(publication.track, room.localParticipant); });
    room.on(RoomEvent.ParticipantConnected, renderAudience);
    room.on(RoomEvent.ParticipantDisconnected, participant => {
      renderAudience(); if (participant.identity === row.user_id) status('El vendedor se desconecto. Esperando reconexion...');
    });
    room.on(RoomEvent.Reconnecting, () => status('Reconectando el video...'));
    room.on(RoomEvent.Reconnected, () => status('Video reconectado'));
    room.on(RoomEvent.Disconnected, () => { status('Video desconectado. Sali y volve a entrar para reintentar.'); renderAudience(); });
      await room.connect(access.url, access.token);
      for (const track of tracks) await room.localParticipant.publishTrack(track);
      renderAudience();
    } catch (error) { tracks.forEach(track => track.stop()); throw error; }
  }
  function renderAudience() {
    if ($('live-audience')) $('live-audience').textContent = connection?.state === 'connected'
      ? `${connection.remoteParticipants.size + 1} personas conectadas (incluye vendedor)` : 'Sin conexion de video';
  }
  async function join(id) {
    if (!userId()) { openAuthModal('login'); return; }
    if (busy) return;
    busy = true;
    try {
      await disconnect();
      const { data, error } = await getSB().from('live_rooms').select('*').eq('id', id).single();
      if (error) throw error;
      if (data.user_id === userId()) throw new Error('Para retomar tu camara, finaliza el vivo anterior y prepara uno nuevo.');
      if (data.status !== 'live' || Date.parse(data.lease_until) <= Date.now()) throw new Error('Este vivo ya no esta disponible.');
      active = data; nav('live'); await connect(data); await watchRoom(); await refreshRoom();
    } catch (error) { await disconnect(); active = null; showError(error); await directory(); }
    finally { busy = false; }
  }
  async function watchRoom() {
    const id = active.id;
    channel = getSB().channel(`shop-live-${id}-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'live_rooms', filter: `id=eq.${id}` }, () => void refreshRoom())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'live_room_messages', filter: `room_id=eq.${id}` }, () => void refreshComments().catch(showError))
      .subscribe();
    // Reconcile after missed events/reconnects; media is never polled.
    poll = setInterval(() => void refreshRoom(), 5000);
  }
  async function refreshRoom() {
    if (!active || refreshing) return;
    refreshing = true;
    const id = active.id, version = generation;
    try {
      const { data: row, error } = await getSB().from('live_rooms').select('*').eq('id', id).maybeSingle();
      if (error) throw error;
      if (generation !== version || active?.id !== id) return;
      if (!row || row.status === 'ended' || Date.parse(row.lease_until) <= Date.now()) {
        await disconnect(); active = null; currentLiveSession = null;
        await directory(); status('La transmision termino o perdio conexion.'); return;
      }
      active = row;
      const { data: links, error: linksError } = await getSB().from('live_room_products').select('product_id,position').eq('room_id', id).order('position');
      if (linksError) throw linksError;
      const ids = (links || []).map(link => link.product_id);
      const result = ids.length ? await getSB().from('products').select('id,title,price,currency,image_url,status,user_id').in('id', ids).eq('status', 'published').eq('user_id', row.user_id) : { data: [], error: null };
      if (result.error) throw result.error;
      if (generation !== version || active?.id !== id) return;
      roomProducts = ids.map(productId => result.data.find(product => product.id === productId)).filter(Boolean);
      drawProducts(); await refreshComments();
    } catch (error) { console.error('[KMD live refresh]', error); status('No pudimos actualizar productos/chat. Reintentando...'); }
    finally { refreshing = false; }
  }
  function drawProducts() {
    const strip = $('live-products'); strip.replaceChildren();
    if (!roomProducts.length) strip.textContent = 'No hay productos disponibles en este vivo.';
    const sorted = [...roomProducts].sort((a, b) => Number(b.id === active.pinned_product_id) - Number(a.id === active.pinned_product_id));
    for (const product of sorted) {
      const card = document.createElement('article'); card.className = 'live-shop-product';
      if (product.id === active.pinned_product_id) card.classList.add('featured');
      if (/^https:\/\//.test(product.image_url || '')) {
        const image = document.createElement('img'); image.src = product.image_url; image.alt = ''; card.append(image);
      }
      const content = document.createElement('div');
      const name = document.createElement('strong'); name.textContent = product.title;
      const price = document.createElement('span'); price.textContent = CommerceUI.money(product.price, product.currency);
      content.append(name, price);
      const pinned = product.id === active.pinned_product_id;
      const action = active.user_id === userId()
        ? button(pinned ? 'En pantalla' : 'Mostrar ahora', () => pin(product.id), 'live-product-action')
        : button('Ver producto', () => CommerceUI.showProduct(product.id), 'live-product-action');
      if (pinned) { const label = document.createElement('small'); label.textContent = 'Producto destacado'; content.prepend(label); }
      content.append(action); card.append(content); strip.append(card);
    }
  }
  async function pin(id) {
    try {
      const { data, error } = await getSB().from('live_rooms').update({ pinned_product_id: id }).eq('id', active.id).select().single();
      if (error) throw error; active = data; drawProducts();
    } catch (error) { showError(error); }
  }
  async function refreshComments() {
    if (!active) return;
    const id = active.id, version = generation;
    const { data: messages, error } = await getSB().from('live_room_messages').select('id,user_id,text,created_at').eq('room_id', id).order('created_at', { ascending: false }).limit(50);
    if (error) throw error;
    const ids = [...new Set(messages.map(message => message.user_id))];
    const profiles = ids.length ? await getSB().from('public_profiles').select('id,username,first_name').in('id', ids) : { data: [], error: null };
    if (profiles.error) throw profiles.error;
    if (generation !== version || active?.id !== id) return;
    const box = $('live-comments'), nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
    box.replaceChildren();
    for (const message of [...messages].reverse()) {
      const profile = profiles.data.find(person => person.id === message.user_id);
      const row = document.createElement('p');
      const author = document.createElement('strong'); author.textContent = (profile?.username ? `@${profile.username}` : profile?.first_name || 'Usuario') + ' ';
      row.append(author, document.createTextNode(message.text)); box.append(row);
    }
    if (!messages.length) box.textContent = 'Se el primero en comentar.';
    if (nearBottom) box.scrollTop = box.scrollHeight;
  }
  async function sendComment() {
    if (!userId()) { openAuthModal('login'); return; }
    const input = $('live-comment'), submit = $('live-comment-send');
    const text = input.value.trim();
    if (!active || !text || submit.disabled) return;
    submit.disabled = true;
    try {
      const { error } = await getSB().from('live_room_messages').insert({ room_id: active.id, user_id: userId(), text });
      if (error) throw error; input.value = ''; await refreshComments();
    } catch (error) { showError(error); }
    finally { submit.disabled = false; }
  }
  async function directory() {
    if (!$('live-directory')) return;
    $('live-directory').hidden = false; $('live-player-layout').hidden = true;
    const box = $('live-room-list');
    if (!box.childNodes.length) box.textContent = 'Buscando transmisiones...';
    try {
      const { data: rooms, error } = await getSB().from('live_rooms').select('*').eq('status', 'live').gt('lease_until', new Date().toISOString()).order('started_at', { ascending: false }).limit(30);
      if (error) throw error;
      if (currentPage !== 'live' || active) return;
      const ids = [...new Set(rooms.map(room => room.user_id))];
      const { data: profiles, error: profileError } = ids.length ? await getSB().from('public_profiles').select('id,username,first_name').in('id', ids) : { data: [], error: null };
      if (profileError) throw profileError;
      box.replaceChildren();
      if (!rooms.length) box.textContent = 'Todavia no hay transmisiones activas. Cuando un vendedor inicie, aparecera aca.';
      for (const row of rooms) {
        const card = document.createElement('article'); card.className = 'live-room-card';
        const title = document.createElement('h3'); title.textContent = row.title;
        const seller = document.createElement('p'); seller.textContent = profiles.find(profile => profile.id === row.user_id)?.username || 'Vendedor';
        card.append(title, seller, button('Entrar al vivo', () => join(row.id), 'btn-p btn-pri')); box.append(card);
      }
      if (userId()) {
        const own = await getSB().from('live_rooms').select('id,title').eq('user_id', userId()).neq('status', 'ended').limit(1).maybeSingle();
        if (own.error) throw own.error;
        if (own.data) box.append(button(`Finalizar mi sala anterior: ${own.data.title}`, async () => {
          try { await api('end', { roomId: own.data.id }); await directory(); } catch (error) { showError(error); }
        }));
      }
    } catch (error) { box.textContent = errorText(error); console.error('[KMD live directory]', error); }
  }
  async function disconnect() {
    generation++;
    clearInterval(poll); poll = null; clearInterval(heartbeat); heartbeat = null;
    const previous = connection; connection = null;
    if (previous) {
      previous.removeAllListeners();
      previous.localParticipant.trackPublications.forEach(publication => publication.track?.stop());
      await previous.disconnect();
    }
    if (channel) { const previousChannel = channel; channel = null; await getSB().removeChannel(previousChannel); }
    if ($('live-media')) $('live-media').replaceChildren();
    if ($('live-audio')) $('live-audio').replaceChildren();
  }
  async function leave() {
    clearInterval(directoryPoll); directoryPoll = null;
    const previous = active, previousUserId = userId(); active = null; currentLiveSession = null;
    renderStories();
    await disconnect(); stopPreview();
    if (previous?.user_id === previousUserId) {
      try { await api('end', { roomId: previous.id }); }
      catch (error) { console.error('[KMD live end]', error); toast('Camara apagada. No pudimos confirmar el cierre de sala: revisalo en En vivo.'); }
    }
  }
  async function end() {
    if (busy || !active || !confirm('Finalizar la transmision para todos?')) return;
    busy = true;
    try { await leave(); await directory(); }
    finally { busy = false; }
  }
  function canLeave() {
    if (busy) { toast('Espera a que termine la conexion del vivo.'); return false; }
    return !active || active.user_id !== userId() || confirm('Al salir se apagara tu camara y se cerrara el vivo. Continuar?');
  }
  async function page() {
    if (active) return;
    await directory();
    if (!directoryPoll) directoryPoll = setInterval(() => { if (currentPage === 'live' && !active) void directory(); }, 15000);
  }
  window.addEventListener('pagehide', () => {
    stopPreview(); connection?.localParticipant.trackPublications.forEach(publication => publication.track?.stop());
    // A dropped tab is hidden by its server-time lease; do not trust unload fetches.
  });
  return { openStudio, closeStudio, preview, start, page, join, sendComment, canLeave, leave, errorText };
})();
