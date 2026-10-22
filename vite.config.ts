import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

const cert = process.env.CAT_FOCUS_TLS_CERT;
const key = process.env.CAT_FOCUS_TLS_KEY;
const https = cert && key ? { cert: readFileSync(cert), key: readFileSync(key) } : undefined;
export default defineConfig({ base: './', server: { https }, preview: { https } });
