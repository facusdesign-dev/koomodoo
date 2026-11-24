window.Delivery=(()=>{
  const modes={pickup:'Retiro en el local',local:'Reparto del local',agency:'Envío por agencia'};
  const departments='Artigas|Canelones|Cerro Largo|Colonia|Durazno|Flores|Florida|Lavalleja|Maldonado|Montevideo|Paysandú|Río Negro|Rivera|Rocha|Salto|San José|Soriano|Tacuarembó|Treinta y Tres'.split('|');
  function el(tag,text){const e=document.createElement(tag);if(text)e.textContent=text;return e;}
  function field(parent,label,values){
    const l=el('label',label),i=el(values?'select':'input');i.className='fi';
    if(values)for(const [v,t] of values)i.add(new Option(t,v));
    l.append(i);parent.append(l);return i;
  }
  const pairs=a=>a.map(x=>[x,x]);
  function button(parent,label,fn){const b=el('button',label);b.className='btn-p btn-sec';b.type='button';b.onclick=fn;parent.append(b);return b;}
  async function settings(){
    const root=document.getElementById('seller-work'),panel=el('section');root.replaceChildren(panel);panel.className='chart-card';
    const uid=KMD.session?.user?.id;if(!uid)return;
    panel.append(el('h2','Entregas de mi local'),el('p','Estas condiciones se aplican a todos tus productos. El comprador elige entre las opciones de su departamento y moneda. En el piloto no se envían paquetes.'));
    const db=getSB(),list=el('div');panel.append(list);
    async function load(){const {data,error}=await db.from('shop_delivery').select('*').eq('seller_id',uid).order('label');if(error)throw error;
      list.replaceChildren();for(const r of data){const line=el('p',modes[r.mode]+' · '+r.label+' · '+r.zone+' · '+CommerceUI.money(r.fee,r.currency)+' · '+r.eta+' · '+(r.enabled?'Activa':'Inactiva'));
        button(line,r.enabled?'Desactivar':'Activar',async e=>{e.target.disabled=true;try{const {error}=await db.from('shop_delivery').update({enabled:!r.enabled}).eq('id',r.id);if(error)throw error;await load();}catch(err){toast(err.message);e.target.disabled=false;}});list.append(line);}}
    const form=el('form');panel.append(form);
    const mode=field(form,'Modalidad',Object.entries(modes)),zone=field(form,'Departamento',pairs(departments)),label=field(form,'Punto de retiro, zona o agencia y tipo de entrega');
    const period=field(form,'Plazo estimado',[['','Elegí un plazo'],...pairs(['En el día','1 a 2 días hábiles','3 a 5 días hábiles','5 a 10 días hábiles','Otro plazo u horario'])]),eta=field(form,'Indicá el plazo u horario');
    const currency=field(form,'Moneda',pairs(['UYU','USD'])),priceType=field(form,'Costo para el comprador',[['','Elegí una opción'],['free','Gratis'],['fixed','Precio fijo']]),fee=field(form,'Precio de la entrega');
    function updateFields(){eta.disabled=period.value!=='Otro plazo u horario';fee.disabled=priceType.value!=='fixed';eta.parentElement.hidden=eta.disabled;fee.parentElement.hidden=fee.disabled;}
    period.onchange=priceType.onchange=updateFields;updateFields();
    label.placeholder='Ej.: DAC a sucursal';label.maxLength=eta.maxLength=100;fee.type='number';fee.min='0.01';fee.step='0.01';for(const i of [label,period,priceType,eta,fee])i.required=true;
    const save=el('button','Agregar opción');save.className='btn-p';form.append(save);
    form.onsubmit=async e=>{e.preventDefault();save.disabled=true;try{const {error}=await db.from('shop_delivery').insert({seller_id:uid,mode:mode.value,zone:zone.value,label:label.value.trim(),eta:eta.disabled?period.value:eta.value.trim(),currency:currency.value,fee:priceType.value==='free'?0:Number(fee.value)});if(error)throw error;form.reset();updateFields();await load();toast('Opción guardada.');}catch(err){toast(err.message);}finally{save.disabled=false;}};
    try{await load();}catch(err){list.textContent=err.message;}
  }
  async function choose(section,rows,info,btn,submit){
    btn.disabled=true;
    const {sellerId,currency}=rows[0],subtotal=rows.reduce((n,i)=>n+i.price*i.qty,0);
    try{const {data,error}=await getSB().from('shop_delivery').select('*').eq('seller_id',sellerId).eq('currency',currency).eq('enabled',true).order('label');if(error)throw error;
      if(!data.length){
        const configured=await getSB().rpc('has_shop_delivery',{p_seller:sellerId});if(configured.error)throw configured.error;
        if(configured.data)info.textContent='No hay modalidades activas para esta moneda. Consultá al local.';
        else btn.disabled=false;
        return;
      }
      const form=el('div');section.insertBefore(form,info);
      const zone=field(form,'Departamento de entrega o retiro',[['','Elegí un departamento'],...pairs(departments)]),method=field(form,'Forma de entrega',[]),address=field(form,'Dirección o sucursal de destino');address.maxLength=200;
      const selected=()=>data.find(r=>r.id===method.value);
      function draw(){const r=selected();address.parentElement.hidden=!r||r.mode==='pickup';btn.disabled=!r||(r.mode!=='pickup'&&address.value.trim().length<3);
        info.textContent=r?'Productos: '+CommerceUI.money(subtotal,currency)+' · Entrega: '+CommerceUI.money(r.fee,currency)+' · Total: '+CommerceUI.money(subtotal+Number(r.fee),currency)+' · '+r.eta:'Seleccioná una modalidad disponible antes de reservar.';}
      zone.onchange=()=>{method.replaceChildren(new Option('Elegí una opción',''));address.value='';
        for(const r of data.filter(r=>r.zone===zone.value))method.add(new Option(modes[r.mode]+' · '+r.label+' · '+CommerceUI.money(r.fee,currency),r.id));
        draw();if(zone.value&&method.options.length===1)info.textContent='El local no ofrece entrega en ese departamento.';};
      method.onchange=draw;address.oninput=draw;zone.onchange();
      btn.onclick=()=>{const r=selected();if(r&&!btn.disabled)submit({id:r.id,mode:r.mode,fee:r.fee,label:r.label,zone:r.zone,eta:r.eta,destination:r.mode==='pickup'?'':address.value.trim()});};
    }catch{info.textContent='No se pudieron cargar las tarifas. Volvé a abrir el carrito.';}
  }
  function summary(parent,o){const d=o.delivery;if(!d)return;
    parent.append(el('p',modes[d.mode]+' · '+d.label+' · '+d.zone+' · '+d.eta),el('p','Productos: '+CommerceUI.money(d.subtotal,o.currency)+' · Entrega: '+CommerceUI.money(d.fee,o.currency)));
    if(d.destination)parent.append(el('p','Destino: '+d.destination));if(o.tracking_code)parent.append(el('p','Guía: '+o.tracking_code));
  }
  function shipment(parent,o,refresh){
    summary(parent,o);if(!o.delivery||o.delivery.mode==='pickup')return false;
    if(o.status!=='paid'||!o.is_payment_test||o.test_payment_state!=='approved')return true;
    const agency=o.delivery.mode==='agency',seller=KMD.session.user.id===o.seller_id;
    parent.append(el('p','Ensayo sin envío físico · '+(o.shipment_received_at?'Recibido':o.shipped_at?(agency?'Enviado':'En reparto'):'En preparación')));
    if(o.shipment_received_at||seller===Boolean(o.shipped_at))return true;
    const guide=seller&&agency?field(parent,'Guía de ensayo'):null;
    button(parent,seller?(agency?'Marcar enviado por agencia':'Marcar en reparto'):'Confirmar recepción de ensayo',async e=>{
      if(guide&&!guide.value.trim()){toast('Ingresá una guía de ensayo.');return;}const b=e.currentTarget;b.disabled=true;
      try{const {error}=await getSB().rpc('advance_test_shipment',{p_order:o.id,p_step:seller?'ship':'receive',p_tracking:guide?.value.trim()||''});if(error)throw error;await refresh();}catch(err){toast(err.message);b.disabled=false;}});
    return true;
  }
  return {settings,choose,shipment};
})();
