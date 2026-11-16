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
    if (!error) {
      const { error: notificationError } = await client().from('notifications').insert({ user_id: targetId, actor_id: actorId, type: 'follow' });
      if (notificationError) console.error('[KMD] follow notification:', notificationError);
    }
    return true;
  }
  async function unfollowUser(targetId) {
    const { error } = await client().from('followers').delete().eq('follower_id', viewer()).eq('following_id', targetId);
    if (error) { console.error('[KMD] unfollowUser:', error); throw error; }
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
  async function getNotifications(userId) {
    const sb = client();
    const { data, error } = await sb.from('notifications').select('*').eq('user_id', userId).eq('type', 'follow').order('created_at', { ascending: false }).limit(20);
    if (error) throw error;
    const ids = [...new Set((data || []).map(row => row.actor_id))];
    if (!ids.length) return [];
    const result = await sb.from('public_profiles').select('id, first_name, username, avatar_url').in('id', ids);
    if (result.error) throw result.error;
    const profiles = new Map(result.data.map(row => [row.id, row]));
    return data.map(row => ({ id: row.id, actorId: row.actor_id, actorName: profiles.get(row.actor_id)?.first_name || profiles.get(row.actor_id)?.username || 'Usuario', actorAvatar: '\u{1F464}' }));
  }
  const api = { followUser, unfollowUser, isFollowing, getFollowersCount, getFollowingCount, getNotifications, getState, toggle };
  Object.assign(window, api);
  return api;
})();
