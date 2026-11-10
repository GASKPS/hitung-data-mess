export const UNKNOWN = 'Belum teridentifikasi';
export const STATUS = { matched: 'Cocok', unmatched: 'Tidak ditemukan', ambiguous: 'Referensi ganda', 'no-nik': 'Belum ada NIK' };
export const EMPLOYMENT = { active: 'Karyawan aktif', 'new-hire': 'New hire', review: 'Perlu diperiksa' };
export const collator = new Intl.Collator('id', { numeric: true, sensitivity: 'base' });
export const text = value => String(value ?? '').trim();
export function normalizeNik(value) { return text(value).replace(/^'/, '').replace(/[\s\u200B-\u200D\uFEFF]/g, '').toUpperCase(); }
export function normalizeHeader(value) { return text(value).toLowerCase().replace(/[^a-z0-9]/g, ''); }
export function companyLabel(value) { return text(value).replace(/^pt[.\s]+/i, '').replace(/\s+/g, ' ').toUpperCase(); }
export const GRADE_RULES = [
  {grade:'1',groups:['S1','P1']},
  {grade:'2',groups:['S2','S3','P2','M1','M2']},
  {grade:'3',groups:['S4','P3','P4','M3','M4']},
  {grade:'4',groups:['P5','M5','M6','M7']},
  {grade:'5',groups:['X1','X2','X3']}
];
export const CLASSIFICATION_VERSION = 'kelompok-jabatan-v1';
export function gradeLabel(value) { return text(value).replace(/^gol(?:ongan)?\s*/i,'').toUpperCase(); }
export function classifyGrade(code,position='') {
  const normalized=gradeLabel(code).replace(/\s+/g,'');
  if(!normalized)return {grade:'',positionGroup:'',classificationReason:'Kode golongan kosong.'};
  // Explicit old grades are accepted; letter-prefixed codes always use the agreed table.
  if(/^[1-5]$/.test(normalized)||normalized==='MT')return {grade:normalized,positionGroup:'',classificationReason:''};
  const match=normalized.match(/^([SPMX]\d+)(?:[.,]\d+)?$/);
  if(!match)return {grade:'',positionGroup:'',classificationReason:`Kode ${text(code)} belum dikenali.`};
  const positionGroup=match[1];
  const rule=GRADE_RULES.find(r=>r.groups.includes(positionGroup));
  if(!rule)return {grade:'',positionGroup,classificationReason:`Kelompok ${positionGroup} belum ada dalam aturan golongan.`};
  if(positionGroup==='P1'){
    const job=text(position).replace(/[\u200B-\u200D\uFEFF]/g,'').replace(/\s+/g,' ');
    if(!job)return {grade:'',positionGroup,classificationReason:'Jabatan P1 kosong. Periksa apakah Management Trainee.'};
    if(/^management trainee(?:\s*(?:[,;:/\u2013\u2014-]|\(|$))/i.test(job))return {grade:'MT',positionGroup,classificationReason:''};
  }
  return {grade:rule.grade,positionGroup,classificationReason:''};
}
export function gradeName(value) { return /^\d+$/.test(value) ? `Golongan ${value}` : value; }
export const ALIASES = {
  nik: ['nik','nomorindukkaryawan','employeeid','employeeno','idkaryawan','nomorinduk','nip','idnik'],
  name: ['nama','name','namakaryawan','namalengkap','employeename'],
  company: ['perusahaan','company','namaperusahaan','pt','costcenter','costcentre'],
  department: ['department','departemen','dept','dep'],
  subdepartment: ['subdept','subdepartment','subdepartemen','subdep','subdivisi','section'],
  grade: ['gol','golongan','grade','level','golongankaryawan'],
  position: ['jabatan','namajabatan','posisi','namaposisi','position','jobtitle','jobposition','positionname'],
  location: ['lokasimess','lokasihunian','mess','namamess','lokasi','residence','camp'],
  room: ['nokamar','nomorkamar','kamar','room','roomnumber'],
  block: ['blok','block'],
  floor: ['floor','lantai'],
  gender: ['gender','gendre','jeniskelamin','sex'],
  messEntry: ['tanggalmasukmesshunian','tanggalmasukmesshunianp2','tanggalmasukmess','tglmasukmesshunian','tglmasukmesshunianp2','tglmasukmess']
};
const newHireFields = {name:'nama',gender:'gender',department:'departemen',grade:'golongan',position:'jabatan',company:'perusahaan',location:'lokasi mess',block:'blok',room:'kamar'};
const missingNewHireFields = row => Object.keys(newHireFields).filter(key => !text(row[key]) || /^[-–—]+$/.test(text(row[key])));
export function normalizeHireMonth(value) {
  const month = text(value);
  return /^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(month) ? month : '';
}
export function hireMonthFromNik(value) {
  const parts = normalizeNik(value).match(/^[A-Z](0[1-9]|1[0-2])(\d{2})\d+$/);
  return parts ? `20${parts[2]}-${parts[1]}` : '';
}
const monthFormatter = new Intl.DateTimeFormat('id-ID',{month:'long',year:'numeric',timeZone:'UTC'});
export function monthLabel(value) {
  const month = normalizeHireMonth(value);
  return month ? monthFormatter.format(new Date(`${month}-01T00:00:00Z`)) : '';
}
export function suggestMapping(headers) {
  const normalized = headers.map(normalizeHeader);
  return Object.fromEntries(Object.entries(ALIASES).map(([field, aliases]) => [field, normalized.findIndex(h => aliases.includes(h))]));
}
export function detectHeader(rows) {
  let best = { index: 0, score: -1 };
  rows.slice(0, 40).forEach((row, index) => {
    const mapped = suggestMapping(row);
    const count = Object.values(mapped).filter(x => x >= 0).length;
    const score = count + (mapped.nik >= 0 ? 10 : 0) + (mapped.name >= 0 ? 2 : 0);
    if (score > best.score) best = { index, score };
  });
  return best.index;
}
export function mapRows(rows, headerIndex, mapping, type, options = {}) {
  const result = [], invalid = [];
  for (let i = headerIndex + 1; i < rows.length; i++) {
    const values = rows[i];
    if (!values?.some(v => text(v))) continue;
    const item = { row: i + 1 };
    for (const [field, index] of Object.entries(mapping)) item[field] = index >= 0 ? text(values[index]) : '';
    item.nik = normalizeNik(item.nik);
    // Repeated print headers are not employee records.
    if (ALIASES.nik.includes(normalizeHeader(item.nik))) continue;
    if (!item.nik) {
      if (type === 'mess') {
        if (!item.name) continue; // A bed with no NIK or name is not a resident.
        const missing = missingNewHireFields(item);
        if (!missing.length) { result.push(item); continue; }
        invalid.push({row:i + 1, name:item.name, reason:`NIK kosong; lengkapi data New hire: ${missing.map(key=>newHireFields[key]).join(', ')}.`, source:type});
      } else invalid.push({row:i + 1, name:item.name || '', reason:'NIK kosong', source:type});
      continue;
    }
    if (/^[+-]?\d+(?:[.,]\d+)?[Ee][+-]?\d+$/.test(item.nik)) {
      invalid.push({row:i + 1, name:item.name || '', reason:'NIK berupa notasi ilmiah; ubah menjadi teks di Excel', source:type}); continue;
    }
    if (type === 'manpower') {
      item.company = companyLabel(item.company || options.company);
      item.gradeRaw = item.grade;
      Object.assign(item,classifyGrade(item.gradeRaw,item.position));
    }
    result.push(item);
  }
  return { rows: result, invalid };
}
function classificationSignature(row) {
  return JSON.stringify([companyLabel(row.company), row.department, row.subdepartment, row.gradeRaw || row.grade, row.grade].map(v => text(v).replace(/\s+/g,' ').toUpperCase()));
}
export function reconcile(mess, manpower, options = {}) {
  const master = new Map(), residence = new Map(), duplicateMess = [], duplicateManpower = [];
  const newHireSince = normalizeHireMonth(options.newHireSince);
  const dictionaries = Object.fromEntries(['department','subdepartment','location'].map(k=>[k,new Map()]));
  const canonical=(field,value)=>{
    const clean=text(value).replace(/\s+/g,' '); if(!clean)return '';
    const key=clean.toUpperCase();if(!dictionaries[field].has(key))dictionaries[field].set(key,clean);
    return dictionaries[field].get(key);
  };
  // Reclassify saved sources too, so older snapshots use the current agreed rules.
  for (const original of manpower) {
    const row={...original,...classifyGrade(original.gradeRaw || original.grade,original.position)};
    const nik = normalizeNik(row.nik);
    if (!nik) continue;
    const list = master.get(nik) || [];
    if (list.length) duplicateManpower.push(row);
    list.push(row); master.set(nik, list);
  }
  for (const row of mess) {
    const nik = normalizeNik(row.nik);
    if (!nik && missingNewHireFields(row).length) continue;
    // Without a NIK, separate source rows are not merged by name.
    const key = nik || Symbol();
    const list = residence.get(key) || [];
    if (list.length) duplicateMess.push(row);
    list.push(row); residence.set(key, list);
  }
  const residents = [...residence.values()].map(rooms => {
    const home = rooms[0];
    const nik = normalizeNik(home.nik);
    const candidates = master.get(nik) || [];
    const variants = new Set(candidates.map(classificationSignature));
    const hireMonth = hireMonthFromNik(nik);
    const eligibleNewHire = !nik || (newHireSince && hireMonth && hireMonth >= newHireSince);
    const employmentStatus = candidates.length ? 'active' : eligibleNewHire ? 'new-hire' : 'review';
    const status = !nik ? 'no-nik' : !candidates.length ? 'unmatched' : variants.size > 1 ? 'ambiguous' : 'matched';
    const fromMess = employmentStatus === 'new-hire';
    const found = status === 'matched' ? candidates[0] : fromMess ? {...home,gradeRaw:home.grade,...classifyGrade(home.grade,home.position)} : {};
    const required = fromMess ? ['company','department','grade'] : ['company','department','subdepartment','grade'];
    const incomplete = (status === 'matched' || fromMess) && required.some(k => !text(found[k]));
    const reviewReason = employmentStatus === 'review' && newHireSince
      ? hireMonth
        ? `NIK tidak ditemukan di manpower. Bulan masuk ${monthLabel(hireMonth)} sebelum batas ${monthLabel(newHireSince)}.`
        : 'NIK tidak ditemukan di manpower. Bulan dan tahun masuk tidak terbaca dari NIK.'
      : '';
    return {
      nik, name: home.name || found.name || 'Tanpa nama',
      company: companyLabel(found.company), department: canonical('department',found.department),
      subdepartment: canonical('subdepartment',found.subdepartment), grade: found.grade || '', gradeRaw: found.gradeRaw || found.grade || '',
      position: text(found.position), positionGroup: found.positionGroup || '', classificationReason: found.classificationReason || '',
      location: canonical('location',home.location), room: home.room || '', block: home.block || '', floor: home.floor || '',
      gender: text(home.gender || found.gender), messEntry: text(home.messEntry), hireMonth, employmentStatus, reviewReason,
      status, messOccurrences: rooms.length, manpowerOccurrences: candidates.length,
      locations: [...new Set(rooms.map(r => canonical('location',r.location)).filter(Boolean))],
      rooms: [...new Set(rooms.map(r => [r.block,r.room].filter(Boolean).join(' / ')).filter(Boolean))],
      sourceRow: home.row || null,
      incomplete, needsReview: employmentStatus === 'review' || status === 'ambiguous' || incomplete
    };
  });
  return {
    residents, mess, manpower, duplicateMess, duplicateManpower, newHireSince,
    invalid: options.invalid || [], gradeMode: 'raw', classificationVersion: CLASSIFICATION_VERSION,
    sources: options.sources || {}, importedAt: options.mode==='empty'?null:options.importedAt || new Date().toISOString(),
    mode: options.mode || 'local'
  };
}
export const blankFilters = () => ({ company: '', department: '', subdepartment: '', grade: '', location: '' });
export function filterResidents(rows, filters = {}, query = '', status = '') {
  const q = text(query).toLocaleLowerCase('id');
  return rows.filter(r => Object.entries(filters).every(([key,val]) => !val || (key === 'location' ? r.locations?.includes(val) || (r.location || UNKNOWN) === val : (r[key] || UNKNOWN) === val))
    && (!q || `${r.nik} ${r.name} ${r.company} ${r.location} ${r.position} ${r.department} ${r.subdepartment}`.toLocaleLowerCase('id').includes(q))
    && (!status || (status === 'active' || status === 'new-hire' ? r.employmentStatus === status : status === 'review' ? r.needsReview : status === 'unclassified' ? !r.grade : status === 'duplicate' ? r.messOccurrences > 1 : status === 'incomplete' ? r.incomplete : r.status === status)));
}
export function filterOptions(rows, filters, field) {
  const order = ['company','department','subdepartment','grade','location'];
  const upstream = Object.fromEntries(order.slice(0, order.indexOf(field)).map(k => [k,filters[k]]));
  const selected = filterResidents(rows, upstream);
  const values = selected.flatMap(r => field === 'location' ? (r.locations?.length ? r.locations : [r.location || UNKNOWN]) : [r[field] || UNKNOWN]);
  return [...new Set(values)].sort(collator.compare);
}
export function aggregate(rows, field) {
  const groups = new Map();
  for (const r of rows) {
    const label = r[field] || UNKNOWN;
    const group = groups.get(label) || { label, count: 0, grades: {} };
    group.count++; const grade = r.grade || UNKNOWN; group.grades[grade] = (group.grades[grade] || 0) + 1;
    groups.set(label, group);
  }
  return [...groups.values()].sort((a,b) => b.count - a.count || collator.compare(a.label,b.label));
}
export function summary(rows) {
  const matched = rows.filter(r => r.status === 'matched').length;
  return { total: rows.length, matched, review: rows.filter(r=>r.needsReview).length,
    active: rows.filter(r=>r.employmentStatus==='active').length,
    newHire: rows.filter(r=>r.employmentStatus==='new-hire').length,
    companies: new Set(rows.map(r=>r.company).filter(Boolean)).size,
    departments: new Set(rows.map(r=>r.department).filter(Boolean)).size,
    incomplete: rows.filter(r=>r.incomplete).length,
    duplicate: rows.filter(r=>r.messOccurrences>1).length,
    rate: rows.length ? matched / rows.length * 100 : 0 };
}
export function buildReport(rows, group = 'company') {
  const grades = ['1','2','3','4','5','MT',UNKNOWN];
  const totals = new Map();
  for (const row of rows) { const grade = row.grade || UNKNOWN; totals.set(grade, (totals.get(grade) || 0) + 1); }
  const labels = { company: 'Perusahaan', department: 'Departemen', subdepartment: 'Subdepartemen', location: 'Lokasi mess' };
  return { grades, headers: [labels[group], ...grades.map(gradeName), 'Total penghuni'],
    rows: aggregate(rows, group).map(r => [r.label, ...grades.map(g => r.grades[g] || 0), r.count]),
    totals: ['TOTAL', ...grades.map(g => totals.get(g) || 0), rows.length] };
}
export function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
export function safeSpreadsheetCell(value) { return typeof value === 'string' && /^[=+\-@\t\r]/.test(value) ? `'${value}` : value; }
export function makeEmpty(){ return reconcile([],[],{mode:'empty'}); }
