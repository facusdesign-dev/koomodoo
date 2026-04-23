window.ProfileModule = (() => {
  function makeUsername(email, id = '') {
    const base = String(email || 'user')
      .split('@')[0]
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '')
      .slice(0, 18) || 'user';
    const suffix = String(id || '').replace(/-/g, '').slice(0, 6) || Math.random().toString(36).slice(2, 8);
    return `${base}_${suffix}`;
  }

  function rowToUser(row, authUser) {
    const avatarUrl = row?.avatar_url || authUser?.user_metadata?.avatar_url || authUser?.user_metadata?.picture || '';
    return {
      id: authUser?.id || row?.id,
      email: row?.email || authUser?.email || '',
      firstName: row?.first_name || '',
      lastName: row?.last_name || '',
      username: row?.username || makeUsername(authUser?.email, authUser?.id),
      avatar: avatarUrl ? '🦁' : '🦁',
      photoUrl: avatarUrl,
      avatar_type: avatarUrl ? 'image' : 'emoji',
      avatar_value: avatarUrl || '🦁',
      bio: row?.bio || '',
      location: row?.location || '',
      phone: row?.phone || '',
      country: authUser?.user_metadata?.country || 'UY',
      createdAt: row?.created_at || new Date().toISOString(),
      profileComplete: !!(row?.first_name && row?.username),
      role: authUser?.user_metadata?.role || 'BUYER',
    };
  }

  async function fetchProfile(userId) {
    const sb = getSB();
    if (!sb || !userId) return null;
    const { data, error } = await sb.from('profiles').select('*').eq('id', userId).maybeSingle();
    if (error) throw error;
    return data || null;
  }

  async function ensureProfileForSession(session, seed = {}) {
    if (!session?.user) return null;
    const sb = getSB();
    if (!sb) return null;
    let row = await fetchProfile(session.user.id);
    if (!row) {
      const payload = {
        id: session.user.id,
        email: session.user.email || '',
        first_name: AuthModule.sanitizeText(seed.firstName || session.user.user_metadata?.full_name || '', 80),
        last_name: AuthModule.sanitizeText(seed.lastName || '', 80),
        username: AuthModule.sanitizeUsername(seed.username || makeUsername(session.user.email, session.user.id)),
        avatar_url: seed.photoUrl || session.user.user_metadata?.avatar_url || session.user.user_metadata?.picture || '',
        bio: AuthModule.sanitizeText(seed.bio, 240),
        location: AuthModule.sanitizeText(seed.location, 120),
        phone: AuthModule.normalizePhone(seed.phone),
        created_at: new Date().toISOString(),
      };
      const { data, error } = await sb.from('profiles').insert(payload).select('*').single();
      if (error) throw error;
      row = data;
    }
    return rowToUser(row, session.user);
  }

  async function saveProfile(profile) {
    const sb = getSB();
    if (!sb || !KMD?.session?.user?.id) return null;
    const payload = {
      id: KMD.session.user.id,
      email: KMD.session.user.email || profile.email || '',
      first_name: AuthModule.sanitizeText(profile.firstName, 80),
      last_name: AuthModule.sanitizeText(profile.lastName, 80),
      username: AuthModule.sanitizeUsername(profile.username || makeUsername(KMD.session.user.email, KMD.session.user.id)),
      avatar_url: profile.photoUrl || profile.avatar_value || profile.avatar || '',
      bio: AuthModule.sanitizeText(profile.bio, 240),
      location: AuthModule.sanitizeText(profile.location, 120),
      phone: AuthModule.normalizePhone(profile.phone),
      created_at: profile.createdAt || new Date().toISOString(),
    };
    const { data, error } = await sb.from('profiles').upsert(payload, { onConflict: 'id' }).select('*').single();
    if (error) throw error;
    return rowToUser(data, KMD.session.user);
  }

  async function loadProfileStats(userId) {
    const [followers, following, sales, rating] = await Promise.all([
      getFollowersCount(userId),
      getFollowingCount(userId),
      getSalesCount(userId),
      getAverageRating(userId),
    ]);
    return { followers, following, sales, rating };
  }

  async function loadPublicProfileSummary(userId) {
    const sb = getSB();
    if (!sb || !userId) return null;
    const { data, error } = await sb.from('profiles').select('*').eq('id', userId).maybeSingle();
    if (error) throw error;
    return data || null;
  }

  return {
    ensureProfileForSession,
    saveProfile,
    loadProfileStats,
    loadPublicProfileSummary,
    rowToUser,
    fetchProfile,
  };
})();
