import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../ensayo-tarjeta.js',import.meta.url),'utf8');
test('confirmed refusal offers retry or cancel; uncertainty and closure never expose payment',async()=>{
  const els=new Map(), calls=[];
  let state='rejected',tick;
  const element=key=>{if(!els.has(key))els.set(key,{});return els.get(key);};
  const client={auth:{getSession:async()=>({data:{session:{}}})},
    functions:{invoke:async()=>({data:{state,previous:'attempt-1',order:'qa',amount:100}})},
    rpc:async(name,args)=>{calls.push([name,args.p_order]);state='closed';return {};}};
  const context={window:{supabase:{createClient:()=>client}},URLSearchParams,location:{search:'?pedido=qa'},
    document:{querySelector:element},confirm:()=>true,setInterval:fn=>{tick=fn;},
    MercadoPago:class{bricks(){return {create:async()=>({unmount:async()=>{}})};}}};
  await vm.runInNewContext('(async()=>{'+source+'})()',context);
  assert.equal(element('#rejection-actions').hidden,false);
  assert.equal(element('#card').hidden,true);
  await element('#retry').onclick();
  assert.equal(element('#card').hidden,false);
  await element('#cancel').onclick();
  assert.deepEqual(calls,[['cancel_order','qa']]);
  for (state of ['closed','processing','closed_pending','review','approved','unknown']){
    await tick(); await new Promise(resolve=>setImmediate(resolve));
    assert.equal(element('#rejection-actions').hidden,true,state);
    assert.equal(element('#card').hidden,true,state);
  }
});
