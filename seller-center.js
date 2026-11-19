window.SellerCenter = (() => {
  let version=0,layout='grid';
  const limit=20;
  const box=()=>document.getElementById('seller-work');
  function clear(){version++;box()?.replaceChildren();}
  function node(tag,text){const el=document.createElement(tag);el.textContent=text;return el;}
  function action(label,run){const b=node('button',label);b.type='button';b.className='btn-p btn-sec';b.onclick=run;return b;}
  function orderCard(order){
    const card=node('article','');card.className='chart-card';
    const state=CommerceUI.orderDisplayState(order);
    const hint=order.status==='paid'?'Coordiná la entrega con el comprador.':order.status==='pending_payment'?
      (state.overdue?'El plazo terminó. Verificá la reserva en Pedidos.':'Esperá la confirmación de pago. No despaches todavía.'):'No despaches este pedido.';
    card.append(node('small','Pedido #'+order.id.slice(0,8)+(order.created_at?' · '+new Date(order.created_at).toLocaleString('es-UY'):'')),node('h3',state.text),node('p','Total del pedido: '+CommerceUI.money(order.total,order.currency)));
    if(state.deadline)card.append(node('p','Reserva hasta las '+new Date(state.deadline).toLocaleTimeString('es-UY',{hour:'2-digit',minute:'2-digit'})+'.'));
    for(const item of order.order_items||[])card.append(node('p',item.product_title+' · '+item.variant_label+' × '+item.quantity));
    card.append(node('p',hint),action('Conversar con el comprador',()=>openChatWith(order.buyer_id)));
    if(order.status==='pending_payment')card.append(action('Gestionar reserva en Pedidos',()=>nav('pedidos')));
    return card;
  }
  async function show(tab='orders',page=0){
    const id=KMD.session?.user?.id,token=++version,root=box();
    root.replaceChildren();
    if(!id){root.textContent='Iniciá sesión para gestionar tu local.';return;}
    const catalog=tab==='products',title=catalog?'Mi catálogo':tab==='metrics'?'Métricas':'Mis pedidos';
    root.textContent='Cargando '+title.toLowerCase()+'…';
    try{
      if(tab==='metrics'){
        const {data,error}=await getSB().rpc('my_shop_metrics');
        if(version!==token||id!==KMD.session?.user?.id||currentPage!=='analytics')return;
        if(error)throw error;
        root.replaceChildren(node('h2','Ventas de mi local'),node('p','Histórico de pedidos pagados. No incluye reservas ni descuenta comisiones.'),action('Actualizar',()=>show(tab)));
        for(const [label,value] of [['Ventas confirmadas',data.reduce((s,r)=>s+Number(r.sales),0)],['Unidades vendidas',data.reduce((s,r)=>s+Number(r.units),0)],['Importe bruto',data.map(r=>r.currency+' '+CommerceUI.money(r.gross,r.currency)).join(' · ')||'0']]){
          const card=node('article','');card.className='chart-card';card.append(node('p',label),node('h3',String(value)));root.append(card);
        }
        return;
      }
      const query=catalog?getSB().from('products').select('id,title,category,image_url,price,currency,stock,available_stock').eq('user_id',id).order('category'):
        getSB().from('orders').select('id,buyer_id,total,currency,status,created_at,expires_at,order_items(product_title,variant_label,quantity)').eq('seller_id',id);
      const {data,error}=await query.order('created_at',{ascending:false}).order('id',{ascending:false}).range(page*limit,(page+1)*limit);
      if(token!==version||id!==KMD.session?.user?.id||currentPage!=='analytics')return;
      if(error)throw error;
      root.replaceChildren(node('h2',title),action('Actualizar',()=>show(tab,page)));
      if(!data.length)root.append(node('p',catalog?'Todavía no publicaste productos.':'Cuando alguien haga un pedido en tu local, acá vas a ver qué compró, el estado del pago y tu próximo paso.'));
      if(catalog&&data.length){
        const controls=node('div',''),groups=node('div','');root.append(controls,groups);
        const views=['grid','list'].map((mode,i)=>action(['Cuadros','Lista'][i],()=>{layout=mode;draw();}));controls.append(...views);
        function draw(){
          views.forEach((b,i)=>b.disabled=layout===['grid','list'][i]);groups.replaceChildren();
          const sections=new Map();
          for(const row of data.slice(0,limit)){
            const category=row.category||'otros';
            if(!sections.has(category)){
              groups.append(node('h3',(Catalog.categories.find(c=>c.id===category)?.name||category)));
              const wrap=node('div','');wrap.className='shop-products '+layout;groups.append(wrap);sections.set(category,wrap);
            }
            const card=node('article','');card.className='chart-card';
            if(row.image_url){const img=node('img','');img.src=row.image_url;img.alt='';img.loading='lazy';card.append(img);}
            card.append(node('h4',row.title),node('p',CommerceUI.money(row.price,row.currency)),node('small','En tienda: '+row.stock+' · Disponible: '+row.available_stock),action('Editar publicación',()=>ProductEditor.open(row.id)));sections.get(category).append(card);
          }
        }
        draw();
      }else for(const row of data.slice(0,limit))root.append(orderCard(row));
      if(page)root.append(action('Anterior',()=>show(tab,page-1)));
      if(data.length>limit)root.append(action('Siguiente',()=>show(tab,page+1)));
    }catch(error){if(token!==version||id!==KMD.session?.user?.id)return;console.error('[KMD centro de ventas]',error);root.replaceChildren(node('p','No pudimos cargar esta sección.'),action('Reintentar',()=>show(tab,page)));}
  }
  return {show,clear};
})();
