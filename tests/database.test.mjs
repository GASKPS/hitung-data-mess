import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const users=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333'];
const payload=label=>({label,mess:[{nik:'TEST001',name:'Test'}],manpower:[{nik:'TEST001',company:'HJF',department:'Production',subdepartment:'Furnace',grade:'S1.1',position:'Operator'}],counts:{total:1},source_info:{},invalid_rows:[]});
test('shared schema upgrades existing data and enforces atomic replacement and registered account access',async(t)=>{
  const db=new PGlite();
  const root=()=>db.exec('reset role;');
  const asUser=async id=>{await root();await db.exec(`set role authenticated; set request.jwt.claim.sub = '${id}';`);};
  const replace=async value=>(await db.query('select public.replace_mess_data($1::jsonb) as saved',[JSON.stringify(value)])).rows[0].saved;
  const all=async()=>(await db.query('select * from public.mess_snapshots order by created_at desc, id desc')).rows;
  const status=async()=>(await db.query('select public.mess_access_status() as access')).rows[0].access;
  try{
    await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key, email text default 'employee@example.test'); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$; grant usage on schema auth to authenticated, anon; insert into auth.users (id) values ('${users[0]}'), ('${users[1]}'); insert into auth.users (id,email) values ('44444444-4444-4444-8444-444444444444',null);`);
    await db.exec(readFileSync(new URL('./fixtures/legacy-schema.sql',import.meta.url),'utf8'));
    await asUser(users[0]);await db.query("insert into public.mess_snapshots (label) values ('Data akun pertama')");
    await asUser(users[1]);await db.query("insert into public.mess_snapshots (label) values ('Data akun kedua')");
    await root();const before=(await all()).map(row=>row.id);
    const schema=readFileSync(new URL('../supabase/schema.sql',import.meta.url),'utf8');await db.exec(schema);await db.exec(schema);
    assert.deepEqual((await all()).map(row=>row.id),before);
    await t.test('both existing accounts see the same latest data after migration',async()=>{
      await asUser(users[0]);assert.deepEqual(await status(),{version:2,allowed:true});const first=await all();
      await asUser(users[1]);assert.deepEqual((await all()).map(row=>row.id),first.map(row=>row.id));
      assert.equal((await db.query('select * from public.mess_members')).rows.length,1);
    });
    let latest;
    await t.test('each registered account can replace the same data and uploader identity cannot be forged',async()=>{
      await asUser(users[0]);const first=await replace({...payload('Impor A'),user_id:users[1]});assert.equal(first.user_id,users[0]);assert.equal((await all()).length,1);
      await asUser(users[1]);assert.equal((await all())[0].id,first.id);latest=await replace(payload('Impor B'));assert.equal(latest.user_id,users[1]);
      await asUser(users[0]);assert.equal((await all()).length,1);assert.equal((await all())[0].id,latest.id);
    });
    await t.test('empty or invalid data cannot remove the previous successful import',async()=>{
      await assert.rejects(()=>replace({...payload('Kosong'),mess:[]}),/Data kosong/);
      await assert.rejects(()=>replace({...payload('Tidak valid'),manpower:{}}),/Format data/);
      await assert.rejects(()=>replace({...payload('NIK kosong'),mess:[{nik:'',name:'Kosong'}]}),/NIK yang valid/);
      await assert.rejects(()=>replace({...payload('Baris tidak valid'),manpower:[null]}),/NIK yang valid/);
      await assert.rejects(()=>replace({...payload('Tidak valid'),counts:[]}),/counts_object/);
      await assert.rejects(()=>replace(payload('x'.repeat(161))),/check constraint/);
      assert.equal((await all()).length,1);assert.equal((await all())[0].id,latest.id);
    });
    await t.test('a delete failure rolls back the new insert as well as preserving the old data',async()=>{
      await root();await db.exec(`create function public.test_block_delete() returns trigger language plpgsql as $$ begin raise exception 'Delete blocked'; end $$; create trigger test_block_delete before delete on public.mess_snapshots for each row execute function public.test_block_delete();`);
      await asUser(users[0]);await assert.rejects(()=>replace(payload('Harus batal')),/Delete blocked/);assert.equal((await all()).length,1);assert.equal((await all())[0].id,latest.id);
      await root();await db.exec('drop trigger test_block_delete on public.mess_snapshots; drop function public.test_block_delete();');
    });
    await t.test('registered users cannot bypass atomic replacement with direct writes',async()=>{
      await asUser(users[0]);await assert.rejects(()=>db.query("insert into public.mess_snapshots (label) values ('Bypass')"),/permission denied/);
      await assert.rejects(()=>db.query('delete from public.mess_snapshots'),/permission denied/);await assert.rejects(()=>db.query("update public.mess_snapshots set label='Bypass'"),/permission denied/);
    });
    await t.test('a new unapproved account cannot read, replace, or grant itself access',async()=>{
      await root();await db.exec(`insert into auth.users (id) values ('${users[2]}')`);await asUser(users[2]);assert.deepEqual(await status(),{version:2,allowed:false});assert.equal((await all()).length,0);
      await assert.rejects(()=>replace(payload('Tanpa akses')),/belum diberi akses/);await assert.rejects(()=>db.query('insert into public.mess_members (user_id) values ($1)',[users[2]]),/permission denied/);
    });
    await t.test('anonymous callers cannot read employee data or execute replacement',async()=>{
      await root();await db.exec('set role anon;');await assert.rejects(()=>all(),/permission denied/);await assert.rejects(()=>replace(payload('Anonim')),/permission denied/);
      await asUser('44444444-4444-4444-8444-444444444444');assert.equal((await status()).allowed,false);assert.equal((await all()).length,0);
    });
    await t.test('disabled accounts stay disabled when the migration is rerun',async()=>{
      await root();await db.query('update public.mess_members set enabled=false where user_id=$1',[users[1]]);await db.exec(schema);
      await asUser(users[1]);assert.equal((await status()).allowed,false);assert.equal((await all()).length,0);await assert.rejects(()=>replace(payload('Dinonaktifkan')),/belum diberi akses/);
    });
    await t.test('removing an uploader account preserves shared resident data',async()=>{
      await root();await db.query('delete from auth.users where id=$1',[users[1]]);await asUser(users[0]);assert.equal((await all()).length,1);assert.equal((await all())[0].id,latest.id);assert.equal((await all())[0].user_id,null);
    });
  }finally{await db.close();}
});
