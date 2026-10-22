import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import * as cloud from '../dist/cloud.js';
import {reconcile} from '../dist/core.js';

test('real Supabase SDK authenticates, replaces old imports, and preserves data on failures',async(t)=>{
  const dom=new JSDOM('<html><script src="https://example.test/assets/supabase.js"></script></html>',{url:'https://example.test',runScripts:'outside-only'});
  const userId='11111111-1111-4111-8111-111111111111',snapshotId='33333333-3333-4333-8333-333333333333';
  const now=Math.floor(Date.now()/1000);
  const jwt=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({aud:'authenticated',exp:now+3600,iat:now,sub:userId,role:'authenticated',email:'test@example.test'})).toString('base64url')+'.test-signature';
  const user={id:userId,aud:'authenticated',role:'authenticated',email:'test@example.test',app_metadata:{provider:'email'},user_metadata:{},created_at:new Date().toISOString()};
  let inserted,serial=0,nextCreatedAt=null,failInsert=false,failDelete=false,addNewerBeforeDelete=false,postAttempts=0,deleteAttempts=0,sharedMode=false,sharedAllowed=true,failSharedTransaction=false,sharedPayload;
  const otherId='22222222-2222-4222-8222-222222222222';
  let rows=[{id:'33333333-3333-4333-8333-000000000000',user_id:userId,label:'Data lama',created_at:'2023-01-01T00:00:00.000Z'},{id:'44444444-4444-4444-8444-444444444444',user_id:otherId,label:'Data akun lain',created_at:'2023-01-01T00:00:00.000Z'}];
  const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
  const fakeFetch=async(input,init={})=>{
    const url=String(input);
    assert.equal(new URL(url).origin,cloud.DEFAULT_CONFIG.url);
    assert.equal(new Headers(init.headers).get('apikey'),cloud.DEFAULT_CONFIG.key);
    if(url.includes('/auth/v1/token'))return json({access_token:jwt,refresh_token:'test-refresh',expires_in:3600,token_type:'bearer',user});
    if(url.includes('/auth/v1/logout'))return new Response(null,{status:204});
    if(url.includes('/rest/v1/rpc/')){
      assert.equal(new Headers(init.headers).get('Authorization'),`Bearer ${jwt}`);
      if(!sharedMode)return json({code:'PGRST202',message:'Function not found'},404);
      if(url.endsWith('/mess_access_status'))return json({version:2,allowed:sharedAllowed});
      assert.ok(url.endsWith('/replace_mess_data'));assert.equal(init.method,'POST');
      if(!sharedAllowed)return json({code:'42501',message:'No access'},403);
      sharedPayload=JSON.parse(init.body).p_data;
      if(failSharedTransaction){failSharedTransaction=false;return json({code:'23514',message:'Transaction failed'},400);}
      const row={...sharedPayload,user_id:userId,id:`33333333-3333-4333-8333-${String(serial++).padStart(12,'0')}`,created_at:new Date().toISOString()};rows=[row];return json({id:row.id,label:row.label,user_id:row.user_id,created_at:row.created_at});
    }
    if(url.includes('/rest/v1/mess_snapshots')){
      const reqHeaders=new Headers(init.headers);assert.equal(reqHeaders.get('Authorization'),`Bearer ${jwt}`);
      const params=new URL(url).searchParams;
      if(init.method==='POST'){
        postAttempts++;if(failInsert){failInsert=false;return json({message:'Insert failed',code:'23514'},400);}
        inserted=JSON.parse(init.body);const index=serial++,row={...inserted,id:index===0?snapshotId:`33333333-3333-4333-8333-${String(index).padStart(12,'0')}`,created_at:nextCreatedAt||new Date(1800000000000+index*1000).toISOString()};nextCreatedAt=null;rows.push(row);return json({id:row.id,label:row.label,created_at:row.created_at},201);
      }
      if(init.method==='DELETE'){
        deleteAttempts++;assert.equal(params.get('user_id'),`eq.${userId}`);
        if(failDelete){failDelete=false;return json({message:'Delete failed',code:'42501'},403);}
        const filter=params.get('or');const match=filter.match(/^\(created_at\.lt\.([^,]+),and\(created_at\.eq\.([^,]+),id\.lt\.([^)]*)\)\)$/);assert.ok(match,filter);assert.equal(match[1],match[2]);
        if(addNewerBeforeDelete){rows.push({id:'ffffffff-ffff-4fff-8fff-ffffffffffff',user_id:userId,label:'Lebih baru',created_at:match[1],counts:{total:3}});addNewerBeforeDelete=false;}
        rows=rows.filter(row=>!(row.user_id===userId&&(row.created_at<match[1]||(row.created_at===match[1]&&row.id<match[3]))));return new Response(null,{status:204});
      }
      if(sharedMode)assert.equal(params.has('user_id'),false,'shared reads must not filter by uploader');
      let visible=sharedMode?rows:rows.filter(row=>row.user_id===userId);
      if(params.has('id'))return json(visible.find(row=>`eq.${row.id}`===params.get('id')));
      assert.equal(params.get('limit'),'1');assert.equal(params.get('order'),'created_at.desc,id.desc');
      visible.sort((a,b)=>b.created_at.localeCompare(a.created_at)||b.id.localeCompare(a.id));return json(visible.slice(0,1));
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
    assert.equal(saved.cleanupPending,false);assert.equal(rows.filter(row=>row.user_id===userId).length,1);assert.equal(rows.find(row=>row.user_id===otherId).label,'Data akun lain');
    assert.equal((await cloud.listSnapshots())[0].id,saved.id);assert.equal((await cloud.loadSnapshot(saved.id)).mess[0].nik,'TEST001');
    await t.test('failed and empty imports never delete the previous successful import',async()=>{
      const before=structuredClone(rows),deletes=deleteAttempts;failInsert=true;
      await assert.rejects(()=>cloud.saveSnapshot(dataset,'Gagal'),/Insert failed/);assert.deepEqual(rows,before);assert.equal(deleteAttempts,deletes);
      await assert.rejects(()=>cloud.saveSnapshot({...dataset,residents:[]},'Kosong'),/Data kosong/);assert.deepEqual(rows,before);assert.equal(deleteAttempts,deletes);
    });
    await t.test('cleanup failure preserves both imports and can be retried without a second insert',async()=>{
      failDelete=true;const result=await cloud.saveSnapshot(dataset,'Pengganti');assert.equal(result.cleanupPending,true);
      assert.equal(rows.filter(row=>row.user_id===userId).length,2);const inserts=postAttempts;
      await cloud.removeOlderSnapshots(result);assert.equal(postAttempts,inserts);assert.deepEqual(rows.filter(row=>row.user_id===userId).map(row=>row.id),[result.id]);
    });
    await t.test('an older cleanup cannot delete a newer import, including equal timestamp ties',async()=>{
      addNewerBeforeDelete=true;const result=await cloud.saveSnapshot(dataset,'Simpan bersamaan');assert.equal(result.cleanupPending,false);
      const newest=rows.find(row=>row.label==='Lebih baru');assert.ok(newest);assert.equal(newest.created_at,result.created_at);
      assert.equal((await cloud.listSnapshots())[0].id,newest.id);
      await cloud.removeOlderSnapshots({...newest,user_id:userId});assert.deepEqual(rows.filter(row=>row.user_id===userId).map(row=>row.id),[newest.id]);
      assert.equal(rows.filter(row=>row.user_id===otherId).length,1);
    });
    await t.test('a snapshot from another account cannot be used as a deletion boundary',async()=>{
      const deletes=deleteAttempts;await assert.rejects(()=>cloud.removeOlderSnapshots({...saved,user_id:otherId}),/Akun berubah/);assert.equal(deleteAttempts,deletes);
    });
    await t.test('an older insert completing late is removed while the newest committed import survives',async()=>{
      const newest=(await cloud.listSnapshots())[0];nextCreatedAt='2025-01-01T00:00:00.000Z';
      const result=await cloud.saveSnapshot(dataset,'Impor lambat');assert.equal(result.cleanupPending,false);assert.equal(result.latestId,newest.id);
      assert.deepEqual(rows.filter(row=>row.user_id===userId).map(row=>row.id),[newest.id]);assert.equal(rows.filter(row=>row.user_id===otherId).length,1);
    });
    await t.test('shared reads include another uploader and replacement uses one RPC without direct writes',async()=>{
      rows=[{...inserted,id:'88888888-8888-4888-8888-888888888888',user_id:otherId,label:'Data bersama',created_at:new Date().toISOString()}];sharedMode=true;
      assert.deepEqual(await cloud.refreshAccess(),{mode:'shared',allowed:true});
      const shared=await cloud.loadLatestSnapshot();assert.equal(shared.user_id,otherId);assert.equal(shared.mess[0].nik,'TEST001');
      const posts=postAttempts,deletes=deleteAttempts,saved=await cloud.saveSnapshot(dataset,'Impor bersama');
      assert.equal(saved.cleanupPending,false);assert.equal(saved.user_id,userId);assert.equal(sharedPayload.mess[0].nik,'TEST001');assert.equal(rows.length,1);
      assert.equal((await cloud.listSnapshots())[0].id,saved.id);assert.equal(postAttempts,posts);assert.equal(deleteAttempts,deletes);
    });
    await t.test('a failed shared transaction never falls back to separate insert or delete',async()=>{
      const before=structuredClone(rows),posts=postAttempts,deletes=deleteAttempts;failSharedTransaction=true;
      await assert.rejects(()=>cloud.saveSnapshot(dataset,'Batal'),/Transaction failed/);assert.deepEqual(rows,before);assert.equal(postAttempts,posts);assert.equal(deleteAttempts,deletes);
    });
    await t.test('a nonmember is rejected before a shared read or write is issued',async()=>{
      sharedAllowed=false;assert.deepEqual(await cloud.refreshAccess(),{mode:'shared',allowed:false});
      await assert.rejects(()=>cloud.listSnapshots(),/belum diberi akses/);await assert.rejects(()=>cloud.loadLatestSnapshot(),/belum diberi akses/);await assert.rejects(()=>cloud.saveSnapshot(dataset,'Tanpa akses'),/belum diberi akses/);
      sharedAllowed=true;await cloud.refreshAccess();
    });
    await cloud.signOut();assert.equal(cloud.session,null);
    await cloud.connect();assert.equal(cloud.session,null);
    await assert.rejects(()=>cloud.listSnapshots(),/Masuk ke akun/);
    await cloud.disconnect();assert.equal(cloud.client,null);
  }finally{cloud.client?.auth.stopAutoRefresh();dom.window.close();}
});
