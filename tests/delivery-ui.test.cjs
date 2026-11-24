const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
test('local and agency quotes filter by department, require destination and update total',async()=>{
  class Elem{
    constructor(){this.children=[];this.options=[];this.value='';}
    append(...nodes){for(const n of nodes){n.parentElement=this;this.children.push(n);}}
    add(o){this.options.push(o);if(this.options.length===1)this.value=o.value;}
    replaceChildren(o){this.options=[];this.add(o);}
    insertBefore(n){this.append(n);}
  }
  const options=['pickup','local','agency'].map((mode,id)=>({id:String(id),zone:'Montevideo',mode,label:mode,eta:'24 h',fee:id?30:0}));
  const query={select(){return this;},eq(){return this;},order(){return {data:options};}};
  const ctx={window:{},document:{createElement:()=>new Elem()},Option:class{constructor(text,value){Object.assign(this,{text,value});}},getSB:()=>({from:()=>query}),CommerceUI:{money:n=>'$'+n}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../delivery.js'),'utf8'),ctx);
  const root=new Elem(),note=new Elem(),b=new Elem();let chosen;
  await ctx.window.Delivery.choose(root,[{sellerId:'s',price:70,qty:1,currency:'UYU'}],note,b,d=>chosen=d);
  const [zone,method,address]=root.children[0].children.map(l=>l.children[0]);
  zone.value='Salto';zone.onchange();assert.equal(method.options.length,1);assert.equal(b.disabled,true);
  zone.value='Montevideo';zone.onchange();assert.equal(method.options.length,4);
  for(const r of options){method.value=r.id;address.value='';method.onchange();
    assert.equal(b.disabled,r.mode!=='pickup');assert.match(note.textContent,r.fee?/Total: \$100/:/Total: \$70/);
    if(r.fee){address.value='Destino de prueba';address.oninput();}
    b.onclick();assert.equal(chosen.mode,r.mode);assert.equal(chosen.fee,r.fee);
  }
});
