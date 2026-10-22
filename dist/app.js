import {UNKNOWN,STATUS,GRADE_RULES,CLASSIFICATION_VERSION,collator,text,normalizeNik,normalizeHeader,suggestMapping,mapRows,reconcile,makeEmpty,filterResidents,filterOptions,summary,buildReport,gradeName,escapeHtml as e} from './core.js';
import {readWorkbook,setSheet,setHeader,headers,downloadTemplate,exportWorkbook} from './workbook.js';
import * as cloud from './cloud.js';

const $=selector=>document.querySelector(selector);
const fmt=value=>new Intl.NumberFormat('id-ID').format(value);
const date=value=>new Intl.DateTimeFormat('id-ID',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Jayapura'}).format(new Date(value));
const freshFilters=()=>({company:'',department:'',subdepartment:'',grade:''});
const fieldNames={nik:'NIK',name:'Nama',company:'Perusahaan',department:'Departemen',subdepartment:'Subdepartemen',grade:'Kode golongan',position:'Jabatan',location:'Lokasi mess',block:'Blok',room:'No. kamar'};
const state={data:makeEmpty(),files:{mess:null,manpower:null},requests:{mess:0,manpower:0},loading:0,busy:false,dirty:false,pendingFiles:false,filters:freshFilters(),query:'',status:'',page:1,reportGroup:'company',reportPage:1,activeUser:null};
const pageSize=20;
const selectedRows=()=>filterResidents(state.data.residents,state.filters,state.query,state.status);
let toastTimer,historyRequest=0;

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
  $('#save-status').textContent=state.data.mode==='empty'?'File dibaca setelah Anda memilih Tampilkan data.':state.dirty?'Hasil impor belum disimpan.':'Data tersimpan di Supabase.';
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
  const both=state.files.mess&&state.files.manpower;$('#process-import').disabled=!both||state.loading>0||state.busy;
  $('#upload-help').textContent=state.loading?'Sedang membaca file…':state.busy?'Mencocokkan NIK…':!both?'Pilih kedua file untuk mulai.':state.pendingFiles?'File siap. Klik Tampilkan data.':'Data sudah diproses.';
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
  const request=++state.requests[type];state.loading++;importError('');updateUpload();$(`#file-${type}-status`).textContent='Membaca file…';
  try{
    const source=await readWorkbook(file,type);if(request!==state.requests[type])return;
    state.files[type]=source;state.pendingFiles=true;renderMapping(type);updateFileStatus(type);
    const missing=mappingError(type);$(`#mapping-details-${type}`).open=Boolean(missing);
  }catch(error){if(request===state.requests[type]){state.files[type]=null;$(`#file-${type}-status`).textContent='File belum bisa dibaca.';$(`#mapping-details-${type}`).hidden=true;importError(error.message);}}
  finally{state.loading--;updateUpload();}
}
async function processImport(){
  if(state.busy||state.loading)return;
  for(const type of ['mess','manpower']){const error=mappingError(type);if(error){importError(error);if(state.files[type])$(`#mapping-details-${type}`).open=true;return;}}
  if(state.dirty&&!window.confirm('Data aktif belum disimpan. Ganti dengan kedua file ini?'))return;
  state.busy=true;updateUpload();importError('');
  try{
    await new Promise(resolve=>setTimeout(resolve,25));
    const mapped={};for(const type of ['mess','manpower']){const s=state.files[type];mapped[type]=mapRows(s.rows,s.headerIndex,s.mapping,type,{company:s.company});if(!mapped[type].rows.length)throw new Error(`Tidak ada NIK valid pada data ${type}. Periksa sheet, baris judul, dan kolom NIK.`);if(mapped[type].rows.length>50000)throw new Error('Maksimal 50.000 baris valid per sumber.');}
    const sources=Object.fromEntries(['mess','manpower'].map(type=>{const s=state.files[type];return [type,{name:s.name,sheet:s.sheet,headerRow:s.headerIndex+1,rows:mapped[type].rows.length}];}));
    state.data=reconcile(mapped.mess.rows,mapped.manpower.rows,{sources,invalid:[...mapped.mess.invalid,...mapped.manpower.invalid]});state.dirty=true;state.pendingFiles=false;resetFilters();
    $('#mapping-details-mess').open=false;$('#mapping-details-manpower').open=false;toast(`${fmt(state.data.residents.length)} penghuni berhasil dibaca dan diklasifikasikan.`);
  }catch(error){importError(error.message);}finally{state.busy=false;updateUpload();}
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
  if(state.data.mode!=='cloud')return;state.data=makeEmpty();state.dirty=false;state.pendingFiles=false;state.files={mess:null,manpower:null};
  for(const type of ['mess','manpower']){$(`#file-${type}`).value='';$(`#file-${type}-status`).textContent='Excel atau CSV, maksimal 20 MB.';$(`#file-${type}-status`).classList.remove('loaded');$(`#mapping-details-${type}`).hidden=true;}
  updateUpload();resetFilters();
}
function onAuthChange(session){
  const old=state.activeUser;state.activeUser=session?.user.id||null;
  if(old&&old!==state.activeUser)clearCloudData();updateSaveStatus();
}
function renderStorage(){
  const config=cloud.config||cloud.storedConfig(),account=cloud.session,root=$('#storage-content');
  root.innerHTML=`<details class="storage-config" id="storage-config"${!config?' open':''}><summary>Pengaturan koneksi Supabase</summary><form id="connection-form" class="storage-form"><label>Project URL<input id="supabase-url" type="url" required placeholder="https://proyek.supabase.co" value="${e(config?.url||'')}" autocomplete="url"></label><label>Publishable key / anon key<input id="supabase-key" type="password" required placeholder="sb_publishable_…" value="${e(config?.key||'')}" autocomplete="off"><small>Gunakan public key. Secret key dan service_role tidak diterima.</small></label><div><button type="submit" class="button">Simpan koneksi</button>${config?' <button class="text-button" type="button" id="disconnect-cloud" style="margin-left:12px">Putuskan koneksi</button>':''}</div></form><div id="connection-feedback" role="status"></div><a class="schema-link" href="./schema.sql" download="data-mess-schema.sql">Unduh skema database (.sql)</a><p class="small-note" style="margin-top:9px">Jalankan skema sekali di SQL Editor Supabase. Buat akun masuk melalui Authentication → Users.</p></details>${config?account?`<div class="storage-account"><span>${e(account.user.email||'Akun aktif')}</span><button type="button" class="text-button" id="signout-button">Keluar</button></div><form class="save-form" id="save-form"><label>Nama data<input id="snapshot-label" maxlength="160" required value="Data mess — ${new Intl.DateTimeFormat('id-ID',{day:'numeric',month:'long',year:'numeric',timeZone:'Asia/Jayapura'}).format(new Date())}"></label><button class="button primary" id="save-snapshot" type="submit"${!state.data.residents.length?' disabled':''}>Simpan data aktif</button><span class="small-note">${!state.data.residents.length?'Unggah dan proses kedua file terlebih dahulu.':state.dirty?'Hasil impor ini belum disimpan.':'Data aktif sudah tersimpan.'}</span></form><div class="history-heading"><h3>Data tersimpan</h3><button type="button" class="text-button" id="refresh-snapshots">Muat ulang</button></div><div id="snapshot-list"><p class="loading">Memuat data…</p></div>`:`<p class="setup-note">Masuk ke akun Supabase untuk menyimpan atau membuka data.</p><form id="login-form" class="storage-form"><label>Email<input id="login-email" type="email" required autocomplete="username" placeholder="nama@perusahaan.com"></label><label>Kata sandi<input id="login-password" type="password" required autocomplete="current-password"></label><button class="button primary" type="submit">Masuk</button></form><div id="login-feedback" role="status"></div>`:'<p class="small-note">Hasil impor dapat dilihat langsung. Penyimpanan tersedia setelah Supabase terhubung.</p>'}<div class="storage-bottom"><button class="button" data-close="storage-dialog" type="button">Tutup</button></div>`;
  bindClose(root);
  $('#connection-form').onsubmit=async event=>{event.preventDefault();await withButton(event.currentTarget.querySelector('button[type=submit]'),async()=>{try{await cloud.connect($('#supabase-url').value,$('#supabase-key').value,onAuthChange);renderStorage();toast('Koneksi disimpan. Masuk untuk menyimpan data.');}catch(error){feedback('#connection-feedback',error.message,true);}},'Menghubungkan…');};
  if($('#disconnect-cloud'))$('#disconnect-cloud').onclick=async event=>withButton(event.currentTarget,async()=>{await cloud.disconnect();clearCloudData();state.activeUser=null;renderStorage();toast('Koneksi Supabase dilepas.');});
  if($('#login-form'))$('#login-form').onsubmit=async event=>{event.preventDefault();await withButton(event.currentTarget.querySelector('button'),async()=>{try{await cloud.signIn($('#login-email').value,$('#login-password').value);onAuthChange(cloud.session);renderStorage();toast('Berhasil masuk.');}catch(error){feedback('#login-feedback',error.message,true);$('#login-password').value='';}},'Masuk…');};
  if($('#signout-button'))$('#signout-button').onclick=async event=>withButton(event.currentTarget,async()=>{await cloud.signOut();clearCloudData();state.activeUser=null;renderStorage();toast('Anda sudah keluar.');});
  if($('#save-form'))$('#save-form').onsubmit=async event=>{event.preventDefault();await withButton($('#save-snapshot'),async()=>{await cloud.saveSnapshot(state.data,$('#snapshot-label').value);state.data.mode='cloud';state.dirty=false;updateSaveStatus();renderStorage();toast('Data berhasil disimpan.');},'Menyimpan…');};
  if($('#refresh-snapshots'))$('#refresh-snapshots').onclick=fillSnapshots;
  if(account)fillSnapshots();
}
async function fillSnapshots(){
  const request=++historyRequest;
  try{
    const snapshots=await cloud.listSnapshots();if(request!==historyRequest||!$('#snapshot-list'))return;
    $('#snapshot-list').innerHTML=snapshots.length?snapshots.map(s=>`<div class="snapshot-row"><div><strong>${e(s.label)}</strong><small>${date(s.created_at)} WIT · ${fmt(s.counts?.total||0)} penghuni</small></div><button class="button small" type="button" data-snapshot-id="${e(s.id)}">Buka</button></div>`).join(''):'<p class="small-note">Belum ada data tersimpan.</p>';
    $('#snapshot-list').querySelectorAll('[data-snapshot-id]').forEach(button=>button.onclick=async()=>{
      if(state.dirty&&!window.confirm('Hasil impor belum disimpan. Ganti dengan data tersimpan ini?'))return;
      await withButton(button,async()=>{
        const saved=await cloud.loadSnapshot(button.dataset.snapshotId);
        state.data=reconcile(saved.mess,saved.manpower,{sources:saved.source_info,invalid:saved.invalid_rows,importedAt:saved.imported_at,mode:'cloud'});state.dirty=false;state.pendingFiles=false;state.files={mess:null,manpower:null};
        for(const type of ['mess','manpower']){$(`#file-${type}`).value='';$(`#mapping-details-${type}`).hidden=true;$(`#file-${type}-status`).textContent=`Sumber tersimpan: ${state.data.sources[type]?.name||'—'}`;$(`#file-${type}-status`).classList.add('loaded');}
        importError('');updateUpload();resetFilters();$('#storage-dialog').close();toast('Data tersimpan berhasil dibuka.');
      },'Membuka…');
    });
  }catch(error){if(request===historyRequest&&$('#snapshot-list'))$('#snapshot-list').innerHTML=`<p class="notice error">${e(error.message)}</p>`;}
}
function bindClose(root=document){root.querySelectorAll('[data-close]').forEach(button=>button.onclick=()=>document.getElementById(button.dataset.close).close());}
function init(){
  for(const field of Object.keys(state.filters))$(`#filter-${field}`).onchange=event=>{state.filters[field]=event.target.value;const keys=Object.keys(state.filters);keys.slice(keys.indexOf(field)+1).forEach(k=>state.filters[k]='');state.page=1;state.reportPage=1;renderResults();};
  $('#resident-search').oninput=event=>{state.query=event.target.value;state.page=1;state.reportPage=1;renderResults();};
  $('#resident-status').onchange=event=>{state.status=event.target.value;state.page=1;state.reportPage=1;renderResults();};
  $('#report-group').onchange=event=>{state.reportGroup=event.target.value;state.reportPage=1;renderReport(selectedRows());};
  $('#reset-filters').onclick=resetFilters;$('#process-import').onclick=processImport;$('#export-button').onclick=exportData;
  for(const type of ['mess','manpower'])$(`#file-${type}`).onchange=event=>{if(event.target.files[0])loadFile(type,event.target.files[0]);};
  $('#download-template').onclick=event=>withButton(event.currentTarget,async()=>{await downloadTemplate();toast('Template Excel berhasil diunduh.');},'Menyiapkan…');
  $('#rules-button').onclick=()=>$('#rules-dialog').showModal();$('#storage-button').onclick=()=>{renderStorage();$('#storage-dialog').showModal();};
  bindClose();
  window.addEventListener('beforeunload',event=>{if(state.dirty){event.preventDefault();event.returnValue='';}});
  renderResults();updateUpload();const config=cloud.storedConfig();if(config)cloud.connect(config.url,config.key,onAuthChange).then(()=>{if($('#storage-dialog').open)renderStorage();}).catch(()=>toast('Koneksi penyimpanan belum berhasil. Periksa pengaturan Supabase.',true));
}
init();
