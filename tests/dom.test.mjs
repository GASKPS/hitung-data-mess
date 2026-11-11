import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import * as X from '../dist/assets/xlsx.mjs';
const dom=new JSDOM(readFileSync(new URL('../dist/index.html',import.meta.url),'utf8'),{url:'https://example.test/mess-insight/',pretendToBeVisual:true,runScripts:'outside-only'});
const {window}=dom;Object.assign(globalThis,{window,document:window.document,location:window.location,localStorage:window.localStorage});
window.confirm=()=>true;
window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};window.HTMLDialogElement.prototype.close=function(){this.open=false;};
let authListener,mockSession=null,sessionChecks=0,snapshotNumber=0,failNextSave=false,failNextCleanup=false,loginFails=false,sharedMode=false,sharedAllowed=true,failSharedSave=false;
let savedRows=[];
const query=()=>({
  operation:'GET',filters:[],
  select(){return this;},order(){return this;},limit(){return this;},eq(field,value){this.filters.push([field,value]);return this;},or(value){this.older=value;return this;},
  insert(payload){this.operation='POST';this.payload=payload;return this;},delete(){this.operation='DELETE';return this;},
  async execute(){
    if(this.operation==='POST'){
      assert.equal(sharedMode,false,'shared saves must use the transaction RPC');
      if(failNextSave){failNextSave=false;return {data:null,error:{message:'Menyimpan gagal.'}};}
      const row={...structuredClone(this.payload),id:`33333333-3333-4333-8333-${String(++snapshotNumber).padStart(12,'0')}`,created_at:new Date(1700000000000+snapshotNumber*1000).toISOString()};savedRows.push(row);return {data:row,error:null};
    }
    if(this.operation==='DELETE'){
      assert.equal(sharedMode,false,'shared saves must not issue a separate DELETE');
      if(failNextCleanup){failNextCleanup=false;return {data:null,error:{message:'Menghapus gagal.'}};}
      const stamp=this.older.match(/created_at\.lt\.([^,]+)/)[1],id=this.older.match(/id\.lt\.([^)]*)/)[1];
      savedRows=savedRows.filter(row=>!(this.filters.every(([key,value])=>row[key]===value)&&(row.created_at<stamp||(row.created_at===stamp&&row.id<id))));return {data:null,error:null};
    }
    return {data:savedRows.filter(row=>(sharedMode?sharedAllowed:row.user_id===mockSession?.user.id)&&this.filters.every(([key,value])=>row[key]===value)).sort((a,b)=>b.created_at.localeCompare(a.created_at)||b.id.localeCompare(a.id)).slice(0,1),error:null};
  },
  async single(){const result=await this.execute();if(Array.isArray(result.data))result.data=result.data[0];return result;},
  async maybeSingle(){const result=await this.single();result.data??=null;return result;},
  then(resolve,reject){return this.execute().then(resolve,reject);}
});
globalThis.supabase={createClient:(url,key)=>{
  assert.equal(url,'https://jajtnydqgsmenbsjpllu.supabase.co');assert.ok(key.startsWith('sb_publishable_'));
  return {
    auth:{
      getSession:async()=>++sessionChecks===1?{data:{session:null},error:new Error('Koneksi terputus.')}:{data:{session:mockSession},error:null},
      onAuthStateChange:callback=>{authListener=callback;return {data:{subscription:{unsubscribe(){authListener=null;}}}};},
      signInWithPassword:async({email})=>{if(loginFails)return {data:{session:null},error:{code:'invalid_credentials',message:'Invalid login credentials'}};mockSession={user:{id:email==='other@example.test'?'other-user':'test-user',email}};authListener?.('SIGNED_IN',mockSession);return {data:{session:mockSession},error:null};},
      signOut:async()=>{mockSession=null;authListener?.('SIGNED_OUT',null);return {error:null};},
      stopAutoRefresh(){}
    },
    from:query,
    rpc:async(name,args)=>{
      if(!sharedMode)return {data:null,error:{code:'PGRST202',message:'Function not found'}};
      if(name==='mess_access_status')return {data:{version:2,allowed:sharedAllowed},error:null};
      assert.equal(name,'replace_mess_data');if(!sharedAllowed)return {data:null,error:{code:'42501',message:'No access'}};
      if(failSharedSave){failSharedSave=false;return {data:null,error:{message:'Transaksi gagal.'}};}
      const row={...structuredClone(args.p_data),user_id:mockSession.user.id,id:`33333333-3333-4333-8333-${String(++snapshotNumber).padStart(12,'0')}`,created_at:new Date(1700000000000+snapshotNumber*1000).toISOString()};savedRows=[row];return {data:{id:row.id,user_id:row.user_id,created_at:row.created_at,label:row.label},error:null};
    }
  };
}};
const originalTimeout=globalThis.setTimeout;
globalThis.setTimeout=(fn,delay,...args)=>{const timer=originalTimeout(fn,delay,...args);if(delay>=1000)timer.unref();return timer;};
await import('../dist/app.js');
const $=selector=>document.querySelector(selector);
const pause=ms=>new Promise(resolve=>originalTimeout(resolve,ms));
async function until(condition){for(let i=0;i<150;i++){if(condition())return;await pause(10);}throw new Error('DOM state did not settle');}
function change(selector,value){$(selector).value=value;$(selector).dispatchEvent(new window.Event('change',{bubbles:true}));}
function sampleFile(name,rows){const wb=X.utils.book_new();X.utils.book_append_sheet(wb,X.utils.aoa_to_sheet(rows),'Data');const bytes=X.write(wb,{type:'buffer',bookType:'xlsx'});return {name,size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};}
async function upload(type,file){Object.defineProperty($(`#file-${type}`),'files',{configurable:true,value:[file]});$(`#file-${type}`).dispatchEvent(new window.Event('change',{bubbles:true}));await until(()=>$(`#file-${type}-status`).textContent.includes(file.name));}
async function login(email='test@example.test'){$('#login-email').value=email;$('#login-password').value='test-password';$('#login-form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));await until(()=>!$('#workspace').hidden&&!$('#file-mess').disabled);}
const mess=[['Database hunian'],['NIK','Nama','Lokasi Mess','Blok','No Kamar'],
  ['0001','<img src=x onerror=alert(1)>','Surya','A','101'],['0002','MT Production','Surya','A','102'],['0003','Crane Operator','Meranti','B','201'],
  ['0004','Operator KPS','Surya','A','103'],['0005','Lead KPS','Surya','A','104'],['0006','Tanpa Jabatan','Surya','A','105'],
  ['0007','Kode Baru','Surya','A','106'],['0008','Referensi Berbeda','Surya','A','107'],['UNKNOWN','Belum Ada','Surya','A','108'],['0001','Duplikat','Meranti','B','202'],['','NIK Kosong','Surya','A','109']];
const mp=[['Manpower'],['NIK','Nama','COST CENTER','Department','Subdept','Gol','Jabatan'],
  ['0001','A','HJF','Production','Furnace','S3.7','Translator'],['0002','B','HJF','Production','Furnace','P1.5','Management   Trainee, Production'],
  ['0003','C','HJF','Equipment','Operations','P1.5','Crawler Crane Operator'],['0004','D','KPS','Quality','Laboratory','M1.5','Operator'],
  ['0005','E','KPS','Quality','Laboratory','S4.9','Lead'],['0006','F','KPS','Quality','Laboratory','P1.4',''],
  ['0007','G','HJF','Production','Furnace','P9.1','Operator'],['0008','H','HJF','Production','Furnace','S1.1','Operator'],['0008','H','KPS','Production','Furnace','S1.1','Operator']];

test('login is the first screen and workspace stays hidden until a valid session is available',async()=>{
  assert.equal($('#login-title').textContent,'Masuk');assert.equal($('#login-screen').hidden,false);assert.equal($('#workspace').hidden,true);
  await until(()=>!$('#retry-connection').hidden);assert.match($('#connection-status').textContent,/Koneksi terputus/);
  $('#retry-connection').click();await until(()=>!$('#login-submit').disabled);
  assert.equal($('#supabase-url'),null);assert.equal($('#supabase-key'),null);
  loginFails=true;$('#login-email').value='test@example.test';$('#login-password').value='wrong-password';$('#login-form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));
  await until(()=>$('#login-feedback').textContent.includes('tidak sesuai'));assert.equal($('#workspace').hidden,true);assert.equal($('#login-password').value,'');loginFails=false;
  await login();assert.equal($('#login-screen').hidden,true);assert.equal($('#account-email').textContent,'test@example.test');assert.equal($('#login-password').value,'');
});
test('one-page interface starts empty with disabled filters and no dashboard navigation',()=>{
  assert.equal($('#workspace h1').textContent,'Data Mess');assert.equal($('aside'),null);assert.equal($('nav'),null);
  assert.match($('#residents-table').textContent,/Belum ada data penghuni/);assert.equal($('#total-value').textContent,'0orang');
  assert.equal($('#process-import').disabled,true);assert.equal($('#filter-company').disabled,true);assert.equal($('#export-button').disabled,true);
  assert.equal($('#filter-company').getAttribute('aria-label'),'Filter perusahaan');
});
test('rules dialog exposes the exact business mapping and MT exception',()=>{
  $('#rules-button').click();assert.equal($('#rules-dialog').open,true);assert.match($('#rules-dialog').textContent,/S2, S3, P2, M1, M2/);assert.match($('#rules-dialog').textContent,/Management Trainee, Production termasuk MT/);
  document.querySelector('[data-close="rules-dialog"]').click();assert.equal($('#rules-dialog').open,false);
});
test('real XLSX files are matched and automatically classified, including MT, missing job, and duplicates',async()=>{
  await upload('mess',sampleFile('mess-uji.xlsx',mess));await upload('manpower',sampleFile('manpower-uji.xlsx',mp));
  assert.equal($('#process-import').disabled,false);assert.equal($('#mapping-manpower [data-mapping-field="position"]').value,'6');
  $('#process-import').click();await until(()=>$('#total-value').textContent==='9orang');
  assert.equal(document.querySelectorAll('.residents tbody tr').length,9);assert.equal(document.querySelectorAll('#residents-table img').length,0);
  assert.equal(document.querySelector('[data-count-grade="1"] b').textContent,'2');assert.equal(document.querySelector('[data-count-grade="2"] b').textContent,'2');assert.equal(document.querySelector('[data-count-grade="3"] b').textContent,'1');assert.equal(document.querySelector('[data-count-grade="MT"] b').textContent,'1');
  assert.match($('#data-notice').textContent,/3 penghuni belum mendapat golongan/);assert.match($('#data-notice').textContent,/1 NIK berulang/);
  assert.match($('#residents-table').textContent,/Jabatan P1 kosong/);assert.match($('#issues-summary').textContent,/1 baris/);assert.equal($('#export-button').disabled,false);
  assert.equal(savedRows.length,1);assert.equal(savedRows[0].counts.total,9);assert.match($('#save-status').textContent,/tersimpan/);
});
test('cascading company, department, subdepartment, and grade filters update the same result total',()=>{
  change('#filter-company','HJF');assert.equal($('#total-value').textContent,'5orang');
  assert.deepEqual([...$('#filter-department').options].slice(1).map(x=>x.value),['Equipment','Production']);
  change('#filter-department','Production');assert.equal($('#total-value').textContent,'4orang');change('#filter-subdepartment','Furnace');change('#filter-grade','MT');
  assert.equal($('#total-value').textContent,'1orang');assert.match($('#residents-table').textContent,/Management\s+Trainee, Production/);
  change('#filter-company','KPS');assert.equal($('#filter-department').value,'');assert.equal($('#filter-grade').value,'');assert.equal($('#total-value').textContent,'3orang');
  $('#reset-filters').click();assert.equal($('#total-value').textContent,'9orang');
});
test('search, review status, empty result, and reset work on the same page',()=>{
  $('#resident-search').value='crawler';$('#resident-search').dispatchEvent(new window.Event('input',{bubbles:true}));assert.equal($('#total-value').textContent,'1orang');
  $('#resident-search').value='NOT FOUND';$('#resident-search').dispatchEvent(new window.Event('input',{bubbles:true}));assert.match($('#residents-table').textContent,/Tidak ada data yang sesuai/);
  $('#empty-reset').click();change('#resident-status','review');assert.equal($('#total-value').textContent,'3orang');change('#resident-status','duplicate');assert.equal($('#total-value').textContent,'1orang');
  $('#reset-filters').click();assert.equal($('#total-value').textContent,'9orang');
});
test('recap conserves totals, includes the MT column, and follows company filtering',()=>{
  change('#filter-company','HJF');$('#recap-section').open=true;
  assert.equal($('#report-table .report-total').lastElementChild.textContent,'5');
  assert.ok([...document.querySelectorAll('#report-table th')].some(x=>x.textContent==='MT'));
  change('#report-group','department');assert.equal($('#report-table .report-total').lastElementChild.textContent,'5');assert.match($('#report-table').textContent,/Production/);
});
test('export contains current filtered records, original code, classified grade, and review details',async()=>{
  let blob;const create=URL.createObjectURL,revoke=URL.revokeObjectURL,click=window.HTMLAnchorElement.prototype.click;
  URL.createObjectURL=b=>{blob=b;return 'blob:test';};URL.revokeObjectURL=()=>{};window.HTMLAnchorElement.prototype.click=function(){};
  try{
    $('#export-button').click();await until(()=>blob!==undefined);const book=X.read(await blob.arrayBuffer(),{type:'array'}),rows=X.utils.sheet_to_json(book.Sheets.Penghuni,{header:1});
    assert.equal(rows.length,6);assert.ok(rows.slice(1).every(r=>r[2]==='HJF'));
    assert.equal(rows.find(r=>r[0]==='0002')[8],'MT');assert.equal(rows.find(r=>r[0]==='0001')[8],'2');assert.equal(rows.find(r=>r[0]==='0003')[8],'1');
    assert.equal(rows.find(r=>r[0]==='0002')[6],'P1.5');assert.ok(book.SheetNames.includes('Perlu diperiksa'));assert.ok(book.SheetNames.includes('Baris ditolak'));
  }finally{URL.createObjectURL=create;URL.revokeObjectURL=revoke;window.HTMLAnchorElement.prototype.click=click;}
});
test('storage shows the latest saved import and login restores it automatically after logout',async()=>{
  $('#storage-button').click();assert.equal($('#storage-dialog').open,true);
  await until(()=>$('#snapshot-list [data-snapshot-id]'));assert.equal($('#save-form'),null);assert.match($('#snapshot-list').textContent,/9 penghuni/);
  document.querySelector('[data-close="storage-dialog"]').click();$('#signout-button').click();await until(()=>$('#workspace').hidden);
  assert.equal($('#total-value').textContent,'0orang');assert.equal($('#login-password').value,'');
  await login();assert.equal($('#total-value').textContent,'9orang');assert.equal($('#mapping-details-mess').hidden,true);
});
test('pagination displays all unique residents with no duplicated counts',async()=>{
  const homes=[['NIK','Nama','Lokasi Mess']],people=[['NIK','Nama','Perusahaan','Department','Subdept','Gol','Jabatan']];
  for(let i=0;i<45;i++){const nik='TEST'+String(i).padStart(4,'0');homes.push([nik,'Karyawan '+i,'Mess A']);people.push([nik,'Karyawan '+i,'HJF','Production','Furnace','S1.1','Operator']);}
  await upload('mess',sampleFile('pagination-mess.xlsx',homes));await upload('manpower',sampleFile('pagination-master.xlsx',people));$('#process-import').click();await until(()=>$('#total-value').textContent==='45orang');
  assert.equal(document.querySelectorAll('.residents tbody tr').length,20);
  document.querySelector('[data-page-kind="resident"][data-page="3"]').click();assert.equal(document.querySelectorAll('.residents tbody tr').length,5);assert.equal($('#total-value').textContent,'45orang');
  assert.equal(savedRows.length,1);assert.equal(savedRows[0].counts.total,45);assert.equal(savedRows[0].mess.some(r=>r.nik==='0001'),false);
});
test('failed replacement keeps the previous data and can be retried with the same selected files',async()=>{
  await upload('mess',sampleFile('invalid-mess.xlsx',[['NIK','Nama'],['','Tanpa NIK']]));$('#process-import').click();await until(()=>$('#import-error').textContent.includes('Tidak ada NIK valid'));
  assert.equal($('#total-value').textContent,'45orang');assert.equal(savedRows.length,1);assert.equal(savedRows[0].counts.total,45);
  await upload('mess',sampleFile('replacement-mess.xlsx',[['NIK','Nama'],['NEW001','Penghuni baru']]));
  await upload('manpower',sampleFile('replacement-master.xlsx',[['NIK','Perusahaan','Department','Subdept','Gol','Jabatan'],['NEW001','HJF','Production','Furnace','S1.1','Operator']]));
  failNextSave=true;$('#process-import').click();await until(()=>$('#import-error').textContent.includes('Menyimpan gagal'));
  assert.equal($('#total-value').textContent,'45orang');assert.equal(savedRows.length,1);assert.equal(savedRows[0].counts.total,45);assert.equal($('#process-import').disabled,false);
  $('#process-import').click();await until(()=>$('#total-value').textContent==='1orang');assert.equal(savedRows.length,1);assert.equal(savedRows[0].mess[0].nik,'NEW001');
});
test('cleanup failure is visible and retry removes old data without inserting another copy',async()=>{
  await upload('mess',sampleFile('cleanup-mess.xlsx',[['NIK','Nama'],['NEW002','Penghuni berikutnya']]));
  failNextCleanup=true;$('#process-import').click();await until(()=>!$('#cleanup-notice').hidden);assert.equal(savedRows.length,2);
  const latestId=savedRows.at(-1).id;$('#retry-cleanup').click();await until(()=>$('#cleanup-notice').hidden);
  assert.equal(savedRows.length,1);assert.equal(savedRows[0].id,latestId);assert.equal(savedRows[0].mess[0].nik,'NEW002');
});
test('legacy database still works until the shared database update is applied',async()=>{
  $('#signout-button').click();await until(()=>$('#workspace').hidden);await login('other@example.test');
  assert.equal($('#total-value').textContent,'0orang');assert.match($('#residents-table').textContent,/Belum ada data penghuni/);assert.equal($('#file-mess').value,'');
  assert.equal(savedRows.length,1);assert.equal(savedRows[0].user_id,'test-user');
  assert.match($('#data-access-notice').textContent,/Data bersama belum aktif/);
});
test('activating shared access loads the same data from another account',async()=>{
  sharedMode=true;$('#refresh-data').click();await until(()=>$('#total-value').textContent==='1orang'&&!$('#file-mess').disabled);
  assert.equal($('#data-access-notice').hidden,true);assert.match($('#residents-table').textContent,/NEW002/);assert.equal($('#last-updated').hidden,false);
});
test('another registered account replaces shared data and the first account sees the replacement',async()=>{
  await upload('mess',sampleFile('shared-mess.xlsx',[['NIK','Nama'],['TEAM001','Data bersama']]));
  await upload('manpower',sampleFile('shared-master.xlsx',[['NIK','Perusahaan','Department','Subdept','Gol','Jabatan'],['TEAM001','HJF','Production','Furnace','S1.1','Operator']]));
  $('#process-import').click();await until(()=>$('#residents-table').textContent.includes('TEAM001'));assert.equal(savedRows.length,1);assert.equal(savedRows[0].user_id,'other-user');assert.match($('#save-status').textContent,/Data bersama/);
  $('#signout-button').click();await until(()=>$('#workspace').hidden);await login();assert.match($('#residents-table').textContent,/TEAM001/);assert.equal(savedRows.length,1);
});
test('failed shared transaction keeps the old shared data and supports retry',async()=>{
  await upload('mess',sampleFile('shared-retry.xlsx',[['NIK','Nama'],['TEAM002','Pengganti bersama']]));
  await upload('manpower',sampleFile('shared-retry-master.xlsx',[['NIK','Perusahaan','Department','Subdept','Gol','Jabatan'],['TEAM002','HJF','Production','Furnace','S1.1','Operator']]));
  failSharedSave=true;$('#process-import').click();await until(()=>$('#import-error').textContent.includes('Transaksi gagal'));
  assert.match($('#residents-table').textContent,/TEAM001/);assert.equal(savedRows[0].mess[0].nik,'TEAM001');assert.equal(savedRows.length,1);
  $('#process-import').click();await until(()=>$('#residents-table').textContent.includes('TEAM002'));assert.equal(savedRows.length,1);assert.equal($('#cleanup-notice').hidden,true);
});
test('New hire cutoff, active precedence, warnings, and the filtered export survive a shared import',async()=>{
  const row=(nik,name,date,room='01')=>[nik,name,'L','Equipment','P1.4','Operator','PT. HJF','Camp','B',room,date];
  await upload('mess',sampleFile('intake-mess.xlsx',[
    ['Database hunian'],
    ['N I K','N A M A','GENDER','DEPARTMENT','GOL','J A B A T A N','PERUSAHAAN','LOKASI HUNIAN','BLOCK','NO KAMAR','TANGGAL MASUK MESS HUNIAN P2'],
    row('F05230005','Aktif Belum Onsite','Belum Onsite'),
    row('F01260004','Aktif Tanggal Kosong',''),
    row('F10260001','Batas Oktober','Belum Onsite'),
    row('T112600000002','Rekrutan November','Belum Onsite'),
    row('T112600000002','Rekrutan November','Belum Onsite','02'),
    row('F12250003','NIK Lama','Belum Onsite'),
    row('F13260006','Bulan Tidak Valid',''),
    row('','Rekrutan Tanpa NIK','Belum Onsite'),
    row('','','','03'),
    ['','Rekrutan Tidak Lengkap']
  ]));
  await upload('manpower',sampleFile('intake-manpower.xlsx',[
    ['NIK','Perusahaan','Department','Subdept','Gol','Jabatan'],
    ['F05230005','KPS','Quality','Lab','S4.9','Lead'],
    ['F01260004','HJF','Production','Furnace','S1.1','Operator']
  ]));
  change('#new-hire-since','');assert.equal($('#process-import').disabled,true);
  change('#new-hire-since','2026-10');$('#process-import').click();await until(()=>$('#total-value').textContent==='7orang');
  assert.match($('#data-source').textContent,/2 karyawan aktif · 3 New hire/);
  assert.match($('#issues-summary').textContent,/1 baris/);
  change('#resident-status','active');assert.equal($('#total-value').textContent,'2orang');
  assert.match($('#residents-table').textContent,/Aktif Belum Onsite/);
  assert.match($('#residents-table').textContent,/Aktif Tanggal Kosong/);
  assert.match($('#residents-table').textContent,/KPS/);
  change('#resident-status','new-hire');assert.equal($('#total-value').textContent,'3orang');
  assert.equal($('#report-table .report-total').lastElementChild.textContent,'3');
  assert.match($('#residents-table').textContent,/Belum ada NIK/);
  assert.doesNotMatch($('#residents-table').textContent,/NIK Lama/);
  change('#resident-status','review');assert.equal($('#total-value').textContent,'2orang');
  assert.match($('#residents-table').textContent,/Desember 2025 sebelum batas Oktober 2026/);
  assert.match($('#residents-table').textContent,/Bulan dan tahun masuk tidak terbaca/);

  change('#new-hire-since','2026-11');assert.equal($('#process-import').disabled,false);
  $('#process-import').click();await until(()=>savedRows[0].source_info.newHireSince==='2026-11'&&$('#process-import').disabled);
  change('#resident-status','new-hire');assert.equal($('#total-value').textContent,'2orang');
  let blob;const create=URL.createObjectURL,revoke=URL.revokeObjectURL,click=window.HTMLAnchorElement.prototype.click;
  URL.createObjectURL=b=>{blob=b;return 'blob:intake-test';};URL.revokeObjectURL=()=>{};window.HTMLAnchorElement.prototype.click=function(){};
  try{
    $('#export-button').click();await until(()=>blob!==undefined);
    const book=X.read(await blob.arrayBuffer(),{type:'array'});
    const rows=X.utils.sheet_to_json(book.Sheets.Penghuni,{header:1,defval:''});
    assert.equal(rows.length,3);
    const noNik=rows.find(r=>r[1]==='Rekrutan Tanpa NIK');
    assert.equal(noNik[0],'');assert.equal(noNik[2],'HJF');assert.equal(noNik[8],'1');assert.equal(noNik[14],'New hire');assert.equal(noNik[16],'Belum Onsite');
    assert.ok(rows.slice(1).every(r=>r[14]==='New hire'));
  }finally{URL.createObjectURL=create;URL.revokeObjectURL=revoke;window.HTMLAnchorElement.prototype.click=click;}

  $('#signout-button').click();await until(()=>$('#workspace').hidden);
  await login('other@example.test');assert.equal($('#new-hire-since').value,'2026-11');
  change('#resident-status','new-hire');assert.equal($('#total-value').textContent,'2orang');
  assert.match($('#residents-table').textContent,/Rekrutan Tanpa NIK/);
  assert.doesNotMatch($('#residents-table').textContent,/NEW-HIRE-ROW:/);
});
test('the cutoff is checked before mess dates and duplicate manpower uses only its top row',async()=>{
  const row=(nik,name,date)=>[nik,name,'L','Dispatch','P1.4','Operator','PT. HJF','Camp','A','1',date];
  const excelDate={t:'n',v:(Date.UTC(2026,10,3)-Date.UTC(1899,11,30))/86400000,z:'dd "masuk" mmmm yyyy'};
  await upload('mess',sampleFile('active-date-mess.xlsx',[
    ['NIK','Nama','Gender','Department','Gol','Jabatan','Perusahaan','Lokasi Mess','Block','No Kamar','Tanggal Masuk Mess Hunian P2'],
    row('F01260001','Manpower Pertama','Belum Onsite'),
    row('F05230002','Periksa Tanggal Excel',excelDate),
    row('S11260003','Aktif Dari Tanggal Teks','Tuesday, 03 November 2026'),
    row('T112600000004','New Hire Tanpa Tanggal','Belum Onsite'),
    row('F09260005','Tanggal Tidak Sah','31/02/2026'),
    row('F10260006','Aktif Batas Oktober',{...excelDate})
  ]));
  await upload('manpower',sampleFile('active-date-master.xlsx',[
    ['NIK','Perusahaan','Department','Subdept','Gol','Jabatan'],
    ['F01260001','KPS','Quality','Lab','S3.7','Translator'],
    ['F01260001','OST','Production','Furnace','P1.5','Management Trainee, Production']
  ]));
  change('#new-hire-since','2026-10');$('#process-import').click();
  await until(()=>$('#total-value').textContent==='6orang'&&!$('#export-button').disabled);
  assert.match($('#data-source').textContent,/3 karyawan aktif · 1 New hire/);
  assert.doesNotMatch($('#residents-table').textContent,/Satu NIK memiliki referensi manpower/);
  change('#resident-status','review');assert.equal($('#total-value').textContent,'2orang');
  assert.match($('#residents-table').textContent,/Periksa Tanggal Excel/);
  assert.match($('#residents-table').textContent,/Mei 2023 sebelum batas Oktober 2026/);
  change('#resident-status','active');assert.equal($('#total-value').textContent,'3orang');
  assert.equal($('#report-table .report-total').lastElementChild.textContent,'3');
  assert.match($('#residents-table').textContent,/KPS/);assert.match($('#residents-table').textContent,/Quality/);
  assert.doesNotMatch($('#residents-table').textContent,/OST|Tanggal Tidak Sah|New Hire Tanpa Tanggal|Periksa Tanggal Excel/);
  assert.equal(document.querySelector('[data-count-grade="1"] b').textContent,'2');
  assert.equal(document.querySelector('[data-count-grade="2"] b').textContent,'1');
  assert.equal($('#data-notice').hidden,true);
  $('#refresh-data').click();await until(()=>!$('#file-mess').disabled&&$('#new-hire-since').value==='2026-10');
  change('#resident-status','active');assert.equal($('#total-value').textContent,'3orang');
  let blob;const create=URL.createObjectURL,revoke=URL.revokeObjectURL,click=window.HTMLAnchorElement.prototype.click;
  URL.createObjectURL=b=>{blob=b;return 'blob:active-date';};URL.revokeObjectURL=()=>{};window.HTMLAnchorElement.prototype.click=function(){};
  try{
    $('#export-button').click();await until(()=>blob!==undefined);
    const book=X.read(await blob.arrayBuffer(),{type:'array'}),rows=X.utils.sheet_to_json(book.Sheets.Penghuni,{header:1,defval:''});
    assert.equal(rows.length,4);assert.ok(rows.slice(1).every(r=>r[14]==='Karyawan aktif'));
    assert.equal(rows.find(r=>r[0]==='F01260001')[2],'KPS');
    assert.equal(rows.find(r=>r[0]==='F05230002'),undefined);
    assert.equal(rows.find(r=>r[0]==='F10260006')[2],'HJF');
    assert.equal(rows.find(r=>r[0]==='F10260006')[8],'1');
  }finally{URL.createObjectURL=create;URL.revokeObjectURL=revoke;window.HTMLAnchorElement.prototype.click=click;}
});
test('refresh loads a newer import from another user and blocked accounts lose data access',async()=>{
  savedRows[0]={...savedRows[0],mess:[{nik:'REFRESH001',name:'Dari pengguna lain'}],user_id:'other-user',created_at:'2026-10-22T12:00:00.000Z'};
  $('#refresh-data').click();await until(()=>$('#residents-table').textContent.includes('REFRESH001'));assert.match($('#last-updated').textContent,/Terakhir diperbarui/);
  sharedAllowed=false;$('#refresh-data').click();await until(()=>$('#total-value').textContent==='0orang'&&$('#refresh-data').disabled===false);
  assert.match($('#data-access-notice').textContent,/belum diberi akses/);assert.equal($('#file-mess').disabled,true);assert.equal($('#process-import').disabled,true);assert.equal(savedRows.length,1);
});
after(()=>{globalThis.setTimeout=originalTimeout;dom.window.close();});
