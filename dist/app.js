import {UNKNOWN,STATUS,GRADE_RULES,CLASSIFICATION_VERSION,collator,text,normalizeNik,normalizeHeader,suggestMapping,mapRows,reconcile,makeEmpty,filterResidents,filterOptions,summary,buildReport,gradeName,escapeHtml as e} from './core.js';
import {readWorkbook,setSheet,setHeader,headers,downloadTemplate,exportWorkbook} from './workbook.js';
import * as cloud from './cloud.js';

const $=selector=>document.querySelector(selector);
const fmt=value=>new Intl.NumberFormat('id-ID').format(value);
const date=value=>new Intl.DateTimeFormat('id-ID',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Jayapura'}).format(new Date(value));
const freshFilters=()=>({company:'',department:'',subdepartment:'',grade:''});
const fieldNames={nik:'NIK',name:'Nama',company:'Perusahaan',department:'Departemen',subdepartment:'Subdepartemen',grade:'Kode golongan',position:'Jabatan',location:'Lokasi mess',block:'Blok',room:'No. kamar'};
const state={data:makeEmpty(),files:{mess:null,manpower:null},requests:{mess:0,manpower:0},loading:0,busy:false,restoring:false,dirty:false,pendingFiles:false,filters:freshFilters(),query:'',status:'',page:1,reportGroup:'company',reportPage:1,activeUser:null,cleanupPending:null,lastUpdated:null};
const pageSize=20;
const selectedRows=()=>filterResidents(state.data.residents,state.filters,state.query,state.status);
let toastTimer,historyRequest=0,restoreRequest=0,authEpoch=0;
let storageStatus='connecting',storageError='',authBusy=false;

function toast(message,error=false){
  clearTimeout(toastTimer);const node=$('#toast');node.textContent=message;node.classList.toggle('error',error);node.hidden=false;toastTimer=setTimeout(()=>node.hidden=true,error?9000:5500);
}
function importError(message){$('#import-error').textContent=message;$('#import-error').hidden=!message;}
function feedback(selector,message,error=false){const node=$(selector);if(node)node.innerHTML=`<p class="notice ${error?'error':'success'}">${e(message)}</p>`;}
async function withButton(button,work,label='Memproses…'){
  if(button.disabled)return;const original=button.textContent;button.disabled=true;button.textContent=label;
  try{await work();}catch(error){toast(error.message,true);}finally{if(button.isConnected){button.disabled=false;button.textContent=original;}}
}
function updateSaveStatus(){
  $('#storage-button').title=cloud.session?'Terhubung ke Supabase':'Simpan atau buka data melalui Supabase';
  $('#save-status').textContent=state.data.mode==='empty'?'File dibaca setelah Anda memilih Tampilkan data.':state.cleanupPending?'Data baru tersimpan; penghapusan data lama belum selesai.':cloud.access.mode==='shared'?'Data bersama tersimpan di Supabase.':'Data tersimpan di Supabase.';
  $('#cleanup-notice').hidden=!state.cleanupPending;
}
function renderFilters(){
  const labels={company:'Semua perusahaan',department:'Semua departemen',subdepartment:'Semua subdepartemen',grade:'Semua golongan'};
  for(const field of Object.keys(labels)){
    const options=filterOptions(state.data.residents,state.filters,field),select=$(`#filter-${field}`);
    if(state.filters[field]&&!options.includes(state.filters[field]))state.filters[field]='';
    select.innerHTML=`<option value="">${labels[field]}</option>`+options.map(v=>`<option value="${e(v)}">${e(field==='grade'?v===UNKNOWN?'Belum ada golongan':gradeName(v):v)}</option>`).join('');
    select.value=state.filters[field];select.disabled=!state.data.residents.length;
  }
  $('#reset-filters').disabled=!Object.values(state.filters).some(Boolean)&&!state.query&&!state.status;
}
function renderCounts(rows){
  const counts=Object.fromEntries(['1','2','3','4','5','MT'].map(g=>[g,0]));for(const row of rows)if(Object.hasOwn(counts,row.grade))counts[row.grade]++;
  const filtered=Object.values(state.filters).some(Boolean)||state.query||state.status;
  $('#counts').innerHTML=`<div class="total-count"><span>${filtered?'Penghuni sesuai filter':'Total penghuni mess'}</span><strong id="total-value">${fmt(rows.length)}<small>orang</small></strong></div><div class="grade-counts">${Object.entries(counts).map(([g,n])=>`<button type="button" class="grade-count${state.filters.grade===g?' active':''}" data-count-grade="${g}" aria-pressed="${state.filters.grade===g}" aria-label="${gradeName(g)}: ${n} penghuni"${!state.data.residents.length?' disabled':''}><span>${g==='MT'?'MT':`Golongan ${g}`}</span><b>${fmt(n)}</b></button>`).join('')}</div>`;
  $('#counts').querySelectorAll('[data-count-grade]').forEach(button=>button.onclick=()=>{state.filters.grade=state.filters.grade===button.dataset.countGrade?'':button.dataset.countGrade;state.page=1;state.reportPage=1;renderResults();});
}
function noteFor(row){
  if(row.status==='unmatched')return 'NIK tidak ditemukan di manpower.';
  if(row.status==='ambiguous')return 'Satu NIK memiliki referensi manpower yang berbeda.';
  if(row.classificationReason)return row.classificationReason;
  if(row.incomplete)return 'Perusahaan, departemen, atau subdepartemen belum lengkap.';
  return '';
}
function renderNotice(rows){
  const node=$('#data-notice'),review=rows.filter(r=>r.needsReview).length,unknown=rows.filter(r=>!r.grade).length,duplicates=rows.filter(r=>r.messOccurrences>1).length;
  const parts=[];
  if(unknown)parts.push(`${fmt(unknown)} penghuni belum mendapat golongan.`);
  if(review)parts.push(`<button type="button" id="review-data">Periksa ${fmt(review)} penghuni</button>.`);
  if(duplicates)parts.push(`${fmt(duplicates)} NIK berulang di data mess, tetap dihitung satu kali.`);
  node.innerHTML=parts.join(' ');node.hidden=!parts.length;
  if($('#review-data'))$('#review-data').onclick=()=>{state.status='review';$('#resident-status').value='review';state.page=1;state.reportPage=1;renderResults();};
}
function pagination(page,pages,kind){
  const visible=[...new Set([1,page-1,page,page+1,pages])].filter(n=>n>0&&n<=pages).sort((a,b)=>a-b);let last=0;
  return `<div class="pagination"><button type="button" class="page-button" data-page-kind="${kind}" data-page="${page-1}" aria-label="Halaman sebelumnya"${page===1?' disabled':''}>‹</button>${visible.map(n=>{const gap=n-last>1?'<span aria-hidden="true">…</span>':'';last=n;return `${gap}<button type="button" class="page-button${n===page?' active':''}" data-page-kind="${kind}" data-page="${n}"${n===page?' aria-current="page"':''}>${n}</button>`;}).join('')}<button type="button" class="page-button" data-page-kind="${kind}" data-page="${page+1}" aria-label="Halaman berikutnya"${page===pages?' disabled':''}>›</button></div>`;
}
function bindPagination(root){root.querySelectorAll('[data-page-kind]').forEach(button=>button.onclick=()=>{if(button.dataset.pageKind==='report'){state.reportPage=Number(button.dataset.page);renderReport(selectedRows());}else{state.page=Number(button.dataset.page);renderResidentTable(selectedRows());}});}
function renderResidentTable(rows){
  const root=$('#residents-table');$('#list-count').textContent=`${fmt(rows.length)} penghuni`;
  if(!rows.length){
    const empty=state.data.mode==='empty';
    root.innerHTML=`<div class="empty"><strong>${empty?'Belum ada data penghuni':'Tidak ada data yang sesuai'}</strong><p>${empty?'Pilih file data mess dan manpower, lalu klik Tampilkan data.':'Ubah pencarian atau filter untuk melihat penghuni lainnya.'}</p>${empty?'':'<button type="button" class="text-button" id="empty-reset">Reset semua filter</button>'}</div>`;
    if($('#empty-reset'))$('#empty-reset').onclick=resetFilters;return;
  }
  const sorted=[...rows].sort((a,b)=>collator.compare(a.name,b.name)||collator.compare(a.nik,b.nik));
  const pages=Math.max(1,Math.ceil(sorted.length/pageSize));state.page=Math.min(state.page,pages);const start=(state.page-1)*pageSize;
  root.innerHTML=`<div class="table-scroll"><table class="residents"><thead><tr><th scope="col">Nama / NIK</th><th scope="col">Perusahaan</th><th scope="col">Departemen</th><th scope="col">Subdepartemen</th><th scope="col">Jabatan</th><th scope="col">Golongan</th><th scope="col">Lokasi mess</th><th scope="col">Keterangan</th></tr></thead><tbody>${sorted.slice(start,start+pageSize).map(r=>{
    const note=noteFor(r);return `<tr><td class="person-name">${e(r.name)}<span class="nik">${e(r.nik)}</span></td><td class="company-cell">${e(r.company)||'—'}</td><td>${e(r.department)||'—'}</td><td>${e(r.subdepartment)||'—'}</td><td class="job-cell">${e(r.position)||'—'}</td><td class="grade-cell${r.grade?'':' unclassified'}">${e(r.grade)||'Periksa'}${r.gradeRaw?`<span class="secondary-text">${e(r.gradeRaw)}</span>`:''}</td><td>${e(r.locations.join(', '))||'—'}${r.rooms.length?`<span class="secondary-text">${e(r.rooms.join(', '))}</span>`:''}</td><td class="remark${r.status==='ambiguous'?' error':note?' warning':''}">${note?e(note):'Cocok'}${r.messOccurrences>1?`<span class="secondary-text">${r.messOccurrences} baris mess → 1 penghuni</span>`:''}</td></tr>`;}).join('')}</tbody></table></div><div class="table-footer"><span>${fmt(start+1)}–${fmt(Math.min(start+pageSize,rows.length))} dari ${fmt(rows.length)} penghuni</span>${pagination(state.page,pages,'resident')}</div>`;
  bindPagination(root);
}
function renderReport(rows){
  const root=$('#report-table'),report=buildReport(rows,state.reportGroup),pages=Math.max(1,Math.ceil(report.rows.length/pageSize));state.reportPage=Math.min(state.reportPage,pages);const start=(state.reportPage-1)*pageSize;
  root.innerHTML=`<div class="table-scroll"><table><thead><tr>${report.headers.map((h,i)=>`<th scope="col"${i?' class="table-number"':''}>${e(h===UNKNOWN?'Belum ada golongan':h)}</th>`).join('')}</tr></thead><tbody>${report.rows.slice(start,start+pageSize).map(row=>`<tr>${row.map((v,i)=>`<td${i?' class="table-number"':''}>${typeof v==='number'?fmt(v):e(v)}</td>`).join('')}</tr>`).join('')}<tr class="report-total">${report.totals.map((v,i)=>`<td${i?' class="table-number"':''}>${typeof v==='number'?fmt(v):e(v)}</td>`).join('')}</tr></tbody></table></div>${pages>1?`<div class="table-footer" style="padding:12px 15px"><span>${fmt(report.rows.length)} kelompok</span>${pagination(state.reportPage,pages,'report')}</div>`:''}`;
  bindPagination(root);
}
function renderIssues(){
  const invalid=state.data.invalid;$('#issues-section').hidden=!invalid.length;
  if(!invalid.length)return;
  $('#issues-summary').textContent=`${fmt(invalid.length)} baris tidak dimasukkan — lihat rincian`;
  $('#issues-table').innerHTML=`<div class="table-scroll"><table><thead><tr><th>Sumber</th><th>Baris Excel</th><th>Nama</th><th>Alasan</th></tr></thead><tbody>${invalid.slice(0,200).map(r=>`<tr><td>${r.source==='mess'?'Mess':'Manpower'}</td><td>${r.row}</td><td>${e(r.name)||'—'}</td><td>${e(r.reason)}</td></tr>`).join('')}</tbody></table></div>${invalid.length>200?'<p class="issues-note">200 baris pertama. Rincian lengkap ada di unduhan Excel.</p>':''}`;
}
function renderResults(){
  renderFilters();const rows=selectedRows();renderCounts(rows);renderNotice(rows);renderResidentTable(rows);renderReport(rows);renderIssues();
  $('#recap-section').hidden=!state.data.residents.length;
  $('#export-button').disabled=!state.data.residents.length;
  $('#resident-search').disabled=!state.data.residents.length;$('#resident-status').disabled=!state.data.residents.length;
  $('#data-source').textContent=state.data.mode==='empty'?'Belum ada data yang diproses.':`${fmt(state.data.residents.length)} NIK unik · ${fmt(summary(state.data.residents).matched)} cocok dengan manpower`;
  $('#last-updated').hidden=!state.lastUpdated;$('#last-updated').textContent=state.lastUpdated?`Terakhir diperbarui ${date(state.lastUpdated)} WIT`:'';
  updateSaveStatus();
}
function resetFilters(){state.filters=freshFilters();state.query='';state.status='';state.page=1;state.reportPage=1;$('#resident-search').value='';$('#resident-status').value='';renderResults();}
function fieldList(type){return type==='mess'?['nik','name','location','block','room']:['nik','name','company','department','subdepartment','grade','position'];}
function mappingError(type){
  const source=state.files[type];if(!source)return `Pilih file ${type==='mess'?'data mess':'manpower'} terlebih dahulu.`;
  const required=type==='mess'?['nik']:['nik','department','subdepartment','grade'];
  const missing=required.filter(field=>source.mapping[field]<0);
  if(missing.length)return `Pilih kolom ${missing.map(f=>fieldNames[f]).join(', ')} pada data ${type==='mess'?'mess':'manpower'}.`;
  if(type==='manpower'&&source.mapping.company<0&&!text(source.company))return 'Pilih kolom perusahaan atau isi nama perusahaan pada data manpower.';
  const indexes=fieldList(type).map(f=>source.mapping[f]).filter(n=>n>=0);
  if(new Set(indexes).size!==indexes.length)return `Satu kolom pada data ${type} dipilih lebih dari sekali. Periksa pemetaan kolom.`;
  return '';
}
function updateUpload(){
  const both=state.files.mess&&state.files.manpower,locked=!cloud.session||!cloud.access.allowed||state.busy||state.restoring;
  $('#process-import').disabled=!both||state.loading>0||locked||!state.pendingFiles;
  for(const type of ['mess','manpower']){$(`#file-${type}`).disabled=locked;$(`#mapping-${type}`).querySelectorAll('input,select').forEach(input=>input.disabled=locked);}
  $('#signout-button').disabled=state.busy;
  $('#refresh-data').disabled=!cloud.session||state.busy||state.restoring;
  $('#upload-help').textContent=state.restoring?'Memuat data terakhir…':state.loading?'Sedang membaca file…':state.busy?'Mencocokkan dan menyimpan data…':!both?'Pilih kedua file untuk mulai.':state.pendingFiles?'File siap. Klik Tampilkan data.':'Data sudah diproses dan disimpan.';
}
function renderMapping(type){
  const source=state.files[type];if(!source)return;const hs=headers(source),root=$(`#mapping-${type}`),details=$(`#mapping-details-${type}`);
  const options=value=>`<option value="-1">Tidak dipilih</option>`+hs.map((h,i)=>`<option value="${i}"${i===value?' selected':''}>${e(h)}</option>`).join('');
  const required=type==='mess'?['nik']:['nik','department','subdepartment','grade'];
  root.innerHTML=`<label>Sheet<select data-sheet="${type}">${source.workbook.SheetNames.map(n=>`<option${n===source.sheet?' selected':''}>${e(n)}</option>`).join('')}</select></label><label>Baris judul<select data-header="${type}">${source.rows.slice(0,40).map((r,i)=>`<option value="${i}"${i===source.headerIndex?' selected':''}>${i+1}: ${e(r.filter(v=>text(v)).slice(0,2).join(' / ').slice(0,48))}</option>`).join('')}</select></label>${fieldList(type).map(f=>`<label>${fieldNames[f]}${required.includes(f)?' *':''}<select data-mapping-field="${f}">${options(source.mapping[f]??-1)}</select></label>`).join('')}${type==='manpower'&&source.mapping.company<0?`<label class="full">Nama perusahaan untuk seluruh file *<input id="static-company" placeholder="Contoh: HJF" value="${e(source.company||'')}"></label>`:''}${type==='manpower'&&normalizeHeader(hs[source.mapping.company]||'')==='costcenter'?'<p class="mapping-note warning">Cost Center dipakai sebagai perusahaan. Pastikan isinya memang perusahaan.</p>':''}${type==='manpower'?'<p class="mapping-note">Jabatan diperlukan untuk membedakan P1 biasa dan Management Trainee. P1 tanpa jabatan akan ditandai untuk diperiksa.</p>':''}`;
  details.hidden=false;
  root.querySelector('[data-sheet]').onchange=event=>{try{setSheet(source,event.target.value);state.pendingFiles=true;renderMapping(type);updateFileStatus(type);updateUpload();importError('');}catch(error){importError(error.message);}};
  root.querySelector('[data-header]').onchange=event=>{setHeader(source,Number(event.target.value));state.pendingFiles=true;renderMapping(type);updateFileStatus(type);updateUpload();importError('');};
  root.querySelectorAll('[data-mapping-field]').forEach(select=>select.onchange=()=>{source.mapping[select.dataset.mappingField]=Number(select.value);state.pendingFiles=true;if(select.dataset.mappingField==='company')renderMapping(type);updateUpload();importError('');});
  const company=root.querySelector('#static-company');if(company)company.oninput=event=>{source.company=event.target.value;state.pendingFiles=true;updateUpload();};
}
function updateFileStatus(type){const source=state.files[type],node=$(`#file-${type}-status`);node.classList.add('loaded');node.textContent=`${source.name} · Sheet ${source.sheet} · ${fmt(Math.max(0,source.rows.length-source.headerIndex-1))} baris`;}
async function loadFile(type,file){
  if(!cloud.session||!cloud.access.allowed||state.busy||state.restoring)return;
  const request=++state.requests[type];state.loading++;importError('');updateUpload();$(`#file-${type}-status`).textContent='Membaca file…';
  try{
    const source=await readWorkbook(file,type);if(request!==state.requests[type])return;
    state.files[type]=source;state.pendingFiles=true;renderMapping(type);updateFileStatus(type);
    const missing=mappingError(type);$(`#mapping-details-${type}`).open=Boolean(missing);
  }catch(error){if(request===state.requests[type]){state.files[type]=null;$(`#file-${type}-status`).textContent='File belum bisa dibaca.';$(`#mapping-details-${type}`).hidden=true;importError(error.message);}}
  finally{state.loading--;updateUpload();}
}
async function processImport(){
  if(state.busy||state.loading||state.restoring||!cloud.session||!cloud.access.allowed||!state.pendingFiles)return;
  const epoch=authEpoch;
  for(const type of ['mess','manpower']){const error=mappingError(type);if(error){importError(error);if(state.files[type])$(`#mapping-details-${type}`).open=true;return;}}
  state.busy=true;updateUpload();importError('');
  try{
    await new Promise(resolve=>setTimeout(resolve,25));
    if(epoch!==authEpoch)return;
    const mapped={};for(const type of ['mess','manpower']){const s=state.files[type];mapped[type]=mapRows(s.rows,s.headerIndex,s.mapping,type,{company:s.company});if(!mapped[type].rows.length)throw new Error(`Tidak ada NIK valid pada data ${type}. Periksa sheet, baris judul, dan kolom NIK.`);if(mapped[type].rows.length>50000)throw new Error('Maksimal 50.000 baris valid per sumber.');}
    const sources=Object.fromEntries(['mess','manpower'].map(type=>{const s=state.files[type];return [type,{name:s.name,sheet:s.sheet,headerRow:s.headerIndex+1,rows:mapped[type].rows.length}];}));
    const dataset=reconcile(mapped.mess.rows,mapped.manpower.rows,{sources,invalid:[...mapped.mess.invalid,...mapped.manpower.invalid]});
    const saved=await cloud.saveSnapshot(dataset,`Data mess — ${date(dataset.importedAt)} WIT`);
    if(epoch!==authEpoch)return;
    if(saved.latestId&&saved.latestId!==saved.id){const latest=await cloud.loadSnapshot(saved.latestId);if(epoch!==authEpoch)return;state.cleanupPending=null;applySavedData(latest);toast('Data yang lebih baru dari sesi lain sudah dimuat.');return;}
    state.data=dataset;state.data.mode='cloud';state.dirty=false;state.pendingFiles=false;state.cleanupPending=saved.cleanupPending?saved:null;state.lastUpdated=saved.created_at;resetFilters();
    $('#mapping-details-mess').open=false;$('#mapping-details-manpower').open=false;
    toast(saved.cleanupPending?'Data baru tersimpan. Penghapusan data lama perlu dicoba lagi.':`${fmt(state.data.residents.length)} penghuni berhasil diproses dan disimpan.`,saved.cleanupPending);
  }catch(error){if(epoch===authEpoch)importError(`${error.message} Data yang tersimpan sebelumnya tetap tersedia.`);}finally{state.busy=false;updateUpload();if(epoch!==authEpoch&&cloud.session)restoreLatest();}
}
async function exportData(){
  await withButton($('#export-button'),async()=>{
    const rows=selectedRows(),included=new Set(rows.map(r=>r.nik));
    const header=['NIK','Nama','Perusahaan','Departemen','Subdepartemen','Jabatan','Kode asli','Kelompok jabatan','Golongan hasil klasifikasi','Lokasi mess','Blok / kamar','Hasil NIK','Catatan','Baris mess untuk NIK'];
    const values=r=>[r.nik,r.name,r.company,r.department,r.subdepartment,r.position,r.gradeRaw,r.positionGroup,r.grade,r.locations.join('; '),r.rooms.join('; '),STATUS[r.status],noteFor(r),r.messOccurrences];
    const sheets=[{name:'Penghuni',rows:[header,...rows.map(values)],widths:[20,28,17,25,25,35,14,18,26,30,22,22,50,23]}];
    for(const [field,name] of [['company','Rekap perusahaan'],['department','Rekap departemen'],['subdepartment','Rekap subdepartemen']]){const report=buildReport(rows,field);sheets.push({name,rows:[report.headers,...report.rows,report.totals]});}
    sheets.push({name:'Perlu diperiksa',rows:[header,...rows.filter(r=>r.needsReview).map(values)]});
    sheets.push({name:'NIK mess berulang',rows:[['NIK','Nama','Baris sumber','Lokasi','Blok','Kamar'],...state.data.duplicateMess.filter(r=>included.has(normalizeNik(r.nik))).map(r=>[r.nik,r.name,r.row||'',r.location||'',r.block||'',r.room||''])]});
    sheets.push({name:'Baris ditolak',rows:[['Sumber','Baris Excel','Nama','Alasan'],...state.data.invalid.map(r=>[r.source,r.row,r.name,r.reason])]});
    sheets.push({name:'Keterangan',rows:[['Keterangan','Nilai'],['Waktu ekspor',date(new Date())+' WIT'],['Sumber mess',state.data.sources.mess?.name||''],['Sumber manpower',state.data.sources.manpower?.name||''],...Object.entries(state.filters).map(([k,v])=>['Filter '+fieldNames[k],v||'Semua']),['Pencarian',state.query],['Keterangan data',$('#resident-status').selectedOptions[0].textContent],['Total penghuni',rows.length],['Versi klasifikasi',CLASSIFICATION_VERSION],...GRADE_RULES.map(r=>['Golongan '+r.grade,r.groups.join(', ')]),['MT','Khusus P1 dengan jabatan Management Trainee, termasuk tambahan departemen setelah koma.'],['Hitungan','Satu NIK unik pada data mess dihitung satu penghuni.'],['Baris ditolak','Mencakup seluruh sumber impor, karena baris tanpa NIK tidak dapat dihubungkan ke filter.']]});
    await exportWorkbook(sheets,`Data_Mess_${new Intl.DateTimeFormat('en-CA',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:'Asia/Jayapura'}).format(new Date())}.xlsx`);toast('Excel diunduh sesuai filter yang dipilih.');
  },'Mengunduh…');
}
function clearCloudData(){
  state.data=makeEmpty();state.dirty=false;state.pendingFiles=false;state.files={mess:null,manpower:null};state.cleanupPending=null;state.restoring=false;state.lastUpdated=null;
  for(const type of ['mess','manpower']){state.requests[type]++;$(`#file-${type}`).value='';$(`#file-${type}-status`).textContent='Excel atau CSV, maksimal 20 MB.';$(`#file-${type}-status`).classList.remove('loaded');$(`#mapping-details-${type}`).hidden=true;}
  $('#restore-notice').hidden=true;$('#data-access-notice').hidden=true;importError('');updateUpload();resetFilters();
}
function onAuthChange(session){
  const old=state.activeUser;state.activeUser=session?.user.id||null;
  if(old!==state.activeUser){authEpoch++;restoreRequest++;historyRequest++;clearCloudData();$('#storage-content').replaceChildren();if(state.activeUser)restoreLatest();else{$('#storage-dialog').close();$('#rules-dialog').close();$('#login-password').value='';}}
  renderAuth();updateSaveStatus();
  if(old!==state.activeUser&&storageStatus==='ready'&&$('#storage-dialog').open)renderStorage();
}
function renderAuth(){
  const signedIn=Boolean(state.activeUser&&cloud.session);
  $('#login-screen').hidden=signedIn;$('#workspace').hidden=!signedIn;$('#skip-to-results').hidden=!signedIn;
  $('#account-email').textContent=cloud.session?.user.email||'Akun aktif';
  const ready=storageStatus==='ready'&&!authBusy;
  for(const id of ['login-email','login-password','login-submit'])$(`#${id}`).disabled=!ready;
  $('#login-submit').textContent=authBusy?'Masuk…':'Masuk';
  $('#connection-status').textContent=storageStatus==='connecting'?'Memeriksa sesi…':storageStatus==='error'?`Koneksi belum tersedia. ${storageError}`:'Gunakan akun yang sudah terdaftar.';
  $('#retry-connection').hidden=storageStatus!=='error';
}
async function connectStorage(){
  storageStatus='connecting';storageError='';
  renderAuth();
  try{await cloud.connect(onAuthChange);storageStatus='ready';}
  catch(error){storageStatus='error';storageError=error.message;}
  renderAuth();if($('#storage-dialog').open)renderStorage();
}
function renderStorage(){
  const account=cloud.session,root=$('#storage-content');
  root.innerHTML=`<div class="storage-account"><span>${e(account?.user.email||'Akun aktif')}</span></div><p class="setup-note">${cloud.access.mode==='shared'?'Semua akun yang diberi akses melihat dan dapat mengganti data yang sama. Impor baru mengganti seluruh data sebelumnya dalam satu transaksi.':'Pembaruan database belum diaktifkan. Untuk sementara data masih mengikuti akun masing-masing.'}</p><div class="history-heading"><h3>Data terakhir</h3><button type="button" class="text-button" id="refresh-snapshots">Muat ulang</button></div><div id="snapshot-list"><p class="loading">Memuat data…</p></div><div class="storage-bottom"><button class="button" data-close="storage-dialog" type="button">Tutup</button></div>`;
  bindClose(root);
  $('#refresh-snapshots').onclick=fillSnapshots;
  if(storageStatus==='ready'&&account)fillSnapshots();
}
function applySavedData(saved){
  state.data=reconcile(saved.mess,saved.manpower,{sources:saved.source_info,invalid:saved.invalid_rows,importedAt:saved.imported_at,mode:'cloud'});state.dirty=false;state.pendingFiles=false;state.files={mess:null,manpower:null};state.lastUpdated=saved.created_at;
  if(cloud.access.mode==='shared')state.cleanupPending=null;
  for(const type of ['mess','manpower']){$(`#file-${type}`).value='';$(`#mapping-details-${type}`).hidden=true;$(`#file-${type}-status`).textContent=`Sumber tersimpan: ${state.data.sources[type]?.name||'—'}`;$(`#file-${type}-status`).classList.add('loaded');}
  importError('');updateUpload();resetFilters();
}
async function restoreLatest(){
  if(!cloud.session||state.busy)return;
  if(state.pendingFiles&&!window.confirm('File yang dipilih belum diproses. Muat data terakhir dan batalkan pilihan file ini?'))return;
  const request=++restoreRequest,epoch=authEpoch;state.restoring=true;updateUpload();
  $('#restore-notice').hidden=false;$('#restore-message').textContent='Memuat data terakhir…';$('#retry-restore').hidden=true;
  try{
    await cloud.refreshAccess();
    if(request!==restoreRequest||epoch!==authEpoch)return;
    if(cloud.access.allowed){const saved=await cloud.loadLatestSnapshot();if(request!==restoreRequest||epoch!==authEpoch)return;if(saved)applySavedData(saved);else clearCloudData();}
    else clearCloudData();
    const notice=$('#data-access-notice');notice.hidden=cloud.access.mode==='shared'&&cloud.access.allowed;
    notice.innerHTML=cloud.access.mode==='legacy'?'Data bersama belum aktif karena database masih memakai pengaturan per akun. Jalankan pembaruan database sekali, lalu muat ulang web. <a href="./schema.sql" download="Data_Mess_Bersama.sql">Unduh pembaruan database</a>':cloud.access.allowed?'':'Akun ini belum diberi akses data mess bersama. Hubungi pengelola akun.';
    $('#restore-notice').hidden=true;
  }catch(error){if(request===restoreRequest&&epoch===authEpoch){$('#restore-message').textContent=`Data terakhir belum dapat dimuat. ${error.message}`;$('#retry-restore').hidden=false;}}
  finally{if(request===restoreRequest&&epoch===authEpoch){state.restoring=false;updateUpload();}}
}
async function fillSnapshots(){
  const request=++historyRequest;
  try{
    const snapshots=await cloud.listSnapshots();if(request!==historyRequest||!$('#snapshot-list'))return;
    $('#snapshot-list').innerHTML=snapshots.length?snapshots.map(s=>`<div class="snapshot-row"><div><strong>${e(s.label)}</strong><small>${date(s.created_at)} WIT · ${fmt(s.counts?.total||0)} penghuni</small></div><button class="button small" type="button" data-snapshot-id="${e(s.id)}">Buka</button></div>`).join(''):'<p class="small-note">Belum ada data tersimpan.</p>';
    $('#snapshot-list').querySelectorAll('[data-snapshot-id]').forEach(button=>button.onclick=async()=>{
      if(state.busy||state.restoring)return;
      if(state.pendingFiles&&!window.confirm('File yang dipilih belum diproses. Buka data tersimpan?'))return;
      await withButton(button,async()=>{
        const epoch=authEpoch;
        const saved=await cloud.loadLatestSnapshot();
        if(epoch!==authEpoch)return;if(!saved)throw new Error('Belum ada data tersimpan.');applySavedData(saved);$('#storage-dialog').close();toast('Data tersimpan berhasil dibuka.');
      },'Membuka…');
    });
  }catch(error){if(request===historyRequest&&$('#snapshot-list'))$('#snapshot-list').innerHTML=`<p class="notice error">${e(error.message)}</p>`;}
}
function bindClose(root=document){root.querySelectorAll('[data-close]').forEach(button=>button.onclick=()=>document.getElementById(button.dataset.close).close());}
function init(){
  $('#login-form').onsubmit=async event=>{event.preventDefault();if(authBusy||storageStatus!=='ready')return;authBusy=true;$('#login-feedback').textContent='';renderAuth();try{await cloud.signIn($('#login-email').value,$('#login-password').value);$('#login-password').value='';onAuthChange(cloud.session);}catch(error){feedback('#login-feedback',error.message,true);$('#login-password').value='';}finally{authBusy=false;renderAuth();}};
  $('#retry-connection').onclick=connectStorage;
  $('#signout-button').onclick=event=>withButton(event.currentTarget,async()=>{await cloud.signOut();onAuthChange(null);toast('Anda sudah keluar.');$('#login-email').focus();},'Keluar…');
  $('#retry-restore').onclick=restoreLatest;
  $('#refresh-data').onclick=restoreLatest;
  $('#retry-cleanup').onclick=event=>withButton(event.currentTarget,async()=>{const epoch=authEpoch,snapshot=state.cleanupPending;if(!snapshot)return;const latest=await cloud.removeOlderSnapshots(snapshot);if(epoch!==authEpoch||state.cleanupPending!==snapshot)return;if(latest.id!==snapshot.id){const saved=await cloud.loadSnapshot(latest.id);if(epoch!==authEpoch||state.cleanupPending!==snapshot)return;applySavedData(saved);}state.cleanupPending=null;updateSaveStatus();toast('Data lama berhasil dihapus.');},'Menghapus…');
  for(const field of Object.keys(state.filters))$(`#filter-${field}`).onchange=event=>{state.filters[field]=event.target.value;const keys=Object.keys(state.filters);keys.slice(keys.indexOf(field)+1).forEach(k=>state.filters[k]='');state.page=1;state.reportPage=1;renderResults();};
  $('#resident-search').oninput=event=>{state.query=event.target.value;state.page=1;state.reportPage=1;renderResults();};
  $('#resident-status').onchange=event=>{state.status=event.target.value;state.page=1;state.reportPage=1;renderResults();};
  $('#report-group').onchange=event=>{state.reportGroup=event.target.value;state.reportPage=1;renderReport(selectedRows());};
  $('#reset-filters').onclick=resetFilters;$('#process-import').onclick=processImport;$('#export-button').onclick=exportData;
  for(const type of ['mess','manpower'])$(`#file-${type}`).onchange=event=>{if(event.target.files[0])loadFile(type,event.target.files[0]);};
  $('#download-template').onclick=event=>withButton(event.currentTarget,async()=>{await downloadTemplate();toast('Template Excel berhasil diunduh.');},'Menyiapkan…');
  $('#rules-button').onclick=()=>$('#rules-dialog').showModal();$('#storage-button').onclick=()=>{renderStorage();$('#storage-dialog').showModal();};
  bindClose();
  window.addEventListener('beforeunload',event=>{if(state.pendingFiles||state.busy||state.cleanupPending){event.preventDefault();event.returnValue='';}});
  renderResults();updateUpload();connectStorage();
}
init();
