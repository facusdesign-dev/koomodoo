window.FollowersModule = (() => {
  async function followUser(targetUserId) {
    const sb = getSB();
    const currentUserId = KMD?.session?.user?.id;
    if (!sb || !currentUserId || !targetUserId) return false;
    if (currentUserId === targetUserId) return false;

    const exists = await isFollowing(targetUserId);
    if (exists) return true;

    const { error } = await sb.from('followers').insert({
      follower_id: currentUserId,
      following_id: targetUserId,
      created_at: new Date().toISOString()
    });
    if (error) {
      console.error('[KMD] followUser:', error);
      return false;
    }
    return true;
  }

  async function unfollowUser(targetUserId) {
    const sb = getSB();
    const currentUserId = KMD?.session?.user?.id;
    if (!sb || !currentUserId || !targetUserId) return false;

    const { error } = await sb
      .from('followers')
      .delete()
      .eq('follower_id', currentUserId)
      .eq('following_id', targetUserId);

    if (error) {
      console.error('[KMD] unfollowUser:', error);
      return false;
    }
    return true;
  }

  async function isFollowing(targetUserId) {
    const sb = getSB();
    const currentUserId = KMD?.session?.user?.id;
    if (!sb || !currentUserId || !targetUserId) return false;

    const { data, error } = await sb
      .from('followers')
      .select('id')
      .eq('follower_id', currentUserId)
      .eq('following_id', targetUserId)
      .maybeSingle();

    if (error) {
      console.error('[KMD] isFollowing:', error);
      return false;
    }
    return !!data;
  }

  async function getFollowersCount(userId) {
    const sb = getSB();
    if (!sb || !userId) return 0;
    const { count, error } = await sb
      .from('followers')
      .select('id', { count: 'exact', head: true })
      .eq('following_id', userId);
    if (error) {
      console.error('[KMD] getFollowersCount:', error);
      return 0;
    }
    return count || 0;
  }

  async function getFollowingCount(userId) {
    const sb = getSB();
    if (!sb || !userId) return 0;
    const { count, error } = await sb
      .from('followers')
      .select('id', { count: 'exact', head: true })
      .eq('follower_id', userId);
    if (error) {
      console.error('[KMD] getFollowingCount:', error);
      return 0;
    }
    return count || 0;
  }

  async function getState(viewerId, targetUserId) {
    const [following, followers, followingCount] = await Promise.all([
      viewerId === targetUserId ? Promise.resolve(false) : isFollowing(targetUserId),
      getFollowersCount(targetUserId),
      getFollowingCount(targetUserId),
    ]);
    return {
      isFollowing: following,
      followers,
      following: followingCount,
    };
  }

  async function toggle(viewerId, targetUserId, nextState) {
    const ok = nextState ? await followUser(targetUserId) : await unfollowUser(targetUserId);
    if (!ok) throw new Error('No se pudo actualizar el seguimiento.');
    return getState(viewerId, targetUserId);
  }

  window.followUser = followUser;
  window.unfollowUser = unfollowUser;
  window.isFollowing = isFollowing;
  window.getFollowersCount = getFollowersCount;
  window.getFollowingCount = getFollowingCount;

  return {
    followUser,
    unfollowUser,
    isFollowing,
    getFollowersCount,
    getFollowingCount,
    getState,
    toggle,
  };
})();
