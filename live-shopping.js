/* Media never passes through Supabase: LiveKit is the SFU, Supabase is the shop. */
window.LiveShopping = (() => {
  let sdkPromise, connection = null, localTracks = [], active = null;
  let channel = null, poll = null, heartbeat = null, directoryPoll = null;
  let busy = false, generation = 0, previewGeneration = 0, roomProducts = [], refreshing = false;
  let filter = 'natural', beauty = 0, quality = 'standard', ownsFullscreen = false, effectBusy = false;
  let liked = false, likeExists = false, likeBusy = false, following = false, productSignature = '';
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
  const icons = {
    heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
    sound: '<path d="m11 5-6 4H2v6h3l6 4V5Z"/><path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
    settings: '<path d="M4 7h16M4 17h16"/><circle cx="8" cy="7" r="3"/><circle cx="16" cy="17" r="3"/>',
    mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/>',
    end: '<rect x="5" y="5" width="14" height="14" rx="3"/>',
  };
  function control(id, text, icon, handler) {
    const element = button('', handler, 'live-control'); element.id = id;
    element.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[icon]}</svg>`;
    const label = document.createElement('span'); label.textContent = text; element.append(label);
    element.setAttribute('aria-label', text); return element;
  }
  function labelControl(element, text) {
    if (!element) return;
    element.querySelector('span').textContent = text; element.setAttribute('aria-label', text);
  }
  const isPresenter = () => !!active && active.user_id === userId();
  async function resumePlayback() {
    if (isPresenter()) return;
    try { await Promise.all([connection?.startAudio(), connection?.startVideo()]); }
    catch { status('Toca el video para permitir su reproduccion con audio.'); }
    $('live-audio-gate').hidden = !connection || !!connection.canPlaybackAudio || isPresenter();
  }
  function cameraTrack() {
    if (!isPresenter()) return null;
    return [...(connection?.localParticipant.trackPublications.values() || [])].find(publication => publication.track?.kind === 'video')?.track || null;
  }
  async function applyOutgoingEffect(track, preset, amount) {
    const current = track.getProcessor?.();
    if (current?.name === 'koomodoo-color-and-softness' && current.processedTrack && current.processedTrack.readyState !== 'ended') current.setOptions(preset, amount, quality);
    else {
      if (current?.name === 'koomodoo-color-and-softness') await track.stopProcessor();
      const processor = LiveVideoEffects.createProcessor(preset, amount, quality);
      try { await track.setProcessor(processor, true); }
      catch (error) { await processor.destroy(); throw error; }
    }
  }
  function renderEffectControls() {
    $('live-filter').value = filter; $('live-beauty').value = String(beauty);
    $('live-beauty-label').textContent = beauty + '%'; $('live-quality').value = quality;
    $('live-filter-badge').hidden = (active?.video_filter || 'natural') === 'natural' && !active?.beauty_level;
  }
  async function updateEffects(preset, amount) {
    if (!isPresenter() || effectBusy) return;
    const track = cameraTrack(); if (!track) { toast('La camara todavia no esta lista.'); return; }
    let values;
    try { values = LiveVideoEffects.options(preset, amount); } catch (error) { showError(error); return; }
    const id = active.id, previous = { filter, beauty };
    effectBusy = true; $('live-filter').disabled = true; $('live-beauty').disabled = true;
    try {
      await applyOutgoingEffect(track, values.preset, values.beauty);
      if (active?.id !== id) return;
      const result = await getSB().from('live_rooms').update({ video_filter: values.preset, beauty_level: values.beauty }).eq('id', id).select().single();
      if (result.error) throw result.error;
      active = result.data; filter = values.preset; beauty = values.beauty;
      status(track.getProcessor?.()?.compatibilityMode ? 'Filtro de PULSO aplicado en modo compatible (hasta 480p, 15 fps).' : 'Imagen de PULSO actualizada para tu audiencia.');
    } catch (error) {
      try { await applyOutgoingEffect(track, previous.filter, previous.beauty); } catch (rollbackError) { console.error('[KMD effects rollback]', rollbackError); }
      showError(error);
    } finally { effectBusy = false; $('live-filter').disabled = false; $('live-beauty').disabled = false; renderEffectControls(); }
  }
  const setFilter = value => updateEffects(value, beauty);
  const setBeauty = value => updateEffects(filter, Number(value));
  async function setQuality(value) {
    if (!isPresenter() || effectBusy || !Object.hasOwn(LiveVideoEffects.qualities, value)) return;
    const track = cameraTrack(); if (!track) return;
    const id = active.id, previous = quality; effectBusy = true; $('live-quality').disabled = true;
    try {
      await track.restartTrack({ resolution: LiveVideoEffects.qualities[value] });
      quality = value;
      await applyOutgoingEffect(track, filter, beauty);
      if (active?.id !== id) return;
      const result = await getSB().from('live_rooms').update({ video_quality: value }).eq('id', id).select().single();
      if (result.error) throw result.error;
      active = result.data; quality = value;
      status('Calidad de emision actualizada. Se adapta a tu camara y conexion.');
    } catch (error) {
      quality = previous;
      try { await track.restartTrack({ resolution: LiveVideoEffects.qualities[previous] }); await applyOutgoingEffect(track, filter, beauty); } catch (rollbackError) { console.error('[KMD quality rollback]', rollbackError); }
      showError(error);
    } finally { effectBusy = false; $('live-quality').disabled = false; renderEffectControls(); }
  }
  function toggleFit() {
    // Compatibility helper: PULSO always preserves the complete portrait image.
    if (isPresenter()) $('live-player-layout').dataset.fit = 'contain';
  }
  function toggleSettings() {
    if (!isPresenter()) return;
    const panel = $('live-settings'); panel.hidden = !panel.hidden;
    $('live-settings-toggle')?.setAttribute('aria-expanded', String(!panel.hidden));
  }
  async function fullscreen() {
    if (!isPresenter()) return;
    try {
      // Fullscreen the document so the existing product modal stays accessible.
      if (document.fullscreenElement) { await document.exitFullscreen(); ownsFullscreen = false; }
      else if (document.documentElement.requestFullscreen) { await document.documentElement.requestFullscreen(); ownsFullscreen = true; }
      else toast('PULSO ya ocupa la pantalla. Este navegador no permite ocultar sus barras.');
    } catch { toast('No se pudo ocultar la barra del navegador. El video sigue en modo inmersivo.'); }
  }
  async function api(action, data = {}) {
    if (!userId()) throw new Error('Inicia sesion para participar de PULSO.');
    const { data: result, error } = await getSB().functions.invoke('live-access', { body: { action, ...data } });
    if (error) {
      let message;
      try { message = (await error.context?.json())?.error; } catch {}
      throw new Error(message || error.message || 'No pudimos conectar con el servidor de PULSO.');
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
      const tracks = await createLocalTracks({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: { facingMode: 'user', resolution: { width: 720, height: 1280, frameRate: 24 } } });
      if (version !== previewGeneration) { tracks.forEach(track => track.stop()); return; }
      localTracks = tracks;
      try { await applyOutgoingEffect(localTracks.find(track => track.kind === 'video'), 'natural', 0); }
      catch (error) { console.warn('[KMD portrait preview]', error.message); }
      const video = localTracks.find(track => track.kind === 'video').attach();
      video.muted = true; video.playsInline = true; $('live-preview').append(video);
      $('live-setup-status').textContent = 'Vista previa privada. Todavia no estas transmitiendo.';
    } catch (error) { stopPreview(); $('live-setup-status').textContent = errorText(error); }
    finally { if (control) control.disabled = false; }
  }
  async function openStudio() {
    if (!userId()) { openAuthModal('login'); return; }
    if (isPresenter()) { toggleSettings(); return; }
    filter = 'natural'; beauty = 0; quality = 'standard';
    const modal = $('live-start-modal'); modal.classList.add('open');
    const list = $('live-product-picker'); list.textContent = 'Cargando tus productos...';
    const start = $('live-start-btn'); start.disabled = true;
    $('live-setup-status').textContent = 'Comprobando el servicio de video...';
    try {
      const config = await api('status');
      $('live-setup-status').textContent = config.configured
        ? 'Video disponible. Elegi tus productos y proba la camara antes de iniciar.'
        : 'Falta vincular LiveKit. Podes probar la camara, pero PULSO aun no esta habilitado.';
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
    if (!ids.length || ids.length > 12) { toast('Elegi entre 1 y 12 productos para tu PULSO.'); return; }
    busy = true; $('live-start-btn').disabled = true;
    $('live-setup-status').textContent = 'Preparando PULSO...';
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
      if (ids.length) await pin(ids[0]);
      currentLiveSession = normalizeLiveRecord(active);
      await watchRoom(); await refreshRoom();
      heartbeat = setInterval(async () => {
        if (!connection || !active || connection.state !== 'connected') return;
        try { await api('heartbeat', { roomId: active.id }); }
        catch (error) { status(errorText(error)); }
      }, 25000);
      status('Tu PULSO esta activo. Los productos destacados aparecen sobre el video.');
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
    document.body.classList.add('live-immersive');
    $('live-settings').hidden = true; productSignature = '';
    $('live-player-layout').dataset.presenter = String(isPresenter());
    $('live-player-layout').dataset.fit = 'contain';
    filter = active.video_filter || 'natural'; beauty = active.beauty_level || 0; quality = active.video_quality || 'standard';
    renderEffectControls();
    $('live-title').textContent = active.title;
    $('live-status').textContent = 'Conectando al video...';
    $('live-products').replaceChildren(); $('live-comments').replaceChildren();
    delete $('live-comments').dataset.messages;
    $('live-media').replaceChildren(); $('live-audio').replaceChildren();
    const controls = $('live-controls'); controls.replaceChildren();
    const like = control('live-like-toggle', 'Likes', 'heart', toggleLike);
    like.disabled = isPresenter(); like.setAttribute('aria-pressed', 'false'); $('live-like-slot').replaceChildren(like);
    if (active.user_id === userId()) {
      const settings = control('live-settings-toggle', 'Mi panel', 'settings', toggleSettings);
      settings.setAttribute('aria-expanded', 'false'); controls.append(settings);
      const mic = control('live-mic-toggle', 'Microfono', 'mic', async () => {
        mic.disabled = true;
        try {
          const participant = connection.localParticipant;
          await participant.setMicrophoneEnabled(!participant.isMicrophoneEnabled);
          labelControl(mic, participant.isMicrophoneEnabled ? 'Silenciar microfono' : 'Activar microfono');
        } catch (error) { showError(error); } finally { mic.disabled = false; }
      });
      const finish = control('live-end', 'Finalizar', 'end', () => end()); finish.classList.add('end');
      controls.append(mic, finish);
    }
    $('live-follow').hidden = active.user_id === userId(); $('live-follow').disabled = true;
    $('live-follow').textContent = 'Cargando...'; $('live-host-name').textContent = 'Vendedor';
    $('live-host-avatar').textContent = 'K';
    void loadHost().catch(error => { console.error('[KMD live host]', error); $('live-follow').textContent = 'Reintentar'; $('live-follow').disabled = false; $('live-follow').onclick = () => void loadHost().catch(showError); });
    $('live-audio-gate').hidden = true;
  }
  async function connect(row, tracks = []) {
    active = row; drawShell();
    try {
    const { Room, RoomEvent } = await sdk();
    const access = await api('token', { roomId: row.id });
    const room = new Room({ adaptiveStream: true, dynacast: true }); connection = room;
    function attach(track, participant, local = false) {
      if (participant.identity !== row.user_id) return;
      // attach() starts playback even for detached audio elements: never create
      // one for the local microphone or for a presenter-side remote monitor.
      if (track.kind === 'audio' && (local || isPresenter())) return;
      const element = track.attach();
      if (track.kind === 'video') {
        element.playsInline = true; element.muted = true; element.defaultMuted = true; element.volume = 0;
        $('live-media').replaceChildren(element); status('Video conectado');
      } else { $('live-audio').append(element); }
    }
    room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => attach(track, participant));
    room.on(RoomEvent.TrackUnsubscribed, track => track.detach().forEach(element => element.remove()));
    room.on(RoomEvent.LocalTrackPublished, publication => { if (publication.track) attach(publication.track, room.localParticipant, true); });
    room.on(RoomEvent.ParticipantConnected, renderAudience);
    room.on(RoomEvent.ParticipantDisconnected, participant => {
      renderAudience(); if (participant.identity === row.user_id) status('El vendedor se desconecto. Esperando reconexion...');
    });
    room.on(RoomEvent.Reconnecting, () => status('Reconectando el video...'));
    room.on(RoomEvent.Reconnected, () => status('Video reconectado'));
    room.on(RoomEvent.AudioPlaybackStatusChanged, () => { $('live-audio-gate').hidden = room.canPlaybackAudio || isPresenter(); });
    room.on(RoomEvent.Disconnected, () => { status('Video desconectado. Sali y volve a entrar para reintentar.'); renderAudience(); });
      await room.connect(access.url, access.token, { autoSubscribe: !isPresenter() });
      for (const track of tracks) {
        if (track.kind === 'video') {
          try { await applyOutgoingEffect(track, filter, beauty); }
          catch (error) { status('PULSO usa la camara original en este dispositivo.'); console.warn('[KMD portrait]', error.message); }
        }
        await room.localParticipant.publishTrack(track);
      }
      if (!isPresenter()) await resumePlayback();
      renderAudience();
    } catch (error) { tracks.forEach(track => track.stop()); throw error; }
  }
  function renderAudience() {
    if ($('live-audience')) $('live-audience').textContent = connection?.state === 'connected'
      ? `${connection.remoteParticipants.size + 1} conectados` : 'Sin conexion';
    $('live-audience')?.setAttribute('title', 'Incluye al vendedor y los espectadores conectados');
  }
  async function loadHost() {
    if (!active) return;
    const id = active.id, target = active.user_id, version = generation;
    const { data: profile, error } = await getSB().from('public_profiles').select('id,username,first_name,avatar_url').eq('id', target).maybeSingle();
    if (error) throw error;
    const state = target === userId() ? false : await FollowersModule.isFollowing(target);
    if (version !== generation || active?.id !== id) return;
    $('live-host-name').textContent = profile?.username ? '@' + profile.username : profile?.first_name || 'Vendedor';
    const avatar = typeof resolveAvatarDisplayUrl === 'function' ? resolveAvatarDisplayUrl(profile?.avatar_url || '') : profile?.avatar_url || '';
    $('live-host-avatar').replaceChildren();
    if (/^https:\/\//.test(avatar)) { const image = document.createElement('img'); image.src = avatar; image.alt = ''; $('live-host-avatar').append(image); }
    else $('live-host-avatar').textContent = avatar || 'K';
    following = state; renderFollow();
    $('live-follow').onclick = async () => {
      const btn = $('live-follow'); if (btn.disabled || active?.id !== id) return;
      btn.disabled = true;
      try {
        await (following ? FollowersModule.unfollowUser(target) : FollowersModule.followUser(target));
        if (active?.id === id) { following = await FollowersModule.isFollowing(target); renderFollow(); }
      } catch (error) { showError(error); } finally { if (active?.id === id) btn.disabled = false; }
    };
  }
  function renderFollow() {
    const btn = $('live-follow'); btn.textContent = following ? 'Siguiendo' : 'Seguir';
    btn.setAttribute('aria-pressed', String(following)); btn.disabled = false;
    btn.setAttribute('aria-label', following ? 'Dejar de seguir al vendedor' : 'Seguir al vendedor');
  }
  async function refreshLikes() {
    if (!active || active.status !== 'live') return;
    const id = active.id, version = generation;
    const count = await getSB().from('live_room_likes').select('user_id', { count: 'exact', head: true }).eq('room_id', id).eq('liked', true);
    if (count.error) throw count.error;
    const own = await getSB().from('live_room_likes').select('liked').eq('room_id', id).eq('user_id', userId()).maybeSingle();
    if (own.error) throw own.error;
    if (version !== generation || active?.id !== id || likeBusy) return;
    likeExists = !!own.data; liked = !!own.data?.liked;
    labelControl($('live-like-toggle'), `${count.count ?? 0} likes`);
    $('live-like-toggle').setAttribute('aria-pressed', String(liked));
  }
  async function toggleLike() {
    if (!active || active.user_id === userId() || likeBusy) return;
    const id = active.id, next = !liked;
    likeBusy = true; $('live-like-toggle').disabled = true;
    try {
      let result = likeExists
        ? await getSB().from('live_room_likes').update({ liked: next }).eq('room_id', id).eq('user_id', userId()).select('liked').single()
        : await getSB().from('live_room_likes').insert({ room_id: id, user_id: userId(), liked: next });
      if (result.error?.code === '23505') result = await getSB().from('live_room_likes').update({ liked: next }).eq('room_id', id).eq('user_id', userId()).select('liked').single();
      if (result.error) throw result.error;
      if (active?.id === id) { liked = next; likeExists = true; }
    } catch (error) { showError(error); }
    finally { likeBusy = false; if (active?.id === id) { $('live-like-toggle').disabled = false; await refreshLikes().catch(showError); } }
  }
  async function join(id) {
    if (!userId()) { openAuthModal('login'); return; }
    if (busy) return;
    busy = true;
    try {
      await disconnect();
      const { data, error } = await getSB().from('live_rooms').select('*').eq('id', id).single();
      if (error) throw error;
      if (data.user_id === userId()) throw new Error('Para retomar tu camara, finaliza el PULSO anterior y prepara uno nuevo.');
      if (data.status !== 'live' || Date.parse(data.lease_until) <= Date.now()) throw new Error('Este PULSO ya no esta disponible.');
      active = data; nav('live'); await connect(data); await watchRoom(); await refreshRoom();
    } catch (error) { await disconnect(); active = null; showError(error); await directory(); }
    finally { busy = false; }
  }
  async function watchRoom() {
    const id = active.id;
    channel = getSB().channel(`shop-live-${id}-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'live_rooms', filter: `id=eq.${id}` }, () => void refreshRoom())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'live_room_messages', filter: `room_id=eq.${id}` }, () => void refreshComments().catch(showError))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'live_room_likes', filter: `room_id=eq.${id}` }, () => void refreshLikes().catch(showError))
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
        await directory(); status('PULSO termino o perdio conexion.'); return;
      }
      active = row;
      renderEffectControls();
      const { data: links, error: linksError } = await getSB().from('live_room_products').select('product_id,position').eq('room_id', id).order('position');
      if (linksError) throw linksError;
      const ids = (links || []).map(link => link.product_id);
      const result = ids.length ? await getSB().from('products').select('id,title,price,currency,image_url,status,user_id').in('id', ids).eq('status', 'published').eq('user_id', row.user_id) : { data: [], error: null };
      if (result.error) throw result.error;
      if (generation !== version || active?.id !== id) return;
      roomProducts = ids.map(productId => result.data.find(product => product.id === productId)).filter(Boolean);
      drawProducts(); await refreshComments(); await refreshLikes();
    } catch (error) { console.error('[KMD live refresh]', error); status('No pudimos actualizar productos/chat. Reintentando...'); }
    finally { refreshing = false; }
  }
  function drawProducts() {
    const signature = JSON.stringify([active.pinned_product_id, roomProducts]);
    if (productSignature === signature) return;
    productSignature = signature;
    const strip = $('live-products'); strip.replaceChildren();
    const picker = $('live-product-controls'); picker.replaceChildren();
    for (const product of roomProducts) {
      const row = document.createElement('div'); const label = document.createElement('span'); label.textContent = product.title;
      const selected = product.id === active.pinned_product_id;
      const action = button(selected ? 'Dejar de mostrar' : 'Mostrar ahora', () => pin(selected ? null : product.id), 'live-product-action');
      row.append(label, action); picker.append(row);
    }
    const shown = roomProducts.filter(product => product.id === active.pinned_product_id);
    $('live-player-layout').dataset.hasProduct = String(shown.length > 0);
    strip.hidden = !shown.length;
    for (const product of shown) {
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
        ? button('Dejar de mostrar', () => pin(null), 'live-product-action')
        : button('Ver y elegir', () => CommerceUI.showProduct(product.id), 'live-product-action');
      if (pinned) { const label = document.createElement('small'); label.textContent = 'Producto destacado'; content.prepend(label); }
      content.append(action); card.append(content); strip.append(card);
    }
  }
  async function pin(id) {
    if (!isPresenter()) return;
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
    const signature = JSON.stringify(messages);
    if (box.dataset.messages === signature) return;
    box.dataset.messages = signature;
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
    if (!box.childNodes.length) box.textContent = 'Buscando PULSOS...';
    try {
      const { data: rooms, error } = await getSB().from('live_rooms').select('*').eq('status', 'live').gt('lease_until', new Date().toISOString()).order('started_at', { ascending: false }).limit(30);
      if (error) throw error;
      if (currentPage !== 'live' || active) return;
      const ids = [...new Set(rooms.map(room => room.user_id))];
      const { data: profiles, error: profileError } = ids.length ? await getSB().from('public_profiles').select('id,username,first_name').in('id', ids) : { data: [], error: null };
      if (profileError) throw profileError;
      box.replaceChildren();
      if (!rooms.length) box.textContent = 'Todavia no hay PULSOS activos. Cuando un vendedor inicie, aparecera aca.';
      for (const row of rooms) {
        const card = document.createElement('article'); card.className = 'live-room-card';
        const title = document.createElement('h3'); title.textContent = row.title;
        const seller = document.createElement('p'); seller.textContent = profiles.find(profile => profile.id === row.user_id)?.username || 'Vendedor';
        card.append(title, seller, button('Entrar a PULSO', () => join(row.id), 'btn-p btn-pri')); box.append(card);
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
    document.body.classList.remove('live-immersive');
    $('live-settings').hidden = true;
    if (ownsFullscreen && document.fullscreenElement) { ownsFullscreen = false; void document.exitFullscreen().catch(() => {}); }
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
      catch (error) { console.error('[KMD live end]', error); toast('Camara apagada. No pudimos confirmar el cierre de sala: revisalo en PULSO.'); }
    }
  }
  async function end() {
    if (busy || !active || !confirm('Finalizar PULSO para todos?')) return;
    busy = true;
    try { await leave(); await directory(); }
    finally { busy = false; }
  }
  function canLeave() {
    if (busy) { toast('Espera a que termine la conexion de PULSO.'); return false; }
    return !active || active.user_id !== userId() || confirm('Al salir se apagara tu camara y se cerrara PULSO. Continuar?');
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
  return { openStudio, closeStudio, preview, start, page, join, sendComment, canLeave, leave, errorText, resumePlayback, setFilter, setBeauty, setQuality, toggleFit, toggleSettings, fullscreen };
})();
