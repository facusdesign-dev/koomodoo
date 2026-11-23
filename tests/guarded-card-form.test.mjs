import test from 'node:test';
import assert from 'node:assert/strict';
import {guardedCardTest} from '../supabase/functions/_shared/guarded-card-test.mjs';

test('two form submissions share a claim; only one payment POST leaves the adapter',async()=>{
  let state='ready',posts=0;
  const config={order:'order',cardToken:'fixture',method:'visa',email:'buyer@example.com',token:'TEST-fixture',seller:'1',
    claim:async()=>{if(state!=='ready')return {send:false,state};state='processing';return {send:true,attempt:'first',seller:'1',currency:'UYU',amountCents:10000};},
    finish:async()=>{state='approved';return true;},
    request:async(url,opt)=>{
      if(url.endsWith('/users/me'))return Response.json({id:1,tags:['test_user'],site_id:'MLU'});
      if(opt.method==='POST'){posts++;assert.equal(opt.headers['X-Idempotency-Key'],'first');return Response.json({id:7});}
      return Response.json({id:7,collector_id:1,currency_id:'UYU',transaction_amount:100,live_mode:false,external_reference:'KMD-CARD-first',status:'approved',status_detail:'accredited',transaction_amount_refunded:0});
    }};
  const both=await Promise.all([guardedCardTest(config),guardedCardTest(config)]);
  assert.deepEqual(both.map(x=>x.state).sort(),['approved','processing']);
  assert.equal((await guardedCardTest(config)).state,'approved');
  assert.equal(posts,1);
});
