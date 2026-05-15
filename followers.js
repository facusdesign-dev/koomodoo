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
    try {
      await sb.from('notifications').insert({
        user_id: targetUserId,
        actor_id: currentUserId,
        type: 'follow',
        created_at: new Date().toISOString()
      });
    } catch (notificationError) {
      console.error('[KMD] follow notification:', notificationError);
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
    const { data, count, error } = await sb
      .from('followers')
      .select('id', { count: 'exact' })
      .eq('following_id', userId);
    if (error) {
      console.error('[KMD] getFollowersCount:', error);
      return 0;
    }
    return Number((count ?? (data || []).length) || 0);
  }

  async function getFollowingCount(userId) {
    const sb = getSB();
    if (!sb || !userId) return 0;
    console.log('📊 getFollowingCount userId:', userId);
    const { data, count, error } = await sb
      .from('followers')
      .select('id', { count: 'exact' })
      .eq('follower_id', userId);
    console.log('📊 following count result:', (count ?? (data || []).length) || 0);
    if (error) {
      console.error('[KMD] getFollowingCount:', error);
      return 0;
    }
    return Number((count ?? (data || []).length) || 0);
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

  async function getNotifications(userId) {
    const sb = getSB();
    if (!sb || !userId) return [];
    const { data, error } = await sb
      .from('notifications')
      .select('id, user_id, actor_id, type, created_at')
      .eq('user_id', userId)
      .eq('type', 'follow')
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) {
      console.error('[KMD] getNotifications:', error);
      return [];
    }

    const actorIds = [...new Set((data || []).map(row => row.actor_id).filter(Boolean))];
    let profileMap = {};
    if (actorIds.length) {
      const { data: profiles, error: profilesError } = await sb
        .from('profiles')
        .select('id, first_name, username, avatar_url')
        .in('id', actorIds);
      if (profilesError) {
        console.error('[KMD] getNotifications profiles:', profilesError);
      } else {
        profileMap = Object.fromEntries((profiles || []).map(profile => [profile.id, profile]));
      }
    }

    return (data || []).map(row => {
      const actor = profileMap[row.actor_id] || {};
      return {
        id: row.id,
        actorId: row.actor_id,
        actorName: actor.first_name || actor.username || 'Usuario',
        actorAvatar: actor.avatar_url ? `<img src="${actor.avatar_url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">` : '👤',
        type: row.type,
        createdAt: row.created_at,
      };
    });
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
  window.getNotifications = getNotifications;

  return {
    followUser,
    unfollowUser,
    isFollowing,
    getFollowersCount,
    getFollowingCount,
    getNotifications,
    getState,
    toggle,
  };
})();
