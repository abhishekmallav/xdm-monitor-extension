// Optional integration check: node tests/browser-smoke.mjs
// Uses a separate, headless Edge profile; never opens the user's browser profile.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

if (process.argv.includes('--all') || process.argv.includes('--ui')) {
    const scenarios = process.argv.includes('--ui') ? ['ts', 'automatic-default', 'manual-cache'] : ['ts', 'fmp4', 'range', 'separate', 'aes', 'quality', 'threads', 'auto-save', 'automatic-default', 'manual-cache', 'live'];
    for (const fixture of scenarios) {
        const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--fixture=' + fixture], { encoding: 'utf8', windowsHide: true });
        process.stdout.write(child.stdout); process.stderr.write(child.stderr);
        if (child.status !== 0) process.exit(child.status || 1);
    }
    process.exit(0);
}
const fixture = process.argv.find(arg => arg.startsWith('--fixture='))?.split('=')[1] || 'ts';
const automatic = ['auto-save', 'automatic-default'].includes(fixture);
const repo = fileURLToPath(new URL('../', import.meta.url));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xdm-browser-smoke-'));
const profile = path.join(root, 'profile');
const downloads = path.join(root, 'downloads');
fs.mkdirSync(profile); fs.mkdirSync(downloads);
fs.mkdirSync(path.join(profile, 'Default'));
fs.writeFileSync(path.join(profile, 'Default', 'Preferences'), JSON.stringify({ download: { default_directory: downloads, prompt_for_download: false } }));
const binary = process.env.BROWSER_BINARY || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const extra = fixture === 'fmp4' ? ['-hls_segment_type', 'fmp4'] : fixture === 'range' ? ['-hls_flags', 'single_file'] : [];
if (fixture === 'aes') {
    fs.writeFileSync(path.join(root, 'key.bin'), Buffer.alloc(16, 7));
    fs.writeFileSync(path.join(root, 'keyinfo'), 'key.bin\n' + path.join(root, 'key.bin') + '\n');
    extra.push('-hls_key_info_file', path.join(root, 'keyinfo'));
}
if (fixture === 'separate') extra.push('-an');
const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=12',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', fixture === 'threads' ? '6' : '3', '-c:v', 'libx264', '-preset', 'ultrafast',
    '-pix_fmt', 'yuv420p', '-g', '12', '-c:a', 'aac', '-f', 'hls', '-hls_time', '1', '-hls_playlist_type', 'vod', ...extra, 'index.m3u8'],
{ cwd: root, encoding: 'utf8' });
assert.equal(result.status, 0, result.stderr);
if (fixture === 'separate') {
    const audio = spawnSync('ffmpeg', ['-hide_banner','-loglevel','error','-f','lavfi','-i','sine=frequency=880:sample_rate=44100','-t','3','-c:a','aac','-f','hls','-hls_time','1','-hls_playlist_type','vod','audio.m3u8'], {cwd:root,encoding:'utf8'});
    assert.equal(audio.status,0,audio.stderr);
    fs.renameSync(path.join(root,'index.m3u8'),path.join(root,'video.m3u8'));
    fs.writeFileSync(path.join(root,'index.m3u8'),'#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English",LANGUAGE="en",DEFAULT=YES,AUTOSELECT=YES,URI="audio.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=400000,RESOLUTION=320x180,CODECS="avc1.42c00a,mp4a.40.2",AUDIO="audio"\nvideo.m3u8\n');
}
if (fixture === 'quality') {
    fs.mkdirSync(path.join(root, 'high')); fs.mkdirSync(path.join(root, 'low'));
    for (const name of fs.readdirSync(root).filter(name=>/\.(ts|m3u8)$/.test(name))) fs.renameSync(path.join(root,name),path.join(root,'high',name));
    const low = spawnSync('ffmpeg', ['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc=size=160x90:rate=12','-f','lavfi','-i','sine=frequency=440:sample_rate=44100','-t','3','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-g','12','-c:a','aac','-f','hls','-hls_time','1','-hls_playlist_type','vod','index.m3u8'],{cwd:path.join(root,'low'),encoding:'utf8'});
    assert.equal(low.status,0,low.stderr);
    fs.writeFileSync(path.join(root,'index.m3u8'),'#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=200000,RESOLUTION=160x90,CODECS="avc1.42c00a,mp4a.40.2"\nlow/index.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=400000,RESOLUTION=320x180,CODECS="avc1.42c00a,mp4a.40.2"\nhigh/index.m3u8\n');
}
if (fixture === 'live') fs.writeFileSync(path.join(root,'index.m3u8'),fs.readFileSync(path.join(root,'index.m3u8'),'utf8').replace('#EXT-X-ENDLIST','').replace('#EXT-X-PLAYLIST-TYPE:VOD',''));
const requests = [];
let activeSegments = 0, maxSegments = 0;
const server = http.createServer((request, response) => {
    if (request.url === '/watch') {
        response.setHeader('Content-Type', 'text/html');
        response.end('<!doctype html><title>HLS browser test</title><h1>HLS test video</h1><script>fetch("/index.m3u8",{headers:{Authorization:"Bearer fixture"}})</script>');
        return;
    }
    const name = new URL(request.url, 'http://localhost').pathname.slice(1);
    if (!/^(?:(?:low|high)\/)?(?:index|video|audio|init|key)(?:\d+)?\.(?:m3u8|ts|mp4|m4s|bin)$/.test(name)) { response.writeHead(404).end(); return; }
    requests.push({ url: request.url, headers: request.headers });
    if (request.headers.authorization !== 'Bearer fixture' || !request.headers.referer?.endsWith('/watch')) {
        response.writeHead(403).end('Missing original request context'); return;
    }
    const bytes = fs.readFileSync(path.join(root, name));
    const range = /bytes=(\d+)-(\d*)/.exec(request.headers.range || '');
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
    response.writeHead(range ? 206 : 200, { 'Content-Type': name.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t',
        'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes',
        ...(range ? { 'Content-Range': `bytes ${start}-${end}/${bytes.length}` } : {}) });
    if (/\.(ts|m4s)$/.test(name)) {
        activeSegments++; maxSegments = Math.max(maxSegments, activeSegments);
        setTimeout(() => { response.end(bytes.subarray(start, end + 1)); activeSegments--; }, 150);
    } else response.end(bytes.subarray(start, end + 1));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
let browser, socket;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, description, timeout = 25000) {
    const start = Date.now();
    while (Date.now() - start < timeout) { const value = await fn(); if (value) return value; await wait(150); }
    throw new Error('Timed out: ' + description);
}
try {
    browser = spawn(binary, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile,
        '--load-extension=' + repo, '--disable-extensions-except=' + repo, '--no-first-run',
        ...(fixture === 'aes' ? ['--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'] : []), '--disable-background-networking', '--disable-component-update', '--disable-sync', 'about:blank'],
    { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = ''; browser.stderr.on('data', data => { stderr += data; });
    const debug = await until(() => {
        const file = path.join(profile, 'DevToolsActivePort');
        if (browser.exitCode !== null) throw new Error(stderr);
        return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split(/\r?\n/) : null;
    }, 'browser startup');
    socket = new WebSocket(`ws://127.0.0.1:${debug[0]}${debug[1]}`);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    let nextId = 0; const pending = new Map();
    socket.onmessage = event => {
        const message = JSON.parse(event.data);
        if (!message.id) return;
        const handler = pending.get(message.id); if (!handler) return;
        pending.delete(message.id);
        if (message.error) handler.reject(new Error(JSON.stringify(message.error))); else handler.resolve(message.result);
    };
    function command(method, params = {}, sessionId) {
        return new Promise((resolve, reject) => {
            const id = ++nextId; pending.set(id, { resolve, reject });
            socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
        });
    }
    async function evaluate(session, expression) {
        const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, session);
        if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
        return result.result.value;
    }
    const targets = async () => (await command('Target.getTargets')).targetInfos;
    const worker = await until(async () => (await targets()).find(t => t.type === 'service_worker' && t.url.endsWith('/main.js')), 'extension worker');
    const workerSession = (await command('Target.attachToTarget', { targetId: worker.targetId, flatten: true })).sessionId;
    const extension = new URL(worker.url).origin === 'null' ? worker.url.replace(/main\.js$/, '') : '';
    assert(extension.startsWith('chrome-extension://'));
    await until(() => evaluate(workerSession, `typeof chrome !== 'undefined' && !!chrome.tabs`), 'extension API initialization');
    const source = await evaluate(workerSession, `chrome.tabs.create({url:'http://127.0.0.1:${port}/watch',active:true})`);
    await until(async () => (await evaluate(workerSession, `chrome.storage.session.get('hlsStreams')`)).hlsStreams?.[source.id]?.length, 'HLS detection');
    const popup = await evaluate(workerSession, `chrome.tabs.create({url:chrome.runtime.getURL('popup.html'),active:false})`);
    const popupSession = (await command('Target.attachToTarget', { targetId: (await until(async () => (await targets()).find(t => t.url === extension + 'popup.html'), 'popup')).targetId, flatten: true })).sessionId;
    await until(() => evaluate(popupSession, `document.querySelectorAll('.media-title-btn').length`), 'popup HLS row');
    assert((await evaluate(popupSession, `document.getElementById('mediaCount').textContent`)).includes('1 item'));
    const chosen = fixture === 'threads' ? { threads: 4 } : fixture === 'auto-save' ? { autoSave: true, clearCache: false, filenameType: 'filename' } : fixture === 'quality' ? { defaultResolution: '160x90' } : {};
    const prefs = { ...chosen, ...(automatic ? {} : { autoSave: false }), ...(fixture === 'manual-cache' ? { clearCache: false } : {}) };
    if (fixture !== 'automatic-default') await evaluate(popupSession, `localStorage.setItem('xdm-hls-automatic-save-v1','1')`);
    await evaluate(popupSession, `localStorage.setItem('xdm-hls-options',${JSON.stringify(JSON.stringify(prefs))});document.querySelector('.media-title-btn').click()`);
    const downloader = await until(async () => (await targets()).find(t => t.url.startsWith(extension + 'hls.html?')), 'download tab');
    const downloadSession = (await command('Target.attachToTarget', { targetId: downloader.targetId, flatten: true })).sessionId;
    if (fixture === 'live') {
        await until(() => evaluate(downloadSession, `(document.querySelector('[selector="error"]')?.textContent + document.getElementById('downloadError').textContent).includes('Live or unfinished')`), 'live rejection').catch(async error => { console.error(await evaluate(downloadSession, `document.body.innerText`)); console.error(requests.map(r=>r.url)); throw error; });
        assert(!requests.some(item => /\.(ts|m4s)$/.test(item.url)), 'Live segments should not be downloaded');
        console.log(JSON.stringify({ result:'PASS', fixture, checks:'Completed-video-only guard rejects live playlists' }));
        await command('Browser.close').catch(()=>{});
        process.exitCode=0;
    } else {
    downloadScenario: {
    await until(async () => {
        const state = await evaluate(downloadSession, `({status:document.getElementById('downloadStatus').textContent,error:document.getElementById('downloadError').textContent,panelError:document.querySelector('[selector="error"]')?.textContent})`);
        if (state.error || state.panelError) throw new Error(state.error || state.panelError);
        return automatic ? state.status.startsWith('Saved ') : state.status.includes('Download complete');
    }, 'FetchV pipeline and MP4 assembly').catch(async error => { console.error(await evaluate(downloadSession, `(async()=>({body:document.body.innerText,settings:localStorage.getItem('xdm-hls-options'),downloads:await chrome.downloads.search({})}))()`)); throw error; });
    const defaults = await evaluate(downloadSession, `({tab:document.querySelector('[selector="tab-progress"]').checked,naming:document.querySelector('[selector="filename-type"][value="title"]').checked,save:document.querySelector('[selector="auto-save"]').checked,title:document.title})`);
    assert.equal(defaults.tab, true); assert.equal(defaults.naming, fixture !== 'auto-save'); assert.equal(defaults.save, automatic);
    assert(defaults.title.includes('Completed'));
    await evaluate(downloadSession, `document.querySelector('[selector="options"]').click()`);
    await wait(300);
    await command('Page.enable', {}, downloadSession);
    const screenshot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, downloadSession);
    fs.writeFileSync(path.join(root, 'downloader.png'), Buffer.from(screenshot.data, 'base64'));
    const theme = await evaluate(downloadSession, `document.documentElement.dataset.theme`);
    await evaluate(downloadSession, `document.getElementById('downloadTheme').click()`);
    assert.notEqual(await evaluate(downloadSession, `document.documentElement.dataset.theme`), theme);
    const lightScreenshot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, downloadSession);
    fs.writeFileSync(path.join(root, 'downloader-alternate-theme.png'), Buffer.from(lightScreenshot.data, 'base64'));
    if (fixture === 'quality') {
        assert(await evaluate(downloadSession, `document.querySelector('[selector="default-resolution"]').checked`));
        assert((await evaluate(downloadSession, `document.querySelector('[selector="quality"]').textContent`)).includes('160x90'));
    }
    if (fixture === 'threads') assert(maxSegments >= 3 && maxSegments <= 4, 'Thread setting should control concurrent segment requests');
    const modern = await evaluate(downloadSession, `({pills:document.querySelectorAll('.download-stats .stat-pill').length,bar:document.querySelector('.progress').getBoundingClientRect().height,labels:[...document.querySelectorAll('.download-actions .btn')].every(button=>!!button.querySelector('.button-label'))})`);
    assert(modern.pills >= 3); assert(modern.bar <= 20); assert(modern.labels);
    if (fixture === 'manual-cache') {
        assert.equal(await evaluate(downloadSession, `document.getElementById('clearDownloadCache').disabled`),false);
        await evaluate(downloadSession, `document.getElementById('clearDownloadCache').click()`);
        assert(await evaluate(downloadSession, `document.getElementById('downloadStatus').textContent.startsWith('Cache cleared.') && document.querySelector('[selector="save"]').disabled && document.getElementById('clearDownloadCache').disabled`));
        assert.equal(fs.readdirSync(downloads).length,0);
        console.log(JSON.stringify({result:'PASS',fixture,checks:'On-demand cache clearing, no accidental save, safe disabled controls'}));
        await command('Browser.close').catch(()=>{});
        break downloadScenario;
    }
    if (!automatic) {
    // Accelerate only FetchV's 60-second post-save cache countdown in this test.
    if (fixture === 'ts') await evaluate(downloadSession, `globalThis.nativeSetInterval=setInterval;globalThis.setInterval=(callback,delay,...args)=>nativeSetInterval(callback,callback.toString().includes('clearCacheTimer')?2:delay,...args)`);
    // Exercise the production save API unchanged; it must never open a chooser.
    await evaluate(downloadSession, `document.querySelector('[selector="save"]').click()`);
    await until(async () => {
        const state = await evaluate(downloadSession, `({status:document.getElementById('downloadStatus').textContent,error:document.getElementById('downloadError').textContent})`);
        if (state.error) throw new Error(state.error);
        return state.status.startsWith('Saved ');
    }, 'Chrome saving MP4');
    }
    if (fixture === 'ts') {
        await until(()=>evaluate(downloadSession, `!document.querySelector('[selector="clear-cache-end"]').classList.contains('d-none')`),'post-save cache clearing');
        assert(await evaluate(downloadSession, `document.querySelector('[selector="save"]').disabled`));
    }
    const mp4 = fs.readdirSync(downloads).find(name => name.endsWith('.mp4'));
    assert(mp4, 'Chrome did not create the MP4');
    assert.equal(mp4, fixture === 'auto-save' ? 'index.mp4' : 'HLS browser test.mp4', 'Chrome should preserve the chosen filename: ' + JSON.stringify(await evaluate(downloadSession, `chrome.downloads.search({})`)));
    const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=duration', '-of', 'json', path.join(downloads, mp4)], { encoding: 'utf8' });
    assert.equal(probe.status, 0, probe.stderr);
    const media = JSON.parse(probe.stdout);
    const types = media.streams.map(stream => stream.codec_type);
    const expectedDuration = fixture === 'threads' ? 6 : 3;
    assert(Math.abs(Number(media.format.duration) - expectedDuration) < 0.5, 'Complete video duration should be preserved');
    const expectedWidth = fixture === 'quality' ? 160 : 320;
    assert(media.streams.some(stream => stream.codec_type === 'video' && stream.width === expectedWidth));
    const decode = spawnSync('ffmpeg', ['-v','error','-i',path.join(downloads,mp4),'-f','null','-'], {encoding:'utf8'});
    assert.equal(decode.status,0,decode.stderr);
    assert(types.includes('video') && types.includes('audio'));
    console.log(JSON.stringify({ result: 'PASS', fixture, maxSegments, checks: 'HLS detection, existing popup, new tab, FetchV loader/muxers, header replay, settings defaults, light/dark themes, real Chrome downloads API, audio/video output', screenshot: path.join(root, 'downloader.png'), mp4: path.join(downloads, mp4), requests: requests.length }));
    await command('Browser.close').catch(() => {});
    }
    }
} finally {
    socket?.close();
    browser?.kill();
    await new Promise(resolve => server.close(resolve));
    // Keep this isolated run's screenshot and MP4 in the printed temporary directory for inspection.
}
