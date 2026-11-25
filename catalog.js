window.Catalog = (() => {
  const field=(key,label,hint='')=>({key,label,hint});
  const color=field('color','Color','Negro, Blanco, Azul'),size=field('size','Talle / tamano','S, M, L'),material=field('material','Material','Algodon, Cuero, Acero');
  const families={
    apparel:{axes:[color,size],details:[material,field('brand','Marca'),field('fit','Calce'),field('gender','Publico / genero')]},
    shoes:{axes:[color,field('size','Número de calzado','35, 36, 37')],details:[material,field('brand','Marca'),field('sole','Tipo de suela')]},
    bags:{axes:[color,field('dimensions','Medidas / capacidad')],details:[material,field('brand','Marca'),field('closure','Tipo de cierre'),field('pockets','Bolsillos')]},
    phone:{axes:[color,field('capacity','Almacenamiento','128 GB, 256 GB')],details:[field('brand','Marca'),field('model','Modelo'),field('ram','Memoria RAM'),field('network','Red / conectividad'),field('warranty','Garantia')]},
    computer:{axes:[field('capacity','Disco / almacenamiento','512 GB, 1 TB'),field('ram','RAM','8 GB, 16 GB')],details:[field('brand','Marca'),field('model','Modelo'),field('processor','Procesador'),field('screen','Pantalla'),field('os','Sistema operativo'),field('warranty','Garantia')]},
    electronics:{axes:[color,field('version','Version / capacidad')],details:[field('brand','Marca'),field('model','Modelo'),field('compatibility','Compatibilidad'),field('power','Potencia / alimentacion'),field('warranty','Garantia')]},
    furniture:{axes:[color,field('dimensions','Medida','120 x 60 cm, 160 x 80 cm')],details:[material,field('brand','Marca'),field('assembly','Armado'),field('style','Estilo')]},
    textiles:{axes:[color,field('dimensions','Medidas','1 plaza, 2 plazas, King')],details:[material,field('brand','Marca'),field('care','Lavado / cuidado')]},
    appliances:{axes:[color,field('capacity','Capacidad','20 L, 30 L')],details:[field('brand','Marca'),field('model','Modelo'),field('power','Potencia'),field('efficiency','Eficiencia energetica'),field('voltage','Voltaje'),field('warranty','Garantia')]},
    kitchen:{axes:[color,field('dimensions','Medida / diametro','20 cm, 24 cm')],details:[material,field('brand','Marca'),field('use','Uso / compatibilidad'),field('pieces','Cantidad de piezas')]},
    sports:{axes:[color,size],details:[field('brand','Marca'),material,field('sport','Disciplina'),field('weight','Peso')]},
    bike:{axes:[color,field('size','Rodado / cuadro','26, 27.5, 29')],details:[field('brand','Marca'),field('model','Modelo'),material,field('gears','Cambios / velocidades')]},
    beauty:{axes:[field('tone','Tono / aroma'),field('volume','Contenido','50 ml, 100 ml')],details:[field('brand','Marca'),field('skin','Tipo de piel / cabello'),field('ingredients','Ingredientes'),field('expiry','Vencimiento / lote')]},
    jewelry:{axes:[material,field('size','Medida / talle')],details:[field('brand','Marca'),field('purity','Pureza / ley'),field('stone','Piedra'),field('finish','Terminacion')]},
    petfood:{axes:[field('flavor','Sabor','Pollo, Carne'),field('weight','Presentacion / peso','3 kg, 15 kg, 22 kg')],details:[field('brand','Marca'),field('species','Especie'),field('stage','Etapa de vida'),field('formula','Formula'),field('expiry','Vencimiento / lote')]},
    pets:{axes:[color,field('size','Talle / medida','S, M, L')],details:[field('brand','Marca'),field('species','Especie'),material,field('use','Uso')]},
    food:{axes:[field('flavor','Sabor / variedad'),field('weight','Peso / presentacion')],details:[field('brand','Marca / productor'),field('ingredients','Ingredientes / alergenos'),field('expiry','Vencimiento / lote'),field('storage','Conservacion')]},
    tools:{axes:[field('measure','Medida / potencia'),field('kit','Presentacion / kit')],details:[field('brand','Marca'),field('model','Modelo'),field('power','Alimentacion'),material,field('warranty','Garantia')]},
    vehicle:{axes:[color,field('model','Version')],details:[field('brand','Marca'),field('year','Ano'),field('mileage','Kilometraje'),field('fuel','Combustible'),field('transmission','Transmision')]},
    parts:{axes:[field('compatibility','Compatibilidad'),field('measure','Medida')],details:[field('brand','Marca'),field('code','Número de pieza / OEM'),field('vehicle','Vehículo compatible'),material]},
    books:{axes:[field('format','Formato','Papel, Tapa dura'),field('language','Idioma')],details:[field('author','Autor'),field('publisher','Editorial'),field('isbn','ISBN'),field('year','Ano de edicion')]},
    toys:{axes:[color,field('version','Modelo / version')],details:[field('brand','Marca'),field('age','Edad recomendada'),material,field('safety','Advertencias de seguridad')]},
    garden:{axes:[field('size','Tamano / medida'),field('variety','Variedad')],details:[field('brand','Marca / productor'),material,field('care','Cuidados'),field('use','Uso')]},
    general:{axes:[color,field('size','Tamano / presentacion')],details:[field('brand','Marca'),field('model','Modelo'),material,field('details','Especificaciones')]}
  };
  const categories=[
    ['tecnologia','Tecnologia',[['celulares','Celulares y accesorios','phone'],['computadoras','Computadoras y notebooks','computer'],['tablets','Tablets y lectores','phone'],['audio','Audio y auriculares','electronics'],['gaming','Consolas y videojuegos','electronics'],['foto','Camaras y fotografia','electronics'],['redes','Redes y conectividad','electronics']]],
    ['moda','Moda',[['ropa','Ropa','apparel'],['calzado','Calzado','shoes'],['bolsos','Bolsos y mochilas','bags'],['accesorios','Accesorios','apparel']]],
    ['hogar','Hogar y muebles',[['muebles','Muebles','furniture'],['textiles','Ropa de cama y textiles','textiles'],['decoracion','Decoracion','furniture'],['iluminacion','Iluminacion','electronics'],['organizacion','Organizacion','furniture']]],
    ['electrodomesticos','Electrodomesticos',[['coccion','Cocinas y hornos','appliances'],['frio','Heladeras y freezers','appliances'],['lavado','Lavado y limpieza','appliances'],['clima','Climatizacion','appliances'],['pequenos','Pequenos electrodomesticos','appliances']]],
    ['cocina','Cocina y bazar',[['utensilios','Utensilios y ollas','kitchen'],['vajilla','Vajilla','kitchen'],['termos','Termos y mates','kitchen'],['reposteria','Reposteria','kitchen']]],
    ['deportes','Deportes y fitness',[['ropa','Indumentaria deportiva','apparel'],['calzado','Calzado deportivo','shoes'],['fitness','Fitness y gimnasio','sports'],['bicicletas','Bicicletas','bike'],['camping','Camping y aire libre','sports'],['equipo','Equipamiento deportivo','sports']]],
    ['belleza','Belleza y cuidado personal',[['maquillaje','Maquillaje','beauty'],['cabello','Cuidado del cabello','beauty'],['piel','Cuidado de la piel','beauty'],['perfumes','Perfumes','beauty'],['aparatos','Aparatos de cuidado personal','electronics']]],
    ['joyeria','Joyeria y relojes',[['anillos','Anillos','jewelry'],['cadenas','Collares y pulseras','jewelry'],['aros','Aros','jewelry'],['relojes','Relojes','electronics']]],
    ['mascotas','Mascotas',[['alimentos','Alimentos','petfood'],['collares','Collares y correas','pets'],['camas','Camas y transportadoras','pets'],['juguetes','Juguetes y accesorios','pets'],['higiene','Higiene y cuidado','pets']]],
    ['alimentos','Alimentos y bebidas',[['almacen','Almacen','food'],['bebidas','Bebidas sin alcohol','food'],['cafe','Cafe, te e infusiones','food'],['reposteria','Panaderia y reposteria','food'],['frescos','Productos frescos','food']]],
    ['herramientas','Herramientas y construccion',[['electricas','Herramientas electricas','tools'],['manuales','Herramientas manuales','tools'],['materiales','Materiales de construccion','tools'],['seguridad','Seguridad y proteccion','apparel']]],
    ['vehiculos','Vehículos',[['autos','Autos','vehicle'],['motos','Motos','vehicle'],['utilitarios','Utilitarios','vehicle']]],
    ['repuestos','Repuestos y accesorios',[['automotor','Repuestos automotores','parts'],['motos','Repuestos para motos','parts'],['neumaticos','Neumaticos y ruedas','parts'],['accesorios','Accesorios para vehículos','parts']]],
    ['bebes','Bebes y maternidad',[['ropa','Ropa y calzado','apparel'],['paseo','Paseo y transporte','general'],['alimentacion','Alimentacion','kitchen'],['cuidado','Higiene y cuidado','beauty']]],
    ['juguetes','Juguetes y juegos',[['didacticos','Didacticos','toys'],['mesa','Juegos de mesa','toys'],['figuras','Figuras y munecos','toys'],['exterior','Juegos de exterior','toys']]],
    ['libros','Libros y papeleria',[['libros','Libros','books'],['escolar','Escolar y oficina','general'],['arte','Arte y manualidades','general']]],
    ['musica','Instrumentos musicales',[['cuerdas','Instrumentos de cuerda','electronics'],['teclados','Teclados','electronics'],['percusion','Percusion','general'],['accesorios','Accesorios musicales','electronics']]],
    ['jardin','Jardin y exterior',[['plantas','Plantas y semillas','garden'],['macetas','Macetas','garden'],['herramientas','Herramientas de jardin','tools'],['muebles','Muebles de exterior','furniture']]],
    ['salud','Salud y bienestar',[['movilidad','Ayudas para movilidad','general'],['medicion','Equipos de medicion','electronics'],['cuidado','Accesorios de cuidado','general']]],
    ['otros','Otros productos',[['general','Otros','general']]]
  ].map(([id,name,children])=>({id,name,children:children.map(([id,name,family])=>({id,name,family}))}));
  function config(root,leaf){const category=categories.find(c=>c.id===root)||categories[0];const sub=category.children.find(s=>s.id===leaf)||category.children[0];return {category,sub,...families[sub.family]};}
  function input(parent,spec,value=''){
    const label=document.createElement('label');label.className='catalog-field';label.textContent=spec.label;
    const control=document.createElement('input');control.className='fi';control.value=value;control.placeholder=spec.hint;control.maxLength=200;control.dataset.key=spec.key;label.append(control);parent.append(label);return control;
  }
  function renderFields(box,fields,values={}){box.replaceChildren();for(const spec of fields)input(box,spec,values[spec.key]||'');}
  function values(box){return Object.fromEntries([...box.querySelectorAll('input[data-key]')].map(el=>[el.dataset.key,el.value.trim()]));}
  function axes(box,root,leaf){return config(root,leaf).axes.map(spec=>({...spec,values:[...new Set((values(box)[spec.key]||'').split(',').map(s=>s.trim()).filter(Boolean))]})).filter(axis=>axis.values.length);}
  function combinations(list,price,stock=0){
    let rows=[{label:'',attributes:{},price:Number(price),stock:Number(stock)}];
    for(const axis of list){if(rows.length*axis.values.length>100)throw new Error('Máximo 100 combinaciones por publicación.');rows=rows.flatMap(row=>axis.values.map(value=>({...row,label:[row.label,value].filter(Boolean).join(' / '),attributes:{...row.attributes,[axis.key]:value}})));}
    if(rows.some(row=>row.label.length>180))throw new Error('Acortá los nombres de las variantes: máximo 180 caracteres por combinación.');
    return rows.map(row=>({...row,label:row.label||'Unica'}));
  }
  function options(select,list,value){select.replaceChildren();for(const item of list){const option=document.createElement('option');option.value=item.id;option.textContent=item.name;select.append(option);}if(list.some(item=>item.id===value))select.value=value;}
  function publishConfig(){return config(document.getElementById('pub-cat').value,document.getElementById('pub-subcategory').value);}
  function publishAxes(){const c=publishConfig();return axes(document.getElementById('pub-axis-fields'),c.category.id,c.sub.id);}
  function publishMetadata(){const c=publishConfig();return {subcategory:c.sub.id,categoryPath:[c.category.name,c.sub.name],details:values(document.getElementById('pub-detail-fields')),axisValues:values(document.getElementById('pub-axis-fields'))};}
  function change(rootChanged=false){
    const root=document.getElementById('pub-cat'),sub=document.getElementById('pub-subcategory');
    const c=config(root.value,rootChanged?'':sub.value);if(rootChanged)options(sub,c.category.children);
    renderFields(document.getElementById('pub-detail-fields'),c.details);
    renderFields(document.getElementById('pub-axis-fields'),c.axes);
    if(window.CommerceUI)CommerceUI.resetInventory();
  }
  function mount(){
    const root=document.getElementById('pub-cat');if(!root)return;options(root,categories,root.value);
    const block=document.createElement('div');block.id='catalog-publish-fields';block.innerHTML='<label class="catalog-field">Tipo de producto<select id="pub-subcategory" class="fi"></select></label><h3>Detalles de esta categoria</h3><div id="pub-detail-fields" class="catalog-fields"></div><h3>Opciones dentro de la publicacion</h3><p class="catalog-hint">Escribi valores separados por comas. Genera las variantes y asigna stock/precio a cada combinacion.</p><div id="pub-axis-fields" class="catalog-fields"></div>';
    document.getElementById('pub-inventory').parentElement.before(block);
    for(const id of ['pub-colors','pub-sizes','pub-materials','pub-dimensions','pub-weight','pub-extra1','pub-extra2','pub-category-notes'])document.getElementById(id)?.closest('.fg')?.setAttribute('hidden','');
    root.onchange=()=>change(true);document.getElementById('pub-subcategory').onchange=()=>change();change(true);
  }
  return {categories,config,renderFields,values,axes,combinations,options,mount,change,publishAxes,publishMetadata};
})();
