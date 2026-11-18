window.CommunityUI = (() => {
  let channel, timer, currentUser, version = 0, modalKind, profileId, offset = 0, pending = false, focusBefore;
  const $ = id => document.getElementById(id);
  function close() { version++; $('community-overlay')?.remove(); modalKind=null; focusBefore?.focus?.(); }
  function dialog(title) {
    close(); focusBefore=document.activeElement;
    const overlay=document.createElement('div');overlay.id='community-overlay';overlay.className='community-overlay';
    overlay.onclick=event=>{if(event.target===overlay)close();};
    const panel=document.createElement('section');panel.className='community-panel';panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label',title);
    const header=document.createElement('header'),heading=document.createElement('h2'),exit=document.createElement('button');
    heading.textContent=title;exit.type='button';exit.textContent='Cerrar';exit.onclick=close;
    header.append(heading,exit);const rows=document.createElement('div');rows.id='community-rows';rows.setAttribute('aria-live','polite');
    const more=document.createElement('button');more.id='community-more';more.type='button';more.textContent='Ver mas';more.hidden=true;more.onclick=()=>void loadConnections();
    panel.append(header,rows,more);overlay.append(panel);document.body.append(overlay);exit.focus();
  }
  function row(person, note) {
    const item=document.createElement('div');item.className='community-person';
    const open=document.createElement('button');open.type='button';open.className='community-person-link';
    const avatar=document.createElement('span');avatar.className='community-avatar';
    const value=typeof resolveAvatarDisplayUrl==='function'?resolveAvatarDisplayUrl(person.avatar_url||''):person.avatar_url||'';
    if (/^https?:\/\//i.test(value)) { const img=document.createElement('img');img.src=value;img.alt='';avatar.append(img); }
    else avatar.textContent=value||'K';
    const text=document.createElement('span'),name=document.createElement('strong');name.textContent=person.username||person.first_name||'Usuario';text.append(name);
    if(note){const detail=document.createElement('small');detail.textContent=note;text.append(detail);}
    open.append(avatar,text);open.onclick=()=>{close();openSearchResult('profile',person.id);};item.append(open);
    if(person.id!==KMD.session?.user?.id){
      const follow=document.createElement('button');follow.type='button';follow.className='community-follow';
      const draw=()=>{follow.textContent=person.following?'Siguiendo':'Seguir';follow.setAttribute('aria-pressed',String(!!person.following));};draw();
      follow.onclick=async()=>{
        if(!KMD.session?.user){openAuthModal('login');return;}
        follow.disabled=true;
        try{await (person.following?FollowersModule.unfollowUser(person.id):FollowersModule.followUser(person.id));person.following=!person.following;draw();}
        catch(error){console.error('[KMD community follow]',error);toast('No se pudo actualizar el seguimiento.');}
        finally{follow.disabled=false;}
      };item.append(follow);
    }
    return item;
  }
  async function loadConnections() {
    if(pending===version)return;const token=version;pending=token;
    const box=$('community-rows'),more=$('community-more');more.disabled=true;
    if(!offset)box.textContent='Cargando perfiles...';
    try{
      const result=await FollowersModule.listConnections(profileId,modalKind,offset);
      if(token!==version)return;
      if(!offset)box.replaceChildren();
      for(const person of result.people)box.append(row(person));
      offset+=result.people.length;more.hidden=!result.hasMore;
      if(!offset)box.textContent='Todavia no hay perfiles en esta lista.';
    }catch(error){if(token===version)box.textContent='No se pudo cargar la lista. Cerra y volve a intentar.';console.error('[KMD connections]',error);}
    finally{if(pending===token)pending=false;if(token===version)more.disabled=false;}
  }
  function openConnections(id,kind='followers') { dialog(kind==='followers'?'Seguidores':'Siguiendo');modalKind=kind;profileId=id;offset=0;void loadConnections(); }
  async function updateBadge() {
    const id=KMD.session?.user?.id;if(!id)return;
    const result=await getSB().from('notifications').select('id',{count:'exact',head:true}).eq('user_id',id).eq('read',false);
    if(result.error)throw result.error;
    if(KMD.session?.user?.id!==id)return;
    setBadgeValue('notification-badge',result.count||0);
  }
  async function loadNotifications(append = false) {
    const token=++version,box=$('community-rows'),id=KMD.session?.user?.id;
    if(!id)return;
    const more=$('community-more');more.disabled=true;
    if(!append){offset=0;box.textContent='Cargando notificaciones...';}
    try{
      const notifications=await FollowersModule.getNotifications(id,offset);
      if(token!==version)return;
      if(!append)box.replaceChildren();
      for(const n of notifications)box.append(row({id:n.actorId,username:n.actorName,avatar_url:n.avatarUrl,following:n.following},n.type==='story_like'?'indicó que le gusta tu historia':'te comenzó a seguir'));
      offset+=notifications.length;more.hidden=notifications.length<50;more.onclick=()=>void loadNotifications(true);
      if(!offset)box.textContent='Todavia no tenes notificaciones.';
      const unread=notifications.filter(n=>!n.read).map(n=>n.id);
      if(unread.length){const result=await getSB().from('notifications').update({read:true}).eq('user_id',id).in('id',unread);if(result.error)throw result.error;}
      await updateBadge();
    }catch(error){if(token===version)box.textContent='No se pudieron cargar las notificaciones.';console.error('[KMD notifications]',error);}
    finally{if(token===version)more.disabled=false;}
  }
  function openNotifications(){if(!KMD.session?.user){openAuthModal('login');return;}dialog('Notificaciones');modalKind='notifications';void loadNotifications();}
  async function refreshStats(){
    if(typeof currentPage==='undefined'||currentPage!=='perfil')return;
    const target=activeProfileId||KMD.session?.user?.id;if(!target)return;
    const [followers,following]=await Promise.all([FollowersModule.getFollowersCount(target),FollowersModule.getFollowingCount(target)]);
    if(currentPage!=='perfil'||target!==(activeProfileId||KMD.session?.user?.id))return;
    if($('followers-count'))$('followers-count').textContent=String(followers);
    if($('following-count'))$('following-count').textContent=String(following);
  }
  function stop(){
    if(channel){void getSB().removeChannel(channel);channel=null;}
    clearInterval(timer);timer=null;currentUser=null;close();setBadgeValue('notification-badge',0);
  }
  function start(){
    const id=KMD.session?.user?.id;if(!id||currentUser===id)return;
    stop();currentUser=id;
    const reconcile=()=>{if(!document.hidden)void Promise.all([updateBadge(),refreshStats()]).catch(error=>console.error('[KMD social]',error));};
    channel=getSB().channel(`community-${id}`)
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'notifications',filter:`user_id=eq.${id}`},()=>{
        if(currentUser!==id)return;
        toast('Tenés una notificación nueva.');reconcile();if(modalKind==='notifications')void loadNotifications();
      })
      .on('postgres_changes',{event:'UPDATE',schema:'public',table:'notifications',filter:`user_id=eq.${id}`},reconcile)
      .on('postgres_changes',{event:'*',schema:'public',table:'followers',filter:`following_id=eq.${id}`},reconcile)
      .on('postgres_changes',{event:'*',schema:'public',table:'followers',filter:`follower_id=eq.${id}`},reconcile).subscribe();
    timer=setInterval(reconcile,30000);reconcile();
  }
  window.addEventListener('kmd:follow-changed',()=>void refreshStats().catch(console.error));
  document.addEventListener('keydown',event=>{
    const overlay=$('community-overlay');if(!overlay)return;
    if(event.key==='Escape'){close();return;}
    if(event.key==='Tab'){
      const controls=[...overlay.querySelectorAll('button:not([disabled]),a[href],input,select,textarea')].filter(el=>!el.hidden);
      const first=controls[0],last=controls.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    }
  });
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&currentUser)void updateBadge().catch(console.error);});
  return {start,stop,openConnections,openNotifications,close};
})();
