window.StoryViewer = (() => {
  let playlist=[],index=0,serial=0,frame=null,channel=null,poll=null,elapsed=0,last=0,paused=false,loading=true,commentsOpen=false,liked=false,liking=false;
  const $=id=>document.getElementById(id);
  const duration=story=>Math.min(30,Math.max(15,Number(story.durationSeconds)||(story.mediaType==='video'?30:15)));
  function stop(){if(frame!==null)cancelAnimationFrame(frame);frame=null;clearInterval(poll);poll=null;if(channel){void getSB().removeChannel(channel);channel=null;}const video=$('story-media')?.querySelector('video');if(video){video.pause();video.removeAttribute('src');video.load();}}
  function close(){serial++;stop();$('sv-overlay').classList.remove('show');$('sv-overlay').replaceChildren();currentStoryOwnerId=null;currentStoryRecordId=null;currentSvPid=null;}
  function advance(step=1){const next=index+step;if(next<0)return;if(next>=playlist.length){close();return;}index=next;void render();}
  function tick(now){
    if(!last)last=now;
    if(!paused&&!loading&&!commentsOpen&&!document.hidden)elapsed+=now-last;
    last=now;const story=playlist[index];if(!story)return;
    const progress=Math.min(1,elapsed/(duration(story)*1000));if($('story-progress-fill'))$('story-progress-fill').style.width=(progress*100)+'%';
    if(progress>=1){advance();return;}frame=requestAnimationFrame(tick);
  }
  async function refreshActivity(){
    const token=serial,story=playlist[index];if(!story)return;
    try{const data=await StoriesModule.activity(story.id);if(token!==serial)return;liked=data.liked;
      $('story-like').textContent=(liked?'♥':'♡')+' '+data.likes;$('story-like').setAttribute('aria-pressed',String(liked));
      if(!liking)$('story-like').disabled=false;
      const box=$('story-comment-list');box.replaceChildren();
      for(const comment of [...data.comments].reverse()){
        const row=document.createElement('p'),name=document.createElement('strong'),text=document.createElement('span');name.textContent=(comment.author?.username||comment.author?.first_name||'Usuario')+': ';text.textContent=comment.text;row.append(name,text);box.append(row);
      }if(!data.comments.length)box.textContent='Todavia no hay comentarios.';
    }catch(error){console.error('[KMD story activity]',error);if(token===serial)$('story-action-status').textContent='No pudimos actualizar likes y comentarios.';}
  }
  async function render(){
    stop();const token=++serial,story=playlist[index];if(!story){close();return;}
    elapsed=0;last=0;paused=false;loading=true;commentsOpen=false;liked=false;
    currentStoryOwnerId=story.userId||KMD.session?.user?.id;currentStoryRecordId=story.id;currentSvPid=story.pid||null;
    const overlay=$('sv-overlay');overlay.classList.add('show');overlay.innerHTML='<section class="story-card" role="dialog" aria-modal="true" aria-label="Historia"><div class="story-progress"><div id="story-progress-fill"></div></div><header class="story-header"><span id="story-author-avatar" class="community-avatar"></span><strong id="story-author-name"></strong><button type="button" id="story-close" aria-label="Cerrar historia">Cerrar</button></header><div id="story-media" class="story-media"></div><p id="story-caption"></p><div id="story-product" hidden></div><p id="story-action-status" role="status"></p><nav class="story-actions"><button id="story-prev" type="button" aria-label="Historia anterior">←</button><button id="story-pause" type="button">Pausar</button><button id="story-next" type="button" aria-label="Siguiente historia">→</button><button id="story-like" type="button" aria-label="Me gusta" aria-pressed="false">♡</button><button id="story-comments-toggle" type="button">Comentar</button><button id="story-delete" type="button" hidden>Eliminar</button></nav><section id="story-comments" hidden><header><strong>Comentarios publicos</strong><button id="story-comments-close" type="button">Cerrar comentarios</button></header><div id="story-comment-list"></div><form id="story-comment-form"><input id="sv-reply" placeholder="Escribi un comentario..." maxlength="500" aria-label="Comentario de historia" required><button type="submit">Enviar</button></form><button id="story-private-reply" type="button">Enviar como mensaje privado</button></section></section>';
    $('story-author-name').textContent=story.authorName||(story.userId===KMD.session?.user?.id?'Tu historia':'Usuario');
    const avatar=story.authorAvatar||(story.userId===KMD.session?.user?.id?KMD.user?.photoUrl:'')||'';
    $('story-like').disabled=true;
    $('story-close').focus();
    const sound=document.createElement('button');sound.type='button';sound.textContent='Activar sonido';sound.hidden=story.mediaType!=='video';$('story-pause').after(sound);
    sound.onclick=()=>{const video=$('story-media').querySelector('video');if(video){video.muted=!video.muted;sound.textContent=video.muted?'Activar sonido':'Silenciar';}};
    if(/^(https?:\/\/|data:image\/)/.test(avatar)){const image=document.createElement('img');image.src=avatar;image.alt='';$('story-author-avatar').append(image);}else $('story-author-avatar').textContent=story.em||'K';
    $('story-caption').textContent=story.caption||'';
    $('story-close').onclick=close;$('story-prev').onclick=()=>advance(-1);$('story-prev').disabled=index===0;$('story-next').onclick=()=>advance();
    $('story-pause').onclick=()=>{paused=!paused;$('story-pause').textContent=paused?'Reproducir':'Pausar';const video=$('story-media').querySelector('video');if(video){if(paused)video.pause();else void video.play().catch(()=>{$('story-action-status').textContent='No se pudo reproducir el video.';});}};
    const toggleComments=show=>{commentsOpen=show;$('story-comments').hidden=!show;if(show)$('sv-reply').focus();};
    $('story-comments-toggle').onclick=()=>toggleComments(!commentsOpen);$('story-comments-close').onclick=()=>toggleComments(false);
    $('story-private-reply').hidden=!KMD.session?.user?.id||story.userId===KMD.session.user.id;$('story-private-reply').onclick=()=>void replyToStory();
    $('story-comment-form').onsubmit=async event=>{event.preventDefault();if(!KMD.session?.user?.id){openAuthModal('login');return;}
      const input=$('sv-reply'),button=event.submitter||$('story-comment-form').querySelector('button');if(button.disabled)return;button.disabled=true;
      try{await StoriesModule.comment(story.id,input.value);if(token!==serial)return;input.value='';await refreshActivity();}
      catch(error){if(token===serial)$('story-action-status').textContent=error.message;}finally{button.disabled=false;}
    };
    $('story-like').onclick=async()=>{if(!KMD.session?.user?.id){paused=true;openAuthModal('login');return;}if(liking)return;liking=true;$('story-like').disabled=true;
      try{await StoriesModule.like(story.id,!liked);if(token===serial)await refreshActivity();}catch(error){if(token===serial)$('story-action-status').textContent=error.message;}finally{liking=false;if(token===serial)$('story-like').disabled=false;}
    };
    $('story-delete').hidden=story.userId!==KMD.session?.user?.id;
    $('story-delete').onclick=async()=>{if(!confirm('Eliminar esta historia? Se quitaran tambien sus likes y comentarios.'))return;
      $('story-delete').disabled=true;paused=true;
      try{await StoriesModule.remove(story.id);if(token!==serial)return;STORY_STORE.splice(0,STORY_STORE.length,...STORY_STORE.filter(item=>item.id!==story.id));playlist.splice(index,1);renderStories();toast('Historia eliminada.');if(index>=playlist.length)close();else void render();}
      catch(error){if(token===serial){$('story-action-status').textContent=error.message;$('story-delete').disabled=false;paused=false;}}
    };
    if(story.pid){
      const product=getProduct(story.pid);if(product){$('story-product').hidden=false;const title=document.createElement('strong'),description=document.createElement('small'),buy=document.createElement('button');title.textContent=product.title;description.textContent=product.desc||'';buy.textContent='Ver producto y comprar';buy.onclick=()=>{const id=story.pid;close();CommerceUI.showProduct(id);};$('story-product').append(title,description,buy);}
    }
    const media=document.createElement(story.mediaType==='video'?'video':'img');media.src=story.mediaUrl;media.alt=story.caption||'Historia';
    const ready=()=>{if(token===serial)loading=false;};media.onerror=()=>{if(token===serial){loading=false;$('story-action-status').textContent='No se pudo cargar esta imagen o video.';}};
    if(story.mediaType==='video'){
      media.muted=true;media.playsInline=true;media.autoplay=true;media.onloadeddata=ready;media.onplaying=ready;media.onwaiting=()=>{if(token===serial)loading=true;};media.onended=()=>{if(token===serial)loading=false;};
      $('story-media').append(media);void media.play().catch(()=>{if(token===serial){paused=true;loading=false;$('story-pause').textContent='Reproducir';}});
    }else{media.onload=ready;$('story-media').append(media);if(media.complete&&media.naturalWidth)ready();}
    frame=requestAnimationFrame(tick);void refreshActivity();
    channel=getSB().channel(`story-${story.id}-${token}`).on('postgres_changes',{event:'*',schema:'public',table:'story_likes',filter:`story_id=eq.${story.id}`},()=>void refreshActivity()).on('postgres_changes',{event:'INSERT',schema:'public',table:'story_comments',filter:`story_id=eq.${story.id}`},()=>void refreshActivity()).subscribe();
    poll=setInterval(()=>void refreshActivity(),10000);
  }
  function open(id){
    const stories=STORY_STORE.filter(story=>Date.parse(story.expiresAt)>Date.now()),selected=stories.find(story=>story.id===id);if(!selected){toast('Esta historia ya no esta disponible.');return;}
    playlist=[...stories.filter(s=>s.userId===selected.userId).sort((a,b)=>Date.parse(a.createdAt)-Date.parse(b.createdAt)),...stories.filter(s=>s.userId!==selected.userId)];index=playlist.findIndex(s=>s.id===id);void render();
  }
  document.addEventListener('keydown',event=>{if(!$('sv-overlay')?.classList.contains('show'))return;if(event.key==='Escape')close();if(event.target.closest('input,textarea'))return;if(event.key==='ArrowRight')advance();if(event.key==='ArrowLeft')advance(-1);});
  document.addEventListener('visibilitychange',()=>{last=0;});
  return {open,close,duration};
})();
