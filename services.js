window.ServicesModule = (() => {
  async function publish(payload) {
    const sb = getSB();
    if (!sb || !KMD?.session?.user?.id) throw new Error('Necesitás iniciar sesión para publicar un servicio.');
    const clean = {
      user_id: KMD.session.user.id,
      title: AuthModule.sanitizeText(payload.title, 120),
      description: AuthModule.sanitizeText(payload.description, 500),
      phone: AuthModule.normalizePhone(payload.phone),
      location: AuthModule.sanitizeText(payload.location, 120),
      category: AuthModule.sanitizeText(payload.category, 60),
      created_at: new Date().toISOString(),
    };
    const { data, error } = await sb.from('services').insert(clean).select('*').single();
    if (error) throw error;
    return data;
  }

  async function list(filters = {}) {
    const sb = getSB();
    if (!sb) return [];
    let query = sb.from('services').select('*').order('created_at', { ascending: false }).limit(50);
    if (filters.category && filters.category !== 'all') query = query.eq('category', filters.category);
    if (filters.q) query = query.or(`title.ilike.%${filters.q}%,description.ilike.%${filters.q}%,location.ilike.%${filters.q}%`);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  return { publish, list };
})();
