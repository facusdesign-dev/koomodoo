const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function setup(rows,user='seller'){
  function element(){return {children:[],style:{},setAttribute(k,v){this[k]=v},textContent:'',append(...nodes){this.children.push(...nodes)},replaceChildren(...nodes){this.children=nodes;this.textContent=''}};}
  const root=element(),calls=[];
  const query={select(){return this},eq(key,id){calls.push([key,id]);return this},order(){return this},range:async()=>({data:rows})};
  const ctx={window:{},Catalog:{categories:[]},document:{getElementById:()=>root,createElement:element},KMD:{session:user?{user:{id:user}}:null},getSB:()=>({rpc:async(name)=>({data:name==='my_shop_charts'?{months:[{month:'2026-01',sales:0}],ranking:[]}:rows}),from(t){calls.push(t);return query}}),currentPage:'analytics',CommerceUI:{money:String,orderDisplayState:()=>({text:'Estado'})}};
  ctx.setInterval=()=>{};
  vm.runInNewContext(fs.readFileSync(require.resolve('../commerce-ui.js'),'utf8'),ctx);
  ctx.CommerceUI.appendPickup=ctx.window.CommerceUI.appendPickup;
  vm.runInNewContext(fs.readFileSync(require.resolve('../seller-center.js'),'utf8'),ctx);
  return {panel:ctx.window.SellerCenter,root,calls};
}
test('Los pedidos se consultan por vendedor; una reserva no indica despachar',async()=>{
 const {panel,root,calls}=setup([{id:'test-order',status:'pending_payment',total:10}]);await panel.show();assert.deepEqual(calls,['orders',['seller_id','seller']]);assert.match(JSON.stringify(root.children),/No despaches/);
});
test('El catálogo consulta solo al propietario y pagina',async()=>{
 const {panel,root,calls}=setup(Array.from({length:21},(_,i)=>({id:i,title:'Producto '+i})));await panel.show('products');assert.deepEqual(calls,['products',['user_id','seller']]);assert.match(JSON.stringify(root.children),/Siguiente/);assert.doesNotMatch(JSON.stringify(root.children),/Producto 20/);
});
test('Solo el pedido aprobado de ensayo permite preparar el retiro',async()=>{
 const order={id:'qa',seller_id:'seller',status:'paid',is_payment_test:true,test_payment_state:'approved'};
 for(const [change,allowed] of [[{},true],[{status:'pending_payment'},false],[{is_payment_test:false},false],[{pickup_ready_at:'today'},false]]){
   const {panel,root}=setup([{...order,...change}]);await panel.show();
   assert.equal(JSON.stringify(root.children).includes('Marcar listo para retirar'),allowed);
 }
});
test('Métricas sin ventas y monedas separadas',async()=>{
 const empty=setup([]);await empty.panel.show('metrics');assert.equal(empty.root.children.filter(card=>card.children?.[1]?.textContent==='0').length,3);
 const paid=setup([{currency:'UYU',sales:1,units:2,gross:150},{currency:'USD',sales:2,units:4,gross:30}]);await paid.panel.show('metrics');assert.match(JSON.stringify(paid.root.children),/UYU 150 · USD 30/);
});
test('Sin sesión no se consulta contenido privado',async()=>{
 const {panel,root,calls}=setup([],null);await panel.show();assert.equal(calls.length,0);assert.match(root.textContent,/sesión/);
});
