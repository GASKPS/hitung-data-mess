import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import * as cloud from '../dist/cloud.js';
import {reconcile} from '../dist/core.js';

test('built-in Supabase connection restores the session and persists a snapshot through the real REST client',async()=>{
  const dom=new JSDOM('<html><script src="https://example.test/assets/supabase.js"></script></html>',{url:'https://example.test',runScripts:'outside-only'});
  const userId='11111111-1111-4111-8111-111111111111',snapshotId='33333333-3333-4333-8333-333333333333';
  const now=Math.floor(Date.now()/1000);
  const jwt=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({aud:'authenticated',exp:now+3600,iat:now,sub:userId,role:'authenticated',email:'test@example.test'})).toString('base64url')+'.test-signature';
  const user={id:userId,aud:'authenticated',role:'authenticated',email:'test@example.test',app_metadata:{provider:'email'},user_metadata:{},created_at:new Date().toISOString()};
  let inserted;
  const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
  const fakeFetch=async(input,init={})=>{
    const url=String(input);
    assert.equal(new URL(url).origin,cloud.DEFAULT_CONFIG.url);
    assert.equal(new Headers(init.headers).get('apikey'),cloud.DEFAULT_CONFIG.key);
    if(url.includes('/auth/v1/token'))return json({access_token:jwt,refresh_token:'test-refresh',expires_in:3600,token_type:'bearer',user});
    if(url.includes('/auth/v1/logout'))return new Response(null,{status:204});
    if(url.includes('/rest/v1/mess_snapshots')){
      const reqHeaders=new Headers(init.headers);assert.equal(reqHeaders.get('Authorization'),`Bearer ${jwt}`);
      if(init.method==='POST'){
        inserted=JSON.parse(init.body);return json({id:snapshotId,label:inserted.label,created_at:new Date().toISOString()},201);
      }
      return json([{id:snapshotId,label:'Snapshot pengujian',created_at:new Date().toISOString(),counts:{total:1},source_info:{}}]);
    }
    throw new Error('Unexpected request: '+url);
  };
  Object.assign(dom.window,{fetch:fakeFetch,TextEncoder,TextDecoder,Headers,Request,Response});
  Object.defineProperty(dom.window.document,'currentScript',{configurable:true,value:dom.window.document.querySelector('script')});
  dom.window.eval(readFileSync(new URL('../dist/assets/supabase.js',import.meta.url),'utf8'));
  globalThis.supabase=dom.window.supabase;globalThis.localStorage=dom.window.localStorage;
  try{
    localStorage.setItem('mess-insight:supabase:v1',JSON.stringify({url:'https://old-project.supabase.co',key:'sb_publishable_old_project_123456789'}));
    await cloud.connect();
    await assert.rejects(()=>cloud.listSnapshots(),/Masuk ke akun/);
    await cloud.signIn('test@example.test','test-password');assert.equal(cloud.session.user.id,userId);
    const persistedSession=localStorage.getItem('sb-jajtnydqgsmenbsjpllu-auth-token');
    assert.equal(JSON.parse(persistedSession).user.id,userId);
    let restored;
    await cloud.connect(session=>{restored=session;});
    assert.equal(restored.user.id,userId);
    const dataset=reconcile([{nik:'TEST001',name:'Test',location:'Camp'}],[{nik:'TEST001',company:'HJF',department:'Production',subdepartment:'Furnace',grade:'1'}]);
    const saved=await cloud.saveSnapshot(dataset,'Snapshot pengujian');
    assert.equal(saved.id,snapshotId);assert.equal(inserted.user_id,userId);assert.equal(inserted.counts.total,1);assert.equal(inserted.mess[0].nik,'TEST001');assert.equal(inserted.manpower[0].company,'HJF');
    assert.equal((await cloud.listSnapshots()).length,1);
    await cloud.signOut();assert.equal(cloud.session,null);
    await cloud.connect();assert.equal(cloud.session,null);
    await assert.rejects(()=>cloud.listSnapshots(),/Masuk ke akun/);
    await cloud.disconnect();assert.equal(cloud.client,null);
  }finally{cloud.client?.auth.stopAutoRefresh();dom.window.close();}
});
