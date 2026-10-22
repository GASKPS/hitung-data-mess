import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
const root=resolve(import.meta.dirname,'..');
for (const file of ['dist/index.html','dist/app.js','dist/core.js','dist/workbook.js','dist/cloud.js','dist/styles.css','dist/assets/xlsx.mjs','dist/assets/supabase.js']) {
  if(!existsSync(resolve(root,file)))throw new Error(`Berkas wajib tidak ditemukan: ${file}`);
}
writeFileSync(resolve(root,'dist/schema.sql'),readFileSync(resolve(root,'supabase/schema.sql')));
console.log('Static build ready: dist/');
