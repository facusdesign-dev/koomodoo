import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareSandbox } from '../scripts/mp-sandbox.mjs';
function fixture(user,pref={}) {
  const seen=[];
  const request=async(path,options)=>{seen.push({path,options});return {ok:true,json:async()=>seen.length===1?user:{collector_id:12,client_id:42,marketplace_fee:5,sandbox_init_point:'https://sandbox.mercadopago.com.uy/checkout/test',...pref}}};
  return {seen,run:()=>prepareSandbox({token:'mock',seller:'12',app:'42',request})};
}
const seller={id:12,tags:['test_user'],site_id:'MLU'};
test('No crea preferencias para cuentas reales',async()=>{const f=fixture({...seller,tags:[]});await assert.rejects(f.run);assert.equal(f.seen.length,1)});
test('Solo devuelve checkout ficticio con comisión',async()=>{const f=fixture(seller);assert.match(await f.run(),/^https:\/\/sandbox\./);assert.equal(JSON.parse(f.seen[1].options.body).marketplace_fee,5)});
test('Rechaza URL de producción y aplicación incorrecta',async()=>{await assert.rejects(fixture(seller,{sandbox_init_point:'https://www.mercadopago.com.uy'}).run);await assert.rejects(fixture(seller,{client_id:99}).run)});
