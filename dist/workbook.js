import { detectHeader, suggestMapping, safeSpreadsheetCell } from './core.js';
let library;
export async function xlsx() { if(!library)library=await import('./assets/xlsx.mjs');return library; }
export async function readWorkbook(file,type='') {
  if(!file || !/\.(xlsx|xls|csv)$/i.test(file.name))throw new Error('Pilih file Excel (.xlsx, .xls) atau CSV.');
  if(file.size>20*1024*1024)throw new Error('Ukuran file melebihi 20 MB. Pisahkan file menjadi lebih kecil.');
  const X=await xlsx(); let workbook;
  try {workbook=X.read(await file.arrayBuffer(),{type:'array',cellText:true,cellDates:false,raw:true,sheetRows:50042});}catch{throw new Error('File tidak bisa dibaca. Pastikan file valid dan tidak dikunci dengan kata sandi.');}
  if(!workbook.SheetNames.length)throw new Error('Workbook tidak memiliki sheet.');
  const output={name:file.name,size:file.size,workbook,sheet:workbook.SheetNames[0],rows:[],headerIndex:0,mapping:{},company:''};
  const named=workbook.SheetNames.find(s=>(type==='manpower'?/manpower|karyawan|employee|master/i:/mess|penghuni|hunian/i).test(s));
  const preferred=named || workbook.SheetNames.find(s=>!/rekap|summary|pivot|chart|grafik/i.test(s));
  if(preferred)output.sheet=preferred;
  setSheet(output,output.sheet,X);
  return output;
}
export function setSheet(source,name,X=library) {
  source.sheet=name;
  const sheet=source.workbook.Sheets[name];
  if(!sheet)throw new Error('Sheet tidak ditemukan.');
  // Formatted cell text retains displayed leading zeros; raw CSV fields stay text.
  source.rows=X.utils.sheet_to_json(sheet,{header:1,raw:false,defval:'',blankrows:true});
  if(source.rows.length>50040)throw new Error('Maksimal 50.000 baris data per sumber.');
  source.headerIndex=detectHeader(source.rows);
  source.mapping=suggestMapping(source.rows[source.headerIndex] || []);
  return source;
}
export function setHeader(source,index) {
  source.headerIndex=index;source.mapping=suggestMapping(source.rows[index] || []);
}
export function headers(source) { return (source.rows[source.headerIndex] || []).map((v,i)=>String(v).trim() || `Kolom ${i+1}`); }
export async function exportWorkbook(sheets,name) {
  const X=await xlsx();const book=X.utils.book_new();
  for(const {name:sheetName,rows,widths} of sheets){
    const sheet=X.utils.aoa_to_sheet(rows.map(row=>row.map(safeSpreadsheetCell)));
    sheet['!cols']=(widths || rows[0]?.map((_,i)=>i===0?24:18) || []).map(w=>({wch:w}));
    if(rows.length)sheet['!autofilter']={ref:X.utils.encode_range({s:{r:0,c:0},e:{r:rows.length-1,c:(rows[0]?.length||1)-1}})};
    X.utils.book_append_sheet(book,sheet,sheetName.slice(0,31));
  }
  const bytes=X.write(book,{type:'array',bookType:'xlsx',compression:true});
  const blob=new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  const url=URL.createObjectURL(blob);const anchor=document.createElement('a');anchor.href=url;anchor.download=name;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);
}
export async function downloadTemplate() {
  return exportWorkbook([
    {name:'Data Mess',rows:[['NIK','Nama','Lokasi Mess','Blok','No Kamar'],['CONTOH001','Karyawan Contoh A','Surya Residence','A','101'],['CONTOH002','Karyawan Contoh B','Cendana Residence','B','202'],['CONTOH003','Karyawan Contoh C','Surya Residence','A','102']]},
    {name:'Data Manpower',rows:[['NIK','Nama','Perusahaan','Department','Subdept','Gol','Jabatan'],['CONTOH001','Karyawan Contoh A','HJF','Production','Furnace','P1.5','Management Trainee, Production'],['CONTOH002','Karyawan Contoh B','KPS','Equipment','Operations','P1.5','Crawler Crane Operator'],['CONTOH003','Karyawan Contoh C','HJF','Production','Furnace','S3.7','Translator']]},
    {name:'Petunjuk',rows:[['Petunjuk'],['Gunakan sheet Data Mess untuk mess dan Data Manpower untuk manpower. Ganti seluruh baris contoh dengan data Anda.'],['NIK wajib berbentuk Teks. Awalan huruf dan nol dipertahankan; spasi dan huruf besar/kecil diseragamkan.'],['Cost Center hanya dipakai sebagai perusahaan jika isinya memang nama perusahaan.'],['Golongan 1: S1, P1. Golongan 2: S2, S3, P2, M1, M2. Golongan 3: S4, P3, P4, M3, M4. Golongan 4: P5, M5, M6, M7. Golongan 5: X1, X2, X3.'],['Khusus P1 dengan jabatan Management Trainee (termasuk tambahan departemen setelah koma) masuk MT. P1 tanpa jabatan perlu diperiksa.'],['Kode asli seperti P1.5 tetap disimpan dan ikut diekspor.']]}
  ],'Template_Mess_Insight.xlsx');
}
