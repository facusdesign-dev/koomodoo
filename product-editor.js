window.ProductEditor = (() => {
  const formats={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'};
  function field(form,label,value,type='text'){
    const wrap=document.createElement('label');wrap.className='catalog-field';wrap.textContent=label;
    const el=document.createElement(type==='textarea'?'textarea':type==='select'?'select':'input');el.className='fi';if(el.tagName==='INPUT')el.type=type;el.value=value??'';wrap.append(el);form.append(wrap);return el;
  }
  function action(text,handler,parent){const button=document.createElement('button');button.type='button';button.className='btn-p btn-sec';button.textContent=text;button.onclick=handler;parent.append(button);return button;}
  async function open(id){
    document.getElementById('commerce-detail')?.remove();document.getElementById('publication-editor')?.remove();
    const overlay=document.createElement('div');overlay.id='publication-editor';overlay.className='community-overlay';
    const panel=document.createElement('section');panel.className='publication-editor';panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label','Editar publicación completa');
    const title=document.createElement('h2');title.textContent='Editar publicación';panel.append(title);
    let saving=false,photos=[];
    const close=()=>{if(saving)return;for(const photo of photos)if(photo.file)URL.revokeObjectURL(photo.url);overlay.remove();};
    action('Cerrar',close,panel);overlay.onclick=event=>{if(event.target===overlay)close();};overlay.append(panel);document.body.append(overlay);
    const status=document.createElement('p');status.setAttribute('role','status');status.textContent='Cargando publicación...';panel.append(status);
    try{
      const {product,variants:original}=await CommerceModule.getProductDetails(id);
      if(!overlay.isConnected)return;
      if(product.user_id!==KMD.session?.user?.id)throw new Error('Solo el propietario puede editar.');
      status.textContent='Los pedidos anteriores conservan sus datos. No se eliminan variantes con pedidos o reservas.';
      const form=document.createElement('form');form.className='publication-form';panel.append(form);
      const name=field(form,'Título',product.title);name.required=true;name.minLength=3;name.maxLength=120;
      const description=field(form,'Descripción',product.description,'textarea');description.maxLength=4000;description.rows=4;
      const root=field(form,'Categoría',product.category,'select');Catalog.options(root,Catalog.categories,product.category);
      const sub=field(form,'Tipo de producto',null,'select');
      const condition=field(form,'Condicion',product.condition,'select');Catalog.options(condition,['Nuevo','Usado','Reacondicionado'].map(id=>({id,name:id})),product.condition);
      const currency=field(form,'Moneda',product.currency,'select');Catalog.options(currency,['UYU','ARS','USD','BRL','CLP','EUR'].map(id=>({id,name:id})),product.currency);
      const details=document.createElement('div');details.className='catalog-fields';form.append(details);
      const axes=document.createElement('div');axes.className='catalog-fields';form.append(axes);
      const renderCategory=(initial=false)=>{
        const c=Catalog.config(root.value,initial?product.variants?.subcategory:sub.value);
        Catalog.options(sub,c.category.children,c.sub.id);
        Catalog.renderFields(details,c.details,initial?product.variants?.details||{}:{});
        Catalog.renderFields(axes,c.axes,initial?product.variants?.axisValues||{}:{});
      };
      root.onchange=()=>{Catalog.options(sub,Catalog.config(root.value).category.children);renderCategory();drawVariants();};sub.onchange=()=>{renderCategory();drawVariants();};renderCategory(true);
      const heading=document.createElement('h3');heading.textContent='Fotos (1 a 8; recomendamos al menos 3)';form.append(heading);
      const gallery=document.createElement('div');gallery.className='editor-gallery';form.append(gallery);
      photos=[...new Set([...(product.media_urls||[]),...(!product.media_urls?.length&&product.image_url?[product.image_url]:[])])].map(url=>({url}));
      function drawPhotos(){gallery.replaceChildren();photos.forEach((photo,index)=>{
        const card=document.createElement('div'),image=document.createElement('img');image.src=photo.url;image.alt=`Foto ${index+1}`;card.append(image);
        const text=document.createElement('small');text.textContent=index===0?'Portada':`Foto ${index+1}`;card.append(text);
        action('Portada',()=>{photos.unshift(photos.splice(index,1)[0]);drawPhotos();},card);
        action('Quitar',()=>{const removed=photos.splice(index,1)[0];if(removed.file)URL.revokeObjectURL(removed.url);drawPhotos();},card);gallery.append(card);
      });}drawPhotos();
      const files=field(form,'Agregar fotos',null,'file');files.accept='image/jpeg,image/png,image/webp';files.multiple=true;
      files.onchange=()=>{for(const file of files.files){if(photos.length>=8){status.textContent='Máximo 8 fotos.';break;}if(!formats[file.type]||file.size>10485760){status.textContent='Usá JPG, PNG o WEBP de hasta 10 MB por foto.';continue;}photos.push({file,url:URL.createObjectURL(file)});}files.value='';drawPhotos();};
      const base=field(form,'Precio base para nuevas variantes',product.price,'number');base.min='0.01';base.step='0.01';
      let rows=original.map(row=>({...row,attributes:{...row.attributes}}));
      const list=document.createElement('div');list.className='editor-variants';
      function drawVariants(){list.replaceChildren();rows.forEach((row,index)=>{
        const box=document.createElement('fieldset');const legend=document.createElement('legend');legend.textContent=`Variante ${index+1}`;box.append(legend);
        for(const [key,label,type] of [['label','Nombre / combinación','text'],['sku','SKU / código','text'],['price','Precio','number'],['stock','Stock disponible','number']]){
          const el=field(box,label,row[key],type);el.required=key!=='sku';if(type==='number'){el.min=key==='price'?'0.01':'0';el.step=key==='price'?'0.01':'1';}el.oninput=()=>{row[key]=type==='number'?Number(el.value):el.value;};
        }
        for(const axis of Catalog.config(root.value,sub.value).axes){
          const el=field(box,axis.label+' de esta variante',row.attributes?.[axis.key]||'');el.maxLength=200;
          el.oninput=()=>{row.attributes={...row.attributes,[axis.key]:el.value.trim()};};
        }
        action('Quitar variante',()=>{rows.splice(index,1);drawVariants();},box);list.append(box);
      });}drawVariants();
      action('Generar combinaciones de esta categoría',()=>{try{
        const current=new Map(rows.map(row=>[row.label,row]));
        rows=Catalog.combinations(Catalog.axes(axes,root.value,sub.value),base.value,0).map(row=>current.get(row.label)||original.find(old=>old.label===row.label)||row);drawVariants();
      }catch(error){status.textContent=error.message;}},form);
      action('Agregar variante manual',()=>{if(rows.length>=100){status.textContent='Máximo 100 variantes.';return;}rows.push({label:`Variante ${rows.length+1}`,price:Number(base.value),stock:0,attributes:{}});drawVariants();},form);
      action('Aplicar precio base a todas',()=>{rows.forEach(row=>{row.price=Number(base.value);});drawVariants();},form);form.append(list);
      const save=document.createElement('button');save.type='submit';save.className='pub-btn';save.textContent='Guardar publicación completa';form.append(save);
      form.onsubmit=async event=>{
        event.preventDefault();if(saving||!form.reportValidity())return;
        if(!photos.length||!rows.length){status.textContent='Carga al menos una foto y una variante.';return;}
        saving=true;save.textContent='Guardando...';for(const control of form.querySelectorAll('input,textarea,select,button'))control.disabled=true;
        const uploaded=[];let committed=false;
        try{
          const urls=[];
          for(const photo of photos){
            if(!photo.file){urls.push(photo.url);continue;}
            const path=`products/${product.user_id}/${crypto.randomUUID()}.${formats[photo.file.type]}`;
            const result=await getSB().storage.from('product-media').upload(path,photo.file,{upsert:false,contentType:photo.file.type});if(result.error)throw result.error;uploaded.push(path);
            urls.push(getSB().storage.from('product-media').getPublicUrl(path).data.publicUrl);
          }
          const removed=original.filter(old=>!rows.some(row=>row.id===old.id)).map(({id,revision})=>({id,revision}));
          await CommerceModule.savePublication(product,{title:name.value.trim(),description:description.value,category:root.value,currency:currency.value,condition:condition.value,media_urls:urls,variants:{...product.variants,subcategory:sub.value,categoryPath:[Catalog.config(root.value,sub.value).category.name,Catalog.config(root.value,sub.value).sub.name],details:Catalog.values(details),axisValues:Catalog.values(axes)}},rows,removed);
          committed=true;
          try{await CommerceUI.refreshCatalog();if(currentPage==='perfil')setPTab(0);else if(currentPage==='marketplace')renderProdGrid();else if(currentPage==='home')renderHome();}catch(error){console.error('[KMD edit refresh]',error);}
          saving=false;close();toast('Publicación actualizada con fotos, detalles y variantes.');
        }catch(error){console.error('[KMD full edit]',error);status.textContent=error.message||'No pudimos guardar los cambios.';
          if(!committed&&uploaded.length)await getSB().storage.from('product-media').remove(uploaded).catch(console.error);
        }finally{saving=false;save.textContent='Guardar publicación completa';for(const control of form.querySelectorAll('input,textarea,select,button'))control.disabled=false;}
      };
    }catch(error){status.textContent=error.message;console.error('[KMD editor]',error);}
  }
  return {open};
})();
