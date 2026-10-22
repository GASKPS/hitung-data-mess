import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import * as X from '../dist/assets/xlsx.mjs';
const dom=new JSDOM(readFileSync(new URL('../dist/index.html',import.meta.url),'utf8'),{url:'https://example.test/mess-insight/',pretendToBeVisual:true,runScripts:'outside-only'});
const {window}=dom;Object.assign(globalThis,{window,document:window.document,location:window.location,localStorage:window.localStorage});
window.confirm=()=>true;
window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};window.HTMLDialogElement.prototype.close=function(){this.open=false;};
const originalTimeout=globalThis.setTimeout;
globalThis.setTimeout=(fn,delay,...args)=>{const timer=originalTimeout(fn,delay,...args);if(delay>=1000)timer.unref();return timer;};
await import('../dist/app.js');
const $=selector=>document.querySelector(selector);
const pause=ms=>new Promise(resolve=>originalTimeout(resolve,ms));
async function until(condition){for(let i=0;i<150;i++){if(condition())return;await pause(10);}throw new Error('DOM state did not settle');}
function change(selector,value){$(selector).value=value;$(selector).dispatchEvent(new window.Event('change',{bubbles:true}));}
function sampleFile(name,rows){const wb=X.utils.book_new();X.utils.book_append_sheet(wb,X.utils.aoa_to_sheet(rows),'Data');const bytes=X.write(wb,{type:'buffer',bookType:'xlsx'});return {name,size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};}
async function upload(type,file){Object.defineProperty($(`#file-${type}`),'files',{configurable:true,value:[file]});$(`#file-${type}`).dispatchEvent(new window.Event('change',{bubbles:true}));await until(()=>$(`#file-${type}-status`).textContent.includes(file.name));}
const mess=[['Database hunian'],['NIK','Nama','Lokasi Mess','Blok','No Kamar'],
  ['0001','<img src=x onerror=alert(1)>','Surya','A','101'],['0002','MT Production','Surya','A','102'],['0003','Crane Operator','Meranti','B','201'],
  ['0004','Operator KPS','Surya','A','103'],['0005','Lead KPS','Surya','A','104'],['0006','Tanpa Jabatan','Surya','A','105'],
  ['0007','Kode Baru','Surya','A','106'],['0008','Referensi Berbeda','Surya','A','107'],['UNKNOWN','Belum Ada','Surya','A','108'],['0001','Duplikat','Meranti','B','202'],['','NIK Kosong','Surya','A','109']];
const mp=[['Manpower'],['NIK','Nama','COST CENTER','Department','Subdept','Gol','Jabatan'],
  ['0001','A','HJF','Production','Furnace','S3.7','Translator'],['0002','B','HJF','Production','Furnace','P1.5','Management   Trainee, Production'],
  ['0003','C','HJF','Equipment','Operations','P1.5','Crawler Crane Operator'],['0004','D','KPS','Quality','Laboratory','M1.5','Operator'],
  ['0005','E','KPS','Quality','Laboratory','S4.9','Lead'],['0006','F','KPS','Quality','Laboratory','P1.4',''],
  ['0007','G','HJF','Production','Furnace','P9.1','Operator'],['0008','H','HJF','Production','Furnace','S1.1','Operator'],['0008','H','KPS','Production','Furnace','S1.1','Operator']];

