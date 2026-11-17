window.StoriesModule = (() => {
  let channel, timer, loading, callback = () => {}, sequence = 0;
  const types = { 'image/jpeg':'jpg', 'image/png':'png', 'image/webp':'webp', 'image/gif':'gif', 'video/mp4':'mp4', 'video/webm':'webm', 'video/quicktime':'mov' };
  async function publishingUser() {
    const sb = getSB();
    if (!sb) throw new Error('No pudimos conectar con Supabase. Intenta nuevamente.');
    const result = await sb.auth.getUser();
    if (result.error || !result.data?.user) throw new Error('Tu sesion no esta activa. Inicia sesion nuevamente para publicar.');
    if (result.data.user.id !== KMD.session?.user?.id) throw new Error('La cuenta activa cambio. Recarga la pagina antes de publicar.');
    return result.data.user;
  }
  async function getPublishableProducts() {
    const user = await publishingUser();
    const result = await getSB().from('products').select('id,title').eq('user_id',user.id).eq('status','published').order('created_at',{ascending:false}).limit(100);
    if (result.error) throw new Error('No pudimos cargar tus productos. Intenta nuevamente.');
    return result.data || [];
  }
  async function hydrate(rows, strict = false) {
    if (!rows.length) return [];
    const sb = getSB(), ids = [...new Set(rows.map(row => row.user_id))];
    const profiles = await sb.from('public_profiles').select('id,username,first_name,avatar_url').in('id', ids);
    if (profiles.error) throw profiles.error;
    return Promise.all(rows.map(async row => {
      const seconds = Math.min(600, Math.floor((Date.parse(row.expires_at) - Date.now()) / 1000));
      if (seconds < 1) return null;
      const signed = await sb.storage.from('story-media').createSignedUrl(row.media_url, seconds);
      if (signed.error) {
        if (strict) throw signed.error;
        console.warn('[KMD unavailable story media]', row.id, signed.error.message);
        return null;
      }
      const author = profiles.data.find(profile => profile.id === row.user_id);
      return { ...row, storage_path: row.media_url, media_url: signed.data.signedUrl,
        author_name: author?.username || author?.first_name || 'Usuario',
        author_avatar: author?.avatar_url || row.author_avatar || '',
        author_avatar_type: author?.avatar_url ? 'image' : row.author_avatar_type };
    })).then(items => items.filter(Boolean));
  }
  async function list() {
    const result = await getSB().from('stories').select('*').gt('expires_at', new Date().toISOString()).order('created_at', { ascending:false }).limit(100);
    if (result.error) throw result.error;
    return hydrate(result.data || []);
  }
  async function publish({ mediaUrl, caption = '', productId = null, duration = 15 }) {
    const user = await publishingUser();
    const sb = getSB();
    duration=Number(duration);if(!Number.isInteger(duration)||duration<15||duration>30)throw new Error('La duracion debe estar entre 15 y 30 segundos.');
    productId = productId ? String(productId).trim() : null;
    if (productId) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(productId)) throw new Error('El producto no es valido. Elegi uno de tu tienda o Sin producto.');
      const product = await sb.from('products').select('id').eq('id',productId).eq('user_id',user.id).eq('status','published').maybeSingle();
      if (product.error) throw new Error('No pudimos comprobar el producto. Intenta nuevamente.');
      if (!product.data) throw new Error('Solo podes destacar productos propios y publicados. Elegi uno de tu tienda o Sin producto.');
    }
    if (!/^data:(image|video)\//i.test(mediaUrl || '')) throw new Error('Selecciona una foto o video de tu dispositivo.');
    const blob = await (await fetch(mediaUrl)).blob();
    if (!types[blob.type] || blob.size > 10485760) throw new Error('Usa una foto o video compatible de hasta 10 MB.');
    caption = String(caption).trim();
    if (caption.length > 500) throw new Error('La descripcion admite hasta 500 caracteres.');
    const path = `stories/${user.id}/${crypto.randomUUID()}.${types[blob.type]}`;
    const upload = await sb.storage.from('story-media').upload(path, blob, { upsert:false, contentType:blob.type });
    if (upload.error) throw upload.error;
    const result = await sb.from('stories').insert({ user_id:user.id, media_url:path, media_type:blob.type.startsWith('video/')?'video':'image', caption, product_id:productId || null, duration_seconds:duration }).select().single();
    if (result.error) {
      await sb.storage.from('story-media').remove([path]).catch(error => console.error('[KMD story cleanup]',error));
      console.error('[KMD story insert]', result.error);
      if (result.error.code === '42501') throw new Error('No se autorizo la historia. Verifica tu sesion y que el producto siga publicado en tu cuenta, o elegi Sin producto.');
      throw result.error;
    }
    // Publication is confirmed by the database, not by an in-memory preview.
    let rows;
    try { rows = await hydrate([result.data], true); }
    catch (error) {
      const failure = new Error('La historia se guardo, pero no pudimos cargar su vista previa. Recarga la pagina para comprobarla.');
      failure.published = true; console.error('[KMD story preview]', error); throw failure;
    }
    await refresh().catch(error => console.warn('[KMD story published, feed refresh pending]',error));
    return rows[0];
  }
  async function refresh() {
    if (loading) return loading;
    const version = sequence;
    loading = list().then(rows => { if (version === sequence) callback(rows); return rows; }).catch(error => {
      console.error('[KMD stories]',error); throw error;
    }).finally(() => { loading = null; });
    return loading;
  }
  function start(onChange) {
    callback = onChange;
    if (channel) return;
    const sb = getSB(); if (!sb) return;
    const refreshQuietly = () => { if (!document.hidden) void refresh().catch(() => {}); };
    channel = sb.channel('public-stories').on('postgres_changes', { event:'*', schema:'public', table:'stories' }, refreshQuietly).subscribe();
    timer = setInterval(refreshQuietly, 30000);
    document.addEventListener('visibilitychange', refreshQuietly);
    refreshQuietly();
  }
  async function remove(id){
    const user=await publishingUser(),sb=getSB();
    const result=await sb.from('stories').delete().eq('id',id).eq('user_id',user.id).select('id,media_url').maybeSingle();
    if(result.error)throw result.error;if(!result.data)throw new Error('No podes eliminar esta historia o ya no esta disponible.');
    try{const cleanup=await sb.storage.from('story-media').remove([result.data.media_url]);if(cleanup.error)console.warn('[KMD deleted story file cleanup]',cleanup.error);}
    catch(error){console.warn('[KMD deleted story file cleanup]',error);}
    await refresh().catch(console.error);return true;
  }
  async function activity(id){
    const sb=getSB(),user=KMD.session?.user?.id;
    const [likes,own,comments]=await Promise.all([
      sb.from('story_likes').select('user_id',{count:'exact',head:true}).eq('story_id',id),
      user?sb.from('story_likes').select('user_id').eq('story_id',id).eq('user_id',user).maybeSingle():{data:null},
      sb.from('story_comments').select('id,user_id,text,created_at').eq('story_id',id).order('created_at',{ascending:false}).limit(50)
    ]);
    for(const result of [likes,own,comments])if(result.error)throw result.error;
    const ids=[...new Set(comments.data.map(row=>row.user_id))];
    const people=ids.length?await sb.from('public_profiles').select('id,username,first_name,avatar_url').in('id',ids):{data:[]};if(people.error)throw people.error;
    return {likes:likes.count||0,liked:!!own.data,comments:comments.data.map(row=>({...row,author:people.data.find(p=>p.id===row.user_id)}))};
  }
  async function like(id,liked){
    const user=await publishingUser(),sb=getSB();
    const result=liked?await sb.from('story_likes').insert({story_id:id,user_id:user.id}):await sb.from('story_likes').delete().eq('story_id',id).eq('user_id',user.id);
    if(result.error&&result.error.code!=='23505')throw result.error;return liked;
  }
  async function comment(id,text){
    const user=await publishingUser();text=String(text).trim();if(!text||text.length>500)throw new Error('Escribi un comentario de hasta 500 caracteres.');
    const result=await getSB().from('story_comments').insert({story_id:id,user_id:user.id,text});if(result.error)throw result.error;
  }
  return { list, publish, refresh, start, getPublishableProducts, remove, activity, like, comment };
})();
