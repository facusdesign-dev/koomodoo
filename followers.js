window.FollowersModule = (() => {
  function client() {
    const sb = getSB();
    if (!sb) throw new Error('Supabase no esta disponible.');
    return sb;
  }
  function viewer() {
    const id = KMD.session?.user?.id;
    if (!id) throw new Error('Inicia sesion para continuar.');
    return id;
  }
  async function isFollowing(targetId) {
    const { data, error } = await client().from('followers').select('follower_id').eq('follower_id', viewer()).eq('following_id', targetId).limit(1);
    if (error) { console.error('[KMD] isFollowing:', error); throw error; }
    return !!data?.length;
  }
  async function followUser(targetId) {
    const actorId = viewer();
    if (!targetId || targetId === actorId) throw new Error('No puedes seguir tu propio perfil.');
    if (await isFollowing(targetId)) return true;
    const { error } = await client().from('followers').insert({ follower_id: actorId, following_id: targetId });
    if (error && error.code !== '23505') { console.error('[KMD] followUser:', error); throw error; }
    window.dispatchEvent(new CustomEvent('kmd:follow-changed'));
    return true;
  }
  async function unfollowUser(targetId) {
    const { error } = await client().from('followers').delete().eq('follower_id', viewer()).eq('following_id', targetId);
    if (error) { console.error('[KMD] unfollowUser:', error); throw error; }
    window.dispatchEvent(new CustomEvent('kmd:follow-changed'));
    return true;
  }
  async function countBy(column, id) {
    if (!id) throw new Error('Falta el ID del perfil.');
    const { count, error } = await client().from('followers').select('*', { count: 'exact', head: true }).eq(column, id);
    if (error) { console.error('[KMD] followers count:', error); throw error; }
    return count ?? 0;
  }
  const getFollowersCount = id => countBy('following_id', id);
  const getFollowingCount = id => countBy('follower_id', id);
  async function getState(viewerId, targetId) {
    const [following, followers, followingCount] = await Promise.all([viewerId === targetId ? false : isFollowing(targetId), getFollowersCount(targetId), getFollowingCount(targetId)]);
    return { isFollowing: following, followers, following: followingCount };
  }
  async function toggle(viewerId, targetId, state) {
    await (state ? followUser(targetId) : unfollowUser(targetId));
    return getState(viewerId, targetId);
  }
  async function getNotifications(userId, offset = 0) {
    const sb = client();
    const { data, error } = await sb.from('notifications').select('*').eq('user_id', userId).eq('type', 'follow').order('created_at', { ascending: false }).order('id').range(offset,offset+49);
    if (error) throw error;
    const ids = [...new Set((data || []).map(row => row.actor_id))];
    if (!ids.length) return [];
    const result = await sb.from('public_profiles').select('id, first_name, username, avatar_url').in('id', ids);
    if (result.error) throw result.error;
    const followed = await sb.from('followers').select('following_id').eq('follower_id',viewer()).in('following_id',ids);
    if (followed.error) throw followed.error;
    const profiles = new Map(result.data.map(row => [row.id, row]));
    return data.map(row => ({ id: row.id, read: row.read, actorId: row.actor_id, actorName: profiles.get(row.actor_id)?.first_name || profiles.get(row.actor_id)?.username || 'Usuario', avatarUrl: profiles.get(row.actor_id)?.avatar_url || '', following:followed.data.some(f=>f.following_id===row.actor_id), actorAvatar: '\u{1F464}' }));
  }
  async function listConnections(userId, direction = 'followers', offset = 0) {
    const sb = client(), incoming = direction === 'followers';
    const column = incoming ? 'follower_id' : 'following_id';
    const result = await sb.from('followers').select(column).eq(incoming?'following_id':'follower_id', userId).order('created_at',{ascending:false}).order('id').range(offset,offset+49);
    if (result.error) throw result.error;
    const ids = result.data.map(row => row[column]);
    if (!ids.length) return { people:[], hasMore:false };
    const profiles = await sb.from('public_profiles').select('id,username,first_name,avatar_url').in('id',ids);
    if (profiles.error) throw profiles.error;
    const own = KMD.session?.user?.id;
    const following = own ? await sb.from('followers').select('following_id').eq('follower_id',own).in('following_id',ids) : {data:[]};
    if (following.error) throw following.error;
    return { people:ids.map(id => ({...(profiles.data.find(row=>row.id===id)||{id,username:'Usuario'}),following:following.data.some(row=>row.following_id===id)})),hasMore:ids.length===50 };
  }
  const api = { followUser, unfollowUser, isFollowing, getFollowersCount, getFollowingCount, getNotifications, listConnections, getState, toggle };
  Object.assign(window, api);
  return api;
})();
