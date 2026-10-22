import { summary } from './core.js';
export const DEFAULT_CONFIG = Object.freeze({
  url: 'https://jajtnydqgsmenbsjpllu.supabase.co',
  key: 'sb_publishable_mM_l9iZSXavTD7x4gec2nw_JybjfE78'
});
export let client = null;
export let session = null;
export let access = {mode:'unknown',allowed:false};
let subscription = null;
function setSession(current){
  if(session?.user.id!==current?.user.id)access={mode:'unknown',allowed:false};
  session=current;
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
export async function connect(onChange = () => {}) {
  const validated = validateConfig(DEFAULT_CONFIG.url,DEFAULT_CONFIG.key);
  if (!globalThis.supabase?.createClient) throw new Error('Modul Supabase belum termuat. Muat ulang halaman lalu coba kembali.');
  subscription?.unsubscribe();
  subscription=null;
  if (!client) client = globalThis.supabase.createClient(validated.url,validated.key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
  const {data,error}=await client.auth.getSession();
  if(error)throw error;
  setSession(data.session);
  subscription=client.auth.onAuthStateChange((_event,current)=>{setSession(current);queueMicrotask(()=>onChange(current));}).data.subscription;
  onChange(session);
  return session;
}
export async function signIn(email,password) {
  if(!client)throw new Error('Penyimpanan belum siap. Coba hubungkan kembali.');
  const {data,error}=await client.auth.signInWithPassword({email:email.trim(),password});
  if(error){
    const message=error.code==='invalid_credentials'||error.message==='Invalid login credentials'?'Email atau kata sandi tidak sesuai.':error.code==='email_not_confirmed'?'Email belum dikonfirmasi. Periksa email konfirmasi akun Anda.':error.message;
    throw new Error(message);
  }
  setSession(data.session); return session;
}
export async function signOut() {
  if(!client)return;
  const {error}=await client.auth.signOut(); if(error)throw error;
  setSession(null);
}
export async function disconnect() {
  if(client && session)await signOut();
  subscription?.unsubscribe(); subscription=null;
  client?.auth.stopAutoRefresh();
  client=null;setSession(null);
}
function requireSession() {
  if(!client || !session)throw new Error('Masuk ke akun Supabase untuk menyimpan atau membuka data.');
}
function explainError(error) {
  if(['42P01','PGRST205'].includes(error.code))return new Error('Tabel belum tersedia. Jalankan supabase/schema.sql di SQL Editor Supabase terlebih dahulu.');
  if(error.code==='42501')return new Error('Akun belum diberi akses data mess. Minta pengelola mendaftarkan akun Anda.');
  return new Error(error.message || 'Supabase tidak dapat dihubungi.');
}
export async function refreshAccess(){
  requireSession();const userId=session.user.id;
  const {data,error}=await client.rpc('mess_access_status');
  if(userId!==session?.user.id)throw new Error('Akun berubah. Masuk kembali sebelum melanjutkan.');
  if(error){
    if(['PGRST202','42883'].includes(error.code))access={mode:'legacy',allowed:true};
    else throw explainError(error);
  }else{
    if(data?.version!==2)throw new Error('Versi penyimpanan belum dikenali. Hubungi pengelola web.');
    access={mode:'shared',allowed:data.allowed===true};
  }
  return access;
}
async function requireDataAccess(){
  requireSession();if(access.mode==='unknown')await refreshAccess();
  if(!access.allowed)throw new Error('Akun belum diberi akses data mess. Minta pengelola mendaftarkan akun Anda.');
}
function snapshotQuery(columns){
  const query=client.from('mess_snapshots').select(columns);
  return access.mode==='legacy'?query.eq('user_id',session.user.id):query;
}
export async function removeOlderSnapshots(snapshot) {
  await requireDataAccess();
  if(access.mode==='shared')throw new Error('Data bersama diganti otomatis dalam satu transaksi. Tidak perlu menghapus data secara terpisah.');
  if(snapshot.user_id!==session.user.id)throw new Error('Akun berubah. Masuk kembali sebelum melanjutkan.');
  // Refresh the boundary after the insert commits. A slower, older import may
  // finish after a newer import from another tab has already been saved.
  const latest=(await listSnapshots())[0]||snapshot;
  if(snapshot.user_id!==session?.user.id)throw new Error('Akun berubah. Masuk kembali sebelum melanjutkan.');
  const id=latest.id,stamp=latest.created_at;
  if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)||!/^\d{4}-\d\d-\d\dT[\d:.]+(?:Z|[+-]\d\d:\d\d)$/.test(stamp)||!Number.isFinite(Date.parse(stamp)))throw new Error('Identitas data tersimpan tidak valid. Muat ulang data sebelum mencoba lagi.');
  // Never delete a newer import from another tab. UUID breaks equal timestamp ties.
  const {error}=await client.from('mess_snapshots').delete().eq('user_id',snapshot.user_id).or(`created_at.lt.${stamp},and(created_at.eq.${stamp},id.lt.${id})`);
  if(error)throw explainError(error);
  return latest;
}
export async function saveSnapshot(dataset,label='Data mess') {
  await requireDataAccess();
  if(dataset.mode==='demo'||!dataset.residents?.length||!dataset.mess?.length||!dataset.manpower?.length)throw new Error('Unggah dan proses kedua file terlebih dahulu. Data kosong tidak mengganti data tersimpan.');
  const ownerId=session.user.id;
  const stats=summary(dataset.residents);
  const payload={user_id:session.user.id,label:label.trim().slice(0,160) || 'Data mess',grade_mode:'raw',source_info:{...dataset.sources,classification:dataset.classificationVersion},imported_at:dataset.importedAt,counts:stats,mess:dataset.mess,manpower:dataset.manpower,invalid_rows:dataset.invalid || []};
  if(access.mode==='shared'){
    const {data,error}=await client.rpc('replace_mess_data',{p_data:payload});
    if(error)throw explainError(error);
    return {...data,latestId:data.id,cleanupPending:false};
  }
  const {data,error}=await client.from('mess_snapshots').insert(payload).select('id,label,created_at').single();
  if(error)throw explainError(error);
  const saved={...data,user_id:ownerId,cleanupPending:false};
  // Only remove older records after the full new import has been saved successfully.
  try{saved.latestId=(await removeOlderSnapshots(saved)).id;}catch(error){saved.cleanupPending=true;saved.cleanupError=error.message;}
  return saved;
}
export async function listSnapshots() {
  await requireDataAccess();
  const {data,error}=await snapshotQuery('id,label,created_at,counts,source_info').order('created_at',{ascending:false}).order('id',{ascending:false}).limit(1);
  if(error)throw explainError(error);
  return data || [];
}
export async function loadSnapshot(id) {
  await requireDataAccess();
  const {data,error}=await snapshotQuery('*').eq('id',id).single();
  if(error)throw explainError(error);
  return data;
}
export async function loadLatestSnapshot(){
  await requireDataAccess();
  const {data,error}=await snapshotQuery('*').order('created_at',{ascending:false}).order('id',{ascending:false}).limit(1).maybeSingle();
  if(error)throw explainError(error);
  return data;
}
