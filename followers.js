window.FollowersModule = (() => {
  async function getState(viewerId, targetUserId) {
    const sb = getSB();
    if (!sb || !targetUserId) return { isFollowing: false, followers: 0, following: 0 };
    const [followRes, followersRes, followingRes] = await Promise.all([
      viewerId ? sb.from('followers').select('id').eq('follower_id', viewerId).eq('following_id', targetUserId).maybeSingle() : Promise.resolve({ data: null, error: null }),
      sb.from('followers').select('id', { count: 'exact', head: true }).eq('following_id', targetUserId),
      sb.from('followers').select('id', { count: 'exact', head: true }).eq('follower_id', targetUserId),
    ]);
    if (followRes.error) throw followRes.error;
    if (followersRes.error) throw followersRes.error;
    if (followingRes.error) throw followingRes.error;
    return {
      isFollowing: !!followRes.data,
      followers: followersRes.count || 0,
      following: followingRes.count || 0,
    };
  }

  async function toggle(viewerId, targetUserId, nextState) {
    const sb = getSB();
    if (!sb || !viewerId || !targetUserId) throw new Error('Faltan datos para seguir este perfil.');
    if (viewerId === targetUserId) throw new Error('No podés seguirte a vos mismo.');
    if (nextState) {
      const { error } = await sb.from('followers').insert({ follower_id: viewerId, following_id: targetUserId });
      if (error && !String(error.message || '').includes('duplicate')) throw error;
    } else {
      const { error } = await sb.from('followers').delete().eq('follower_id', viewerId).eq('following_id', targetUserId);
      if (error) throw error;
    }
    return getState(viewerId, targetUserId);
  }

  return {
    getState,
    toggle,
  };
})();
