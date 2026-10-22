import test from 'node:test';
import assert from 'node:assert/strict';
import {readWorkbook,setSheet} from '../dist/workbook.js';
import * as X from '../dist/assets/xlsx.mjs';
import {mapRows} from '../dist/core.js';
const file=(name,bytes)=>({name,size:bytes.byteLength,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)});
test('real XLSX input preserves text NIK and numeric zero-padding across multiple sheets',async()=>{
  const book=X.utils.book_new();X.utils.book_append_sheet(book,X.utils.aoa_to_sheet([['Ringkasan']]),'Rekap');
  const sheet=X.utils.aoa_to_sheet([['Database Mess'],[],['N I K','N A M A','LOKASI MESS','NO KAMAR'],['S00001','Alpha','Surya','001'],[123,'Beta','Surya','002']]);sheet.A5.z='000000';
  X.utils.book_append_sheet(book,sheet,'Penghuni');
  const source=await readWorkbook(file('mess.xlsx',X.write(book,{type:'buffer',bookType:'xlsx'})));
  assert.equal(source.sheet,'Penghuni');assert.equal(source.headerIndex,2);
  const mapped=mapRows(source.rows,source.headerIndex,source.mapping,'mess');assert.equal(mapped.rows[0].nik,'S00001');assert.equal(mapped.rows[1].nik,'000123');assert.equal(mapped.rows[0].room,'001');
  setSheet(source,'Rekap');assert.equal(source.sheet,'Rekap');
});
test('CSV with leading-zero NIK remains text',async()=>{
  const bytes=Buffer.from('NIK,Nama,Lokasi Mess\n0000123,Contoh,Surya\nS00123,Contoh Dua,Meranti');
  const source=await readWorkbook(file('mess.csv',bytes));
  const p=mapRows(source.rows,source.headerIndex,source.mapping,'mess');assert.equal(p.rows[0].nik,'0000123');assert.equal(p.rows[1].nik,'S00123');
});
test('unsupported and oversized uploads fail before parsing',async()=>{
  await assert.rejects(()=>readWorkbook({name:'photo.png',size:100}),/Pilih file Excel/);
  await assert.rejects(()=>readWorkbook({name:'huge.xlsx',size:21*1024*1024}),/20 MB/);
});
test('source type automatically selects the correct sheet in a two-source workbook',async()=>{
  const book=X.utils.book_new();
  X.utils.book_append_sheet(book,X.utils.aoa_to_sheet([['NIK','Nama'],['001','A']]),'Data Mess');
  X.utils.book_append_sheet(book,X.utils.aoa_to_sheet([['NIK','Perusahaan','Department','Subdept','Gol','Jabatan'],['001','HJF','Production','Furnace','P1.5','Management Trainee, Production']]),'Data Manpower');
  const bytes=X.write(book,{type:'buffer',bookType:'xlsx'});
  const m=await readWorkbook(file('sources.xlsx',bytes),'mess'),p=await readWorkbook(file('sources.xlsx',bytes),'manpower');
  assert.equal(m.sheet,'Data Mess');assert.equal(p.sheet,'Data Manpower');
  assert.equal(mapRows(p.rows,p.headerIndex,p.mapping,'manpower').rows[0].grade,'MT');
});
test('legacy XLS format is accepted and preserves the agreed classification',async()=>{
  const book=X.utils.book_new();
  X.utils.book_append_sheet(book,X.utils.aoa_to_sheet([['NIK','Nama','Gol','Jabatan'],['S0001','A','S3.7','Operator']]),'Manpower');
  const source=await readWorkbook(file('legacy.xls',X.write(book,{type:'buffer',bookType:'biff8'})),'manpower');
  const parsed=mapRows(source.rows,source.headerIndex,source.mapping,'manpower');assert.equal(parsed.rows[0].nik,'S0001');assert.equal(parsed.rows[0].grade,'2');
});
