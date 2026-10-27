// Rebuild the local module from the exact hosted loader snapshot. No network access.
// Only its pure string table/decoder is evaluated, in an empty, time-limited VM context.
import fs from 'node:fs';
import vm from 'node:vm';
const root = new URL('../vendor/stream/', import.meta.url);
const source = fs.readFileSync(new URL('upstream/hls-loader.js', root), 'utf8');
const prefixEnd = source.indexOf('const _0x57028d=');
if (prefixEnd < 0) throw new Error('This adapter only supports the pinned FetchV v3 snapshot.');
const context = vm.createContext(Object.create(null));
vm.runInContext(source.slice(0, prefixEnd), context, { timeout: 1000 });
const decoded = source.replace(/_0x[a-f0-9]+\((0x[a-f0-9]+),'((?:\\.|[^'])*)'\)/gi, (call, index, key) => {
    try { return JSON.stringify(vm.runInContext(`_0x4d61(${index},'${key}')`, context, { timeout: 50 })); }
    catch { return call; }
});
const start = decoded.indexOf('const bootstrap=window');
const end = decoded.indexOf('const temporaryChannel');
if (start < 0 || end < start) throw new Error('Unexpected upstream loader structure.');
let core = decoded.slice(start, end);
const prefix = 'const bootstrap=window["bootstrap"],baseURL=document?.[\'currentScript\']?.["src"],MODULE_PATH=';
if (!core.startsWith(prefix)) throw new Error('Unexpected module path initialization.');
core = core.replace(prefix, "import { bootstrap } from '../bootstrap/bootstrap.bundle.min.js';\nconst baseURL=import.meta.url;\nconst MODULE_PATH=");
core = "// Adapted from FetchV's hosted v3 loader. See README.md for source and local changes.\nconst _0x1c8694 = () => { throw new Error('Unexpected obfuscated lookup'); };\nconst _0x4d61 = _0x1c8694;\n" + core;
core += '\nexport { Controller, Panel, Fetcher };\n';
fs.writeFileSync(new URL('hls-loader.js', root), core);
console.log('Rebuilt the local FetchV Controller, Panel and Fetcher module.');
