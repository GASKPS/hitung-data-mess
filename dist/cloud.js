import { summary } from './core.js';
const CONFIG_KEY = 'mess-insight:supabase:v1';
export let client = null;
export let session = null;
export let config = null;
let subscription = null;
export function storedConfig() {
  try { return JSON.parse(localStorage.getItem(CONFIG_KEY) || 'null'); } catch { return null; }
}
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
export async function connect(url, key, onChange = () => {}) {
  const validated = validateConfig(url,key);
  if (!globalThis.supabase?.createClient) throw new Error('Modul Supabase belum termuat. Muat ulang halaman lalu coba kembali.');
  subscription?.unsubscribe();
  if (client) client.auth.stopAutoRefresh();
  client = globalThis.supabase.createClient(validated.url,validated.key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
  config=validated;
  localStorage.setItem(CONFIG_KEY,JSON.stringify(validated));
  const {data,error}=await client.auth.getSession();
  if(error)throw error;
  session=data.session;
  subscription=client.auth.onAuthStateChange((_event,current)=>{session=current;queueMicrotask(()=>onChange(current));}).data.subscription;
  onChange(session);
  return session;
}
export async function signIn(email,password) {
  if(!client)throw new Error('Simpan koneksi Supabase terlebih dahulu.');
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
  client=null;session=null;config=null;
  localStorage.removeItem(CONFIG_KEY);
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
