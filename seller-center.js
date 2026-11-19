window.SellerCenter = (() => {
  let version=0;
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
    card.append(node('h3','Pedido #'+order.id.slice(0,8)),node('p',state.text+' · '+CommerceUI.money(order.total,order.currency)));
    for(const item of order.order_items||[])card.append(node('p',item.product_title+' · '+item.variant_label+' × '+item.quantity));
    card.append(node('p',hint),action('Conversar con el comprador',()=>openChatWith(order.buyer_id)));
    if(order.status==='pending_payment')card.append(action('Gestionar reserva en Pedidos',()=>nav('pedidos')));
    return card;
  }
  async function show(tab='orders',page=0){
    const id=KMD.session?.user?.id,token=++version,root=box();
    root.replaceChildren();
    if(!id){root.textContent='Iniciá sesión para gestionar tu local.';return;}
    const catalog=tab==='products',title=catalog?'Mi catálogo':'Pedidos recibidos';
    root.textContent='Cargando '+title.toLowerCase()+'…';
    try{
      const query=catalog?getSB().from('products').select('id,title,stock,available_stock').eq('user_id',id):
        getSB().from('orders').select('id,buyer_id,total,currency,status,expires_at,order_items(product_title,variant_label,quantity)').eq('seller_id',id);
      const {data,error}=await query.order('created_at',{ascending:false}).order('id',{ascending:false}).range(page*limit,(page+1)*limit);
      if(token!==version||id!==KMD.session?.user?.id||currentPage!=='analytics')return;
      if(error)throw error;
      root.replaceChildren(node('h2',title),action('Actualizar',()=>show(tab,page)));
      if(!data.length)root.append(node('p',catalog?'Todavía no publicaste productos.':'Todavía no recibiste pedidos.'));
      for(const row of data.slice(0,limit)){
        if(!catalog){root.append(orderCard(row));continue;}
        const card=node('article','');card.className='chart-card';card.append(node('h3',row.title),node('p','En tienda: '+row.stock+' · Disponible: '+row.available_stock),action('Editar publicación',()=>ProductEditor.open(row.id)));root.append(card);
      }
      if(page)root.append(action('Anterior',()=>show(tab,page-1)));
      if(data.length>limit)root.append(action('Siguiente',()=>show(tab,page+1)));
    }catch(error){if(token!==version||id!==KMD.session?.user?.id)return;console.error('[KMD centro de ventas]',error);root.replaceChildren(node('p','No pudimos cargar esta sección.'),action('Reintentar',()=>show(tab,page)));}
  }
  return {show,clear};
})();