test('one-page interface starts empty with disabled filters and no dashboard navigation',()=>{
  assert.equal($('h1').textContent,'Data Mess');assert.equal($('aside'),null);assert.equal($('nav'),null);
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
  assert.equal(document.querySelector('[data-count-grade="1"] b').textContent,'1');assert.equal(document.querySelector('[data-count-grade="2"] b').textContent,'2');assert.equal(document.querySelector('[data-count-grade="3"] b').textContent,'1');assert.equal(document.querySelector('[data-count-grade="MT"] b').textContent,'1');
  assert.match($('#data-notice').textContent,/4 penghuni belum mendapat golongan/);assert.match($('#data-notice').textContent,/1 NIK berulang/);
  assert.match($('#residents-table').textContent,/Jabatan P1 kosong/);assert.match($('#issues-summary').textContent,/1 baris/);assert.equal($('#export-button').disabled,false);
});
test('cascading company, department, subdepartment, and grade filters update the same result total',()=>{
  change('#filter-company','HJF');assert.equal($('#total-value').textContent,'4orang');
  assert.deepEqual([...$('#filter-department').options].slice(1).map(x=>x.value),['Equipment','Production']);
  change('#filter-department','Production');assert.equal($('#total-value').textContent,'3orang');change('#filter-subdepartment','Furnace');change('#filter-grade','MT');
  assert.equal($('#total-value').textContent,'1orang');assert.match($('#residents-table').textContent,/Management\s+Trainee, Production/);
  change('#filter-company','KPS');assert.equal($('#filter-department').value,'');assert.equal($('#filter-grade').value,'');assert.equal($('#total-value').textContent,'3orang');
  $('#reset-filters').click();assert.equal($('#total-value').textContent,'9orang');
});
test('search, review status, empty result, and reset work on the same page',()=>{
  $('#resident-search').value='crawler';$('#resident-search').dispatchEvent(new window.Event('input',{bubbles:true}));assert.equal($('#total-value').textContent,'1orang');
  $('#resident-search').value='NOT FOUND';$('#resident-search').dispatchEvent(new window.Event('input',{bubbles:true}));assert.match($('#residents-table').textContent,/Tidak ada data yang sesuai/);
  $('#empty-reset').click();change('#resident-status','review');assert.equal($('#total-value').textContent,'4orang');change('#resident-status','duplicate');assert.equal($('#total-value').textContent,'1orang');
  $('#reset-filters').click();assert.equal($('#total-value').textContent,'9orang');
});
test('recap conserves totals, includes the MT column, and follows company filtering',()=>{
  change('#filter-company','HJF');$('#recap-section').open=true;
  assert.equal($('#report-table .report-total').lastElementChild.textContent,'4');
  assert.ok([...document.querySelectorAll('#report-table th')].some(x=>x.textContent==='MT'));
  change('#report-group','department');assert.equal($('#report-table .report-total').lastElementChild.textContent,'4');assert.match($('#report-table').textContent,/Production/);
});
test('export contains current filtered records, original code, classified grade, and review details',async()=>{
  let blob;const create=URL.createObjectURL,revoke=URL.revokeObjectURL,click=window.HTMLAnchorElement.prototype.click;
  URL.createObjectURL=b=>{blob=b;return 'blob:test';};URL.revokeObjectURL=()=>{};window.HTMLAnchorElement.prototype.click=function(){};
  try{
    $('#export-button').click();await until(()=>blob!==undefined);const book=X.read(await blob.arrayBuffer(),{type:'array'}),rows=X.utils.sheet_to_json(book.Sheets.Penghuni,{header:1});
    assert.equal(rows.length,5);assert.ok(rows.slice(1).every(r=>r[2]==='HJF'));
    assert.equal(rows.find(r=>r[0]==='0002')[8],'MT');assert.equal(rows.find(r=>r[0]==='0001')[8],'2');assert.equal(rows.find(r=>r[0]==='0003')[8],'1');
    assert.equal(rows.find(r=>r[0]==='0002')[6],'P1.5');assert.ok(book.SheetNames.includes('Perlu diperiksa'));assert.ok(book.SheetNames.includes('Baris ditolak'));
  }finally{URL.createObjectURL=create;URL.revokeObjectURL=revoke;window.HTMLAnchorElement.prototype.click=click;}
});
test('storage configuration is tucked away and rejects secret keys without changing the data',async()=>{
  $('#storage-button').click();assert.equal($('#storage-dialog').open,true);$('#supabase-url').value='https://example.supabase.co';$('#supabase-key').value='sb_secret_not_a_public_key';
  $('#connection-form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));await until(()=>$('#connection-feedback').textContent.includes('bukan secret'));
  assert.equal($('#total-value').textContent,'4orang');document.querySelector('[data-close="storage-dialog"]').click();
});
test('pagination displays all unique residents with no duplicated counts',async()=>{
  const homes=[['NIK','Nama','Lokasi Mess']],people=[['NIK','Nama','Perusahaan','Department','Subdept','Gol','Jabatan']];
  for(let i=0;i<45;i++){const nik='TEST'+String(i).padStart(4,'0');homes.push([nik,'Karyawan '+i,'Mess A']);people.push([nik,'Karyawan '+i,'HJF','Production','Furnace','S1.1','Operator']);}
  await upload('mess',sampleFile('pagination-mess.xlsx',homes));await upload('manpower',sampleFile('pagination-master.xlsx',people));$('#process-import').click();await until(()=>$('#total-value').textContent==='45orang');
  assert.equal(document.querySelectorAll('.residents tbody tr').length,20);
  document.querySelector('[data-page-kind="resident"][data-page="3"]').click();assert.equal(document.querySelectorAll('.residents tbody tr').length,5);assert.equal($('#total-value').textContent,'45orang');
});
after(()=>{globalThis.setTimeout=originalTimeout;dom.window.close();});
