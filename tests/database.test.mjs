import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
test('Supabase schema enforces owner access, anonymous denial, and immutable snapshots',async()=>{
  const db=new PGlite();
  try{
    await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$; grant usage on schema auth to authenticated, anon; insert into auth.users values ('11111111-1111-4111-8111-111111111111'), ('22222222-2222-4222-8222-222222222222');`);
    const schema=readFileSync(new URL('../supabase/schema.sql',import.meta.url),'utf8');await db.exec(schema);await db.exec(schema);
    await db.exec(`set role authenticated; set request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';`);
    const saved=await db.query(`insert into public.mess_snapshots (label) values ('Private A') returning id`);const id=saved.rows[0].id;
    assert.equal((await db.query('select * from public.mess_snapshots')).rows.length,1);
    await assert.rejects(()=>db.query(`insert into public.mess_snapshots (user_id,label) values ('22222222-2222-4222-8222-222222222222','Wrong owner')`),/row-level security/);
    await assert.rejects(()=>db.query(`update public.mess_snapshots set label='Altered'`),/permission denied/);
    await db.exec(`set request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';`);
    assert.equal((await db.query('select * from public.mess_snapshots')).rows.length,0);
    assert.equal((await db.query('delete from public.mess_snapshots where id=$1 returning id',[id])).rows.length,0);
    await db.exec(`reset role; set role anon;`);
    await assert.rejects(()=>db.query('select * from public.mess_snapshots'),/permission denied/);
    await assert.rejects(()=>db.query(`insert into public.mess_snapshots (label) values ('Anonymous')`),/permission denied/);
    await db.exec(`reset role; set role authenticated; set request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';`);
    assert.equal((await db.query('delete from public.mess_snapshots where id=$1 returning id',[id])).rows.length,1);
  }finally{await db.close();}
});
