import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeNik,companyLabel,gradeLabel,classifyGrade,GRADE_RULES,suggestMapping,detectHeader,mapRows,reconcile,filterResidents,filterOptions,buildReport,summary,makeEmpty,UNKNOWN,escapeHtml,safeSpreadsheetCell} from '../dist/core.js';

test('NIK preserves letters, leading zeros, and punctuation while normalizing spacing',()=>{
  assert.equal(normalizeNik(" 's 00123\u200B "),'S00123');
  assert.equal(normalizeNik('000123'),'000123');
  assert.equal(normalizeNik('001-002'),'001-002');
  assert.equal(companyLabel('PT. HJF'),'HJF');
  assert.equal(companyLabel('PT KPS'),'KPS');
});
test('all position groups use the agreed table, including S3 to grade 2',()=>{
  for(const {grade,groups} of GRADE_RULES)for(const group of groups)assert.equal(classifyGrade(group+'.7','Operator').grade,grade,group);
  assert.deepEqual(['S3.7','M1.5','S1.1','P1.4','M1.5','S4.9'].map(code=>classifyGrade(code,'Operator').grade),['2','2','1','1','2','3']);
  assert.equal(gradeLabel('Golongan 2'),'2');
});
test('P1 Management Trainee has priority, including case, spacing, and department suffix',()=>{
  assert.equal(classifyGrade('P1.5','Management   Trainee, Production').grade,'MT');
  assert.equal(classifyGrade('p1.4','management trainee, Equipment').grade,'MT');
  assert.equal(classifyGrade('P1.5','Management Trainee').grade,'MT');
  assert.equal(classifyGrade('P1.5','Crawler Crane Operator').grade,'1');
  assert.equal(classifyGrade('M1.5','Management Trainee, Production').grade,'2');
  assert.equal(classifyGrade('P1.5','Assistant Management Trainee').grade,'1');
});
test('unknown code and missing P1 position are flagged instead of guessed',()=>{
  assert.equal(classifyGrade('P1.5','').grade,'');assert.match(classifyGrade('P1.5','').classificationReason,/Jabatan P1 kosong/);
  for(const code of ['P9.1','S5.2','M8.1','Z1.1','ABC',''])assert.equal(classifyGrade(code,'Operator').grade,'');
  for(const value of ['1','2','3','4','5','MT'])assert.equal(classifyGrade(value).grade,value);
});
test('multiline spreadsheet headings are detected below title rows',()=>{
  const rows=[['PT Karunia Permai Sentosa'],['Karyawan Aktif'],['No','N I K','Nama','Department','Subdept','Gol','COST\nCENTER','Jabatan'],[1,'S001','A','Production','Furnace','P1.4','HJF','Operator']];
  assert.equal(detectHeader(rows),2);
  const mapping=suggestMapping(rows[2]);assert.equal(mapping.nik,1);assert.equal(mapping.company,6);
  assert.equal(mapping.position,7);
  const parsed=mapRows(rows,2,mapping,'manpower');
  assert.equal(parsed.rows[0].company,'HJF');assert.equal(parsed.rows[0].grade,'1');assert.equal(parsed.rows[0].gradeRaw,'P1.4');
});
test('blank NIK and scientific notation are rejected; repeated headers are skipped',()=>{
  const rows=[['NIK','Nama'],['001','A'],['','Blank'],['NIK','Nama'],['1.2345E+15','Rounded']];
  const p=mapRows(rows,0,suggestMapping(rows[0]),'mess');
  assert.equal(p.rows.length,1);assert.equal(p.invalid.length,2);assert.equal(p.invalid[0].row,3);
});
const mess=[
  {nik:'S001',name:'Alpha',location:'Surya',block:'A',room:'101'},
  {nik:'s001',name:'Alpha',location:'Meranti',block:'B',room:'201'},
  {nik:'0002',name:'Beta',location:'Surya'},
  {nik:'X003',name:'Gamma',location:'Surya'},
  {nik:'X004',name:'Delta',location:''},
  {nik:'X005',name:'Epsilon',location:'Meranti'}
];
const mp=[
  {nik:'S001',company:'HJF',department:'Production',subdepartment:'Furnace',grade:'1'},
  {nik:'s001',company:'HJF',department:'production',subdepartment:'Furnace',grade:'1'},
  {nik:'0002',company:'KPS',department:'Equipment',subdepartment:'Maintenance',grade:'2'},
  {nik:'X004',company:'HJF',department:'Quality',subdepartment:'Lab',grade:'1'},
  {nik:'X004',company:'OST',department:'Quality',subdepartment:'Lab',grade:'1'},
  {nik:'X005',company:'HJF',department:'Production',subdepartment:'',grade:'2'},
  {nik:'NOTRESIDENT',company:'HJF',department:'Production',subdepartment:'Furnace',grade:'1'}
];
test('reconciliation counts unique mess NIK and flags conflicting master references',()=>{
  const d=reconcile(mess,mp),s=summary(d.residents);
  assert.equal(s.total,5);assert.equal(s.matched,3);assert.equal(s.review,3);assert.equal(s.incomplete,1);assert.equal(s.duplicate,1);
  const a=d.residents.find(r=>r.nik==='S001');assert.equal(a.status,'matched');assert.equal(a.messOccurrences,2);assert.deepEqual(a.locations,['Surya','Meranti']);
  assert.equal(d.residents.find(r=>r.nik==='X004').status,'ambiguous');assert.equal(d.residents.find(r=>r.nik==='X004').company,'');
  assert.equal(d.residents.find(r=>r.nik==='X003').status,'unmatched');assert.equal(d.duplicateMess.length,1);assert.equal(d.duplicateManpower.length,2);
});
test('cascading filters and missing classification/location are selectable',()=>{
  const rows=reconcile(mess,mp).residents;
  assert.equal(filterResidents(rows,{company:'HJF',department:'Production',grade:'1'}).length,1);
  assert.equal(filterResidents(rows,{location:'Meranti'}).length,2);
  assert.equal(filterResidents(rows,{company:UNKNOWN}).length,2);
  assert.equal(filterResidents(rows,{location:UNKNOWN}).length,1);
  assert.deepEqual(filterOptions(rows,{company:'KPS'},'department'),['Equipment']);
  assert.equal(filterResidents(rows,{},'ALPHA').length,1);
  assert.equal(filterResidents(rows,{},'','review').length,3);
  assert.equal(filterResidents(rows,{},'','duplicate').length,1);
});
test('cross-tab report conserves occupant count and grade totals',()=>{
  const rows=reconcile(mess,mp).residents;
  for(const group of ['company','department','subdepartment']){
    const report=buildReport(rows,group);
    assert.equal(report.rows.reduce((s,r)=>s+r.at(-1),0),rows.length);
    assert.equal(report.totals.at(-1),rows.length);
    assert.equal(report.totals.slice(1,-1).reduce((s,n)=>s+n,0),rows.length);
    for(let i=1;i<report.headers.length;i++)assert.equal(report.rows.reduce((s,r)=>s+r[i],0),report.totals[i]);
  }
});
test('categorical spacing/case are unified and differing original grade codes remain conflicts',()=>{
  const d=reconcile([{nik:'1',location:'Surya Camp'},{nik:'2',location:'surya  camp'},{nik:'3'}],[
    {nik:'1',company:'PT. HJF',department:'Production',subdepartment:'Furnace',gradeRaw:'P1.4',position:'Operator'},
    {nik:'2',company:'HJF',department:'production',subdepartment:'Furnace',gradeRaw:'P1.5',position:'Operator'},
    {nik:'3',company:'HJF',department:'production',subdepartment:'Furnace',gradeRaw:'P1.4',position:'Operator'},
    {nik:'3',company:'HJF',department:'production',subdepartment:'Furnace',gradeRaw:'P1.5',position:'Operator'}]);
  assert.equal(filterResidents(d.residents,{company:'HJF',department:'Production'}).length,2);
  assert.equal(filterResidents(d.residents,{location:'Surya Camp'}).length,2);
  assert.equal(d.residents[2].status,'ambiguous');
});
test('initial dataset is empty and contains no demonstration employees',()=>{
  const d=makeEmpty();assert.equal(d.mode,'empty');assert.equal(d.residents.length,0);assert.equal(d.importedAt,null);assert.equal(summary(d.residents).total,0);
});
test('saved manpower is reclassified using original code and position, not a stale grade',()=>{
  const d=reconcile([{nik:'ONE'},{nik:'TWO'},{nik:'THREE'}],[
    {nik:'ONE',company:'HJF',department:'Production',subdepartment:'Furnace',gradeRaw:'S3.7',grade:'3'},
    {nik:'TWO',company:'HJF',department:'Production',subdepartment:'Furnace',gradeRaw:'P1.5',grade:'1',position:'Management Trainee, Production'},
    {nik:'THREE',company:'HJF',department:'Production',subdepartment:'Furnace',gradeRaw:'P1.5',grade:'1'}]);
  assert.deepEqual(d.residents.map(r=>r.grade),['2','MT','']);assert.equal(d.residents[2].needsReview,true);
});
test('a duplicated P1 with conflicting trainee status is ambiguous',()=>{
  const common={nik:'ONE',company:'HJF',department:'Production',subdepartment:'Furnace',gradeRaw:'P1.5'};
  const d=reconcile([{nik:'ONE'}],[{...common,position:'Management Trainee, Production'},{...common,position:'Crawler Crane Operator'}]);
  assert.equal(d.residents[0].status,'ambiguous');assert.equal(d.residents[0].grade,'');
});
test('imported strings are escaped for DOM and spreadsheet formulas',()=>{
  assert.equal(escapeHtml('<img onerror="x">'),'&lt;img onerror=&quot;x&quot;&gt;');
  assert.equal(safeSpreadsheetCell('=SUM(A1:A2)'),"'=SUM(A1:A2)");assert.equal(safeSpreadsheetCell(42),42);
});
