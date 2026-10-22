import test from 'node:test';
import assert from 'node:assert/strict';
import {validateConfig} from '../dist/cloud.js';
test('Supabase config accepts public keys and rejects privileged or malformed endpoints',()=>{
  const anon='eyJhbGciOiJIUzI1NiJ9.'+Buffer.from(JSON.stringify({role:'anon'})).toString('base64url')+'.signature';
  const service='eyJhbGciOiJIUzI1NiJ9.'+Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url')+'.signature';
  assert.equal(validateConfig('https://project.supabase.co',anon).url,'https://project.supabase.co');
  assert.ok(validateConfig('https://project.supabase.co/','sb_publishable_public_key_example_123456789'));
  assert.throws(()=>validateConfig('https://project.supabase.co',service),/service_role/);
  assert.throws(()=>validateConfig('https://project.supabase.co','sb_secret_example'),/secret/);
  assert.throws(()=>validateConfig('http://project.supabase.co',anon),/HTTPS/);
  assert.throws(()=>validateConfig('https://project.supabase.co/rest/v1',anon),/tanpa path/);
});
