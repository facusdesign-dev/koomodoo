window.ProfileModule = (() => {
  function getAuthUserNameParts(user) {
    const meta = user?.user_metadata || {};
    const full = String(meta.full_name || '').trim();
    const parts = full ? full.split(/\s+/) : [];
    return {
      first_name: meta.first_name || meta.given_name || parts[0] || '',
      last_name: meta.last_name || meta.family_name || parts.slice(1).join(' ') || '',
    };
  }

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

  async function createProfile(authUser, seed = {}) {
    const sb = getSB();
    if (!sb || !authUser?.id) return null;
    const names = getAuthUserNameParts(authUser);
    const payload = {
      id: authUser.id,
      email: authUser.email || '',
      first_name: AuthModule.sanitizeText(seed.firstName || names.first_name, 80),
      last_name: AuthModule.sanitizeText(seed.lastName || names.last_name, 80),
      username: AuthModule.sanitizeUsername(seed.username || makeUsername(authUser.email, authUser.id)),
      avatar_url: seed.photoUrl || authUser.user_metadata?.avatar_url || authUser.user_metadata?.picture || '',
      bio: AuthModule.sanitizeText(seed.bio, 240),
      location: AuthModule.sanitizeText(seed.location, 120),
      phone: AuthModule.normalizePhone(seed.phone),
      created_at: new Date().toISOString(),
    };
    const { data, error } = await sb.from('profiles').insert(payload).select('*').single();
    if (error) throw error;
    return data;
  }

  async function ensureProfileForSession(session, seed = {}) {
    if (!session?.user) return null;
    const sb = getSB();
    if (!sb) {
      return rowToUser({
        id: session.user.id,
        email: session.user.email,
        first_name: seed.firstName || '',
        last_name: seed.lastName || '',
        username: seed.username || makeUsername(session.user.email, session.user.id),
        avatar_url: seed.photoUrl || session.user.user_metadata?.avatar_url || '',
        bio: seed.bio || '',
        location: seed.location || '',
        phone: seed.phone || '',
        created_at: new Date().toISOString(),
      }, session.user);
    }
    let authUser = session.user;
    try {
      const { data } = await sb.auth.getUser();
      if (data?.user) authUser = data.user;
    } catch {}
    let row = await fetchProfile(authUser.id);
    if (!row) {
      row = await createProfile(authUser, seed);
    }
    return rowToUser(row, authUser);
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
    const sb = getSB();
    if (!sb || !userId) return { followers: 0, following: 0, sales: 0, rating: 0 };
    const [
      followersRes,
      followingRes,
      salesRes,
      ratingsRes,
    ] = await Promise.all([
      sb.from('followers').select('id', { count: 'exact', head: true }).eq('following_id', userId),
      sb.from('followers').select('id', { count: 'exact', head: true }).eq('follower_id', userId),
      sb.from('sales').select('id', { count: 'exact', head: true }).eq('seller_id', userId).eq('status', 'completed'),
      sb.from('ratings').select('rating').eq('to_user', userId),
    ]);
    if (followersRes.error) throw followersRes.error;
    if (followingRes.error) throw followingRes.error;
    if (salesRes.error) throw salesRes.error;
    if (ratingsRes.error) throw ratingsRes.error;
    const ratingRows = ratingsRes.data || [];
    const rating = ratingRows.length
      ? (ratingRows.reduce((sum, row) => sum + Number(row.rating || 0), 0) / ratingRows.length).toFixed(1)
      : '0.0';
    return {
      followers: followersRes.count || 0,
      following: followingRes.count || 0,
      sales: salesRes.count || 0,
      rating,
    };
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
