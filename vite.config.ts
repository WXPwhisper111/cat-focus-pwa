import { defineConfig } from 'vite';
import { resolve, dirname } from 'node:path';
import { rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';

const cert = process.env.CAT_FOCUS_TLS_CERT;
const key = process.env.CAT_FOCUS_TLS_KEY;
const https = cert && key ? { cert: readFileSync(cert), key: readFileSync(key) } : undefined;
export default defineConfig({ plugins:[{name:'exclude-new-cat-source-art',async closeBundle(){ for(const name of ['cat-expansion-v1','cat_04','cat_05','cat_06']) { const base=resolve('dist'), target=resolve(base,name); if(dirname(target)!==base)throw Error('Unsafe build output'); await rm(target,{recursive:true,force:true}); } }}], base: './', server: { https }, preview: { https } });
