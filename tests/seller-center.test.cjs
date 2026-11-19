const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function setup(rows,user='seller'){
  function element(){return {children:[],textContent:'',append(...nodes){this.children.push(...nodes)},replaceChildren(...nodes){this.children=nodes;this.textContent=''}};}
  const root=element(),calls=[];
  const query={select(){return this},eq(key,id){calls.push([key,id]);return this},order(){return this},range:async()=>({data:rows})};
  const ctx={window:{},document:{getElementById:()=>root,createElement:element},KMD:{session:user?{user:{id:user}}:null},getSB:()=>({from(t){calls.push(t);return query}}),currentPage:'analytics',CommerceUI:{money:String,orderDisplayState:()=>({text:'Estado'})}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../seller-center.js'),'utf8'),ctx);
  return {panel:ctx.window.SellerCenter,root,calls};
}
test('Los pedidos se consultan por vendedor; una reserva no indica despachar',async()=>{
 const {panel,root,calls}=setup([{id:'test-order',status:'pending_payment',total:10}]);await panel.show();assert.deepEqual(calls,['orders',['seller_id','seller']]);assert.match(JSON.stringify(root.children),/No despaches/);
});
test('El catálogo consulta solo al propietario y pagina',async()=>{
 const {panel,root,calls}=setup(Array.from({length:21},(_,i)=>({id:i,title:'Producto '+i})));await panel.show('products');assert.deepEqual(calls,['products',['user_id','seller']]);assert.match(JSON.stringify(root.children),/Siguiente/);assert.doesNotMatch(JSON.stringify(root.children),/Producto 20/);
});
test('Sin sesión no se consulta contenido privado',async()=>{
 const {panel,root,calls}=setup([],null);await panel.show();assert.equal(calls.length,0);assert.match(root.textContent,/sesión/);
});
