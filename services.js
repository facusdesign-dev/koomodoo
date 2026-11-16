window.ServicesModule = (() => {
  async function list({ category = 'all', q = '' } = {}) {
    const sb = getSB();
    if (!sb) throw new Error('Supabase no esta disponible.');
    let query = sb.from('services').select('*').order('created_at', { ascending: false }).limit(50);
    if (category !== 'all') query = query.eq('category', category);
    if (q.trim()) query = query.ilike('title', `%${q.trim().slice(0, 100)}%`);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }
  async function publish(values) {
    const sb = getSB();
    const userId = KMD.session?.user?.id;
    if (!sb || !userId) throw new Error('Inicia sesion para publicar.');
    const payload = { user_id: userId };
    for (const field of ['title', 'description', 'phone', 'location', 'category']) payload[field] = AuthModule.sanitizeText(values[field], field === 'description' ? 1200 : 120);
    const { data, error } = await sb.from('services').insert(payload).select().single();
    if (error) throw error;
    return data;
  }
  return { list, publish };
})();
