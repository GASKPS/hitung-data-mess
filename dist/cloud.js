import { summary } from './core.js';
export const DEFAULT_CONFIG = Object.freeze({
  url: 'https://jajtnydqgsmenbsjpllu.supabase.co',
  key: 'sb_publishable_mM_l9iZSXavTD7x4gec2nw_JybjfE78'
});
export let client = null;
export let session = null;
let subscription = null;
export function validateConfig(url, key) {
  let endpoint;
  try { endpoint = new URL(url.trim()); } catch { throw new Error('Masukkan Project URL Supabase yang valid.'); }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== '/') throw new Error('Gunakan Project URL HTTPS tanpa path atau parameter.');
  const publicKey = key.trim();
  if (publicKey.startsWith('sb_secret_')) throw new Error('Gunakan publishable key atau anon key, bukan secret key.');
  if (publicKey.startsWith('eyJ')) {
    try {
      const piece = publicKey.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
      const claims = JSON.parse(atob(piece));
      if (claims.role !== 'anon') throw new Error('role');
    } catch { throw new Error('Key tidak valid. Gunakan anon key publik, bukan service_role.'); }
  } else if (!publicKey.startsWith('sb_publishable_') || publicKey.length < 25) throw new Error('Masukkan publishable key atau anon key publik dari Supabase.');
  return { url: endpoint.origin, key: publicKey };
}
export async function connect(onChange = () => {}) {
  const validated = validateConfig(DEFAULT_CONFIG.url,DEFAULT_CONFIG.key);
  if (!globalThis.supabase?.createClient) throw new Error('Modul Supabase belum termuat. Muat ulang halaman lalu coba kembali.');
  subscription?.unsubscribe();
  subscription=null;
  if (!client) client = globalThis.supabase.createClient(validated.url,validated.key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
  const {data,error}=await client.auth.getSession();
  if(error)throw error;
  session=data.session;
  subscription=client.auth.onAuthStateChange((_event,current)=>{session=current;queueMicrotask(()=>onChange(current));}).data.subscription;
  onChange(session);
  return session;
}
export async function signIn(email,password) {
  if(!client)throw new Error('Penyimpanan belum siap. Coba hubungkan kembali.');
  const {data,error}=await client.auth.signInWithPassword({email:email.trim(),password});
  if(error)throw new Error(error.message==='Invalid login credentials'?'Email atau kata sandi tidak sesuai.':error.message);
  session=data.session; return session;
}
export async function signOut() {
  if(!client)return;
  const {error}=await client.auth.signOut(); if(error)throw error;
  session=null;
}
export async function disconnect() {
  if(client && session)await signOut();
  subscription?.unsubscribe(); subscription=null;
  client?.auth.stopAutoRefresh();
  client=null;session=null;
}
function requireSession() {
  if(!client || !session)throw new Error('Masuk ke akun Supabase untuk menyimpan atau membuka data.');
}
function explainError(error) {
  if(['42P01','PGRST205'].includes(error.code))return new Error('Tabel belum tersedia. Jalankan supabase/schema.sql di SQL Editor Supabase terlebih dahulu.');
  if(error.code==='42501')return new Error('Akses data ditolak. Pastikan akun sudah masuk dan kebijakan RLS dari schema.sql sudah terpasang.');
  return new Error(error.message || 'Supabase tidak dapat dihubungi.');
}
export async function saveSnapshot(dataset,label) {
  requireSession();
  if(dataset.mode==='demo')throw new Error('Impor file Anda terlebih dahulu. Data contoh tidak disimpan ke Supabase.');
  const stats=summary(dataset.residents);
  const payload={user_id:session.user.id,label:label.trim().slice(0,160) || 'Data mess',grade_mode:'raw',source_info:{...dataset.sources,classification:dataset.classificationVersion},imported_at:dataset.importedAt,counts:stats,mess:dataset.mess,manpower:dataset.manpower,invalid_rows:dataset.invalid || []};
  const {data,error}=await client.from('mess_snapshots').insert(payload).select('id,label,created_at').single();
  if(error)throw explainError(error);
  return data;
}
export async function listSnapshots() {
  requireSession();
  const {data,error}=await client.from('mess_snapshots').select('id,label,created_at,counts,source_info').order('created_at',{ascending:false}).limit(30);
  if(error)throw explainError(error);
  return data || [];
}
export async function loadSnapshot(id) {
  requireSession();
  const {data,error}=await client.from('mess_snapshots').select('*').eq('id',id).single();
  if(error)throw explainError(error);
  return data;
}
