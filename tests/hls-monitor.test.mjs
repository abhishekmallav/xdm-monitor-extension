import { test } from 'node:test';
import assert from 'node:assert/strict';
import HlsMonitor from '../src/background/hls-monitor.js';
import App from '../src/background/app.js';
import { isHlsResponse, replayHeaders, safeFilename } from '../src/shared/hls.js';

function mockChrome() {
    const data = {}, rules = [], opened = [], cancelled = [];
    const event = () => ({ listeners: [], addListener(fn) { this.listeners.push(fn); }, emit(...args) { for (const fn of this.listeners) fn(...args); } });
    globalThis.chrome = {
        storage: { session: {
            async get(keys) {
                if (keys === null) return structuredClone(data);
                return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(k => k in data).map(k => [k, structuredClone(data[k])]));
            },
            async set(values) { Object.assign(data, structuredClone(values)); },
            async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; }
        } },
        runtime: { id: 'xdm', getURL: file => 'chrome-extension://xdm/' + file, async sendMessage() {} },
        action: { setIcon() {}, setPopup() {}, setBadgeText() {} },
        tabs: { async get(id) { return { id, url: 'https://player.test/watch', title: 'Test video' }; },
            async create(info) { opened.push(info); return { id: 88 }; }, onUpdated: event(), onRemoved: event() },
        webRequest: { onSendHeaders: event(), onHeadersReceived: event(), onCompleted: event(), onErrorOccurred: event() },
        declarativeNetRequest: { async getSessionRules() { return rules.flatMap(r => r.addRules || []); }, async updateSessionRules(value) { rules.push(value); } },
        downloads: { cancel(id, callback) { cancelled.push(id); callback?.(); }, erase() {} }
    };
    return { data, rules, opened, cancelled };
}

async function capture(monitor, overrides = {}) {
    const info = { tabId: 7, requestId: 'request', method: 'GET', statusCode: 200,
        url: 'https://cdn.test/playlist.m3u8?token=secret', responseHeaders: [], ...overrides };
    chrome.webRequest.onSendHeaders.emit({ ...info, requestHeaders: [
        { name: 'Referer', value: 'https://player.test/' }, { name: 'Origin', value: 'https://player.test' },
        { name: 'Authorization', value: 'Bearer secret' }, { name: 'Cookie', value: 'session=secret' }
    ] });
    chrome.webRequest.onHeadersReceived.emit(info);
    await monitor.queue;
    chrome.webRequest.onCompleted.emit(info);
}

test('detects HLS by URL or normalized MIME type, including extensionless URLs', () => {
    assert(isHlsResponse('https://cdn.test/a.M3U8?signature=1'));
    assert(isHlsResponse('https://cdn.test/stream/123', [{ name: 'Content-Type', value: 'Application/X-MpegURL; charset=UTF-8' }]));
    assert(!isHlsResponse('https://cdn.test/segment.ts'));
    assert(!isHlsResponse('blob:https://site.test/video'));
    assert.equal(safeFilename('a/b:test.mp4'), 'a_b_test.mp4');
    assert.equal(safeFilename('CON'), '_CON.mp4');
    assert(new TextEncoder().encode(safeFilename('??'.repeat(100))).length < 255);
    assert.deepEqual(replayHeaders([{ name: 'Cookie', value: 'secret' }, { name: 'Range', value: 'bytes=0-4' }]), []);
});

test('detection deduplicates per tab, survives worker restart, pauses and clears on navigation', async () => {
    mockChrome();
    const monitor = new HlsMonitor(() => {}); monitor.register();
    await capture(monitor); await capture(monitor);
    assert.equal(monitor.list(7).length, 1);
    assert.equal(monitor.list(8).length, 0);
    assert(!('headers' in monitor.list(7)[0]));
    assert.equal(monitor.requests.size, 0);
    const restored = new HlsMonitor(() => {}); await restored.ready;
    assert.equal(restored.list(7).length, 1);
    await monitor.setPaused(true);
    await capture(monitor, { url: 'https://cdn.test/second.m3u8' });
    assert.equal(monitor.list(7).length, 1);
    chrome.tabs.onUpdated.emit(7, { status: 'loading', url: 'https://player.test/next' });
    await monitor.queue;
    assert.equal(monitor.list(7).length, 0);
});

test('failed responses and blocked domains do not create download entries', async () => {
    mockChrome();
    const monitor = new HlsMonitor(() => {}, url => url.includes('blocked.test')); monitor.register();
    await capture(monitor, { statusCode: 403 });
    await capture(monitor, { url: 'https://blocked.test/stream.m3u8' });
    assert.equal(monitor.list(7).length, 0);
});

test('download opens locally, binds task to its tab, scopes auth headers and cleans rules', async () => {
    const state = mockChrome();
    const monitor = new HlsMonitor(() => {}); monitor.register(); await capture(monitor);
    await monitor.open(monitor.list(7)[0].id, 7);
    const url = state.opened[0].url;
    assert(url.startsWith('chrome-extension://xdm/hls.html?task='));
    const taskId = new URL(url).searchParams.get('task');
    const downloadTabId = 1_900_000_000;
    const task = await monitor.getTask(taskId, downloadTabId);
    assert(!('headers' in task));
    await assert.rejects(monitor.getTask(taskId, 99), /expired/);
    const added = state.rules.at(-1).addRules;
    assert(added.every(rule => rule.condition.tabIds[0] === downloadTabId));
    const auth = added.find(rule => rule.action.requestHeaders.some(h => h.header === 'Authorization'));
    assert(new RegExp(auth.condition.regexFilter).test('https://cdn.test/segment.ts'));
    assert(!new RegExp(auth.condition.regexFilter).test('https://cdn.test.evil.test/segment.ts'));
    assert(!new RegExp(auth.condition.regexFilter).test('https://other.test/segment.ts'));
    assert(!added.some(rule => rule.action.requestHeaders.some(h => h.header.toLowerCase() === 'cookie')));
    assert(added.every(rule => Number.isInteger(rule.id) && rule.id < 2147483647));
    await monitor.cleanupTask(downloadTabId);
    assert(!state.data['hlsTask:' + taskId]);
    assert.equal(state.rules.at(-1).removeRuleIds.length, 2);
});

test('popup exposes HLS without desktop and native media dispatch remains unchanged', async () => {
    mockChrome();
    const app = new App();
    await app.hlsMonitor.ready;
    app.hlsMonitor.streams[7] = [{ id: 'hls-id', title: 'HLS', url: 'https://cdn.test/a.m3u8', tabId: 7 }];
    const response = await new Promise(resolve => app.onPopupMessage({ type: 'stat', tabId: 7 },
        { url: 'chrome-extension://xdm/popup.html' }, resolve));
    assert.equal(response.desktopConnected, false);
    assert.equal(response.enabled, true);
    assert.equal(response.list[0].kind, 'hls');
    let command;
    app.connector.postMessage = (url, body) => { command = { url, body }; };
    app.onPopupMessage({ type: 'vid', itemId: 42 }, {}, () => {});
    assert.deepEqual(command, { url: '/vid', body: { vid: '42' } });
});

test('Chrome saves initiated by this extension are never taken over by XDM', async () => {
    const state = mockChrome();
    const app = new App(); await app.hlsMonitor.ready;
    app.appEnabled = true; app.connector.connected = true; app.fileExts = ['.MP4'];
    app.hlsFilenames.set('blob:chrome-extension://xdm/test', 'Chosen video.mp4');
    let suggestion;
    app.onDeterminingFilename({ id: 5, byExtensionId: 'xdm', url: 'blob:chrome-extension://xdm/test', filename: 'test' }, value => { suggestion = value; });
    assert.deepEqual(suggestion, { filename: 'Chosen video.mp4', conflictAction: 'uniquify' });
    assert.equal(app.hlsFilenames.size, 0);
    assert.deepEqual(state.cancelled, []);
    let triggered = false; app.triggerDownload = () => { triggered = true; };
    app.onDeterminingFilename({ id: 6, url: 'https://cdn.test/video.mp4', filename: 'video.mp4' }, () => {});
    assert.deepEqual(state.cancelled, [6]); assert(triggered);
});
test('concurrent tasks reserve different header rules even when one has no replay headers', async () => {
    const state = mockChrome();
    const monitor = new HlsMonitor(() => {}); await monitor.ready;
    monitor.streams[7] = [
        { id: 'plain', tabId: 7, url: 'https://cdn.test/plain.m3u8', headers: [] },
        { id: 'auth', tabId: 7, url: 'https://cdn.test/auth.m3u8', headers: [{ name: 'Authorization', value: 'Bearer test' }] }
    ];
    await monitor.open('plain', 7); await monitor.open('auth', 7);
    const [first, second] = state.opened.map(tab => new URL(tab.url).searchParams.get('task'));
    await monitor.getTask(first, 80); await monitor.getTask(second, 81);
    const firstRules = state.data['hlsTask:' + first].ruleIds;
    const secondRules = state.data['hlsTask:' + second].ruleIds;
    assert(firstRules.every(id => !secondRules.includes(id)));
    await monitor.cleanupTask(80);
    assert(state.rules.at(-1).removeRuleIds.every(id => !secondRules.includes(id)));
});
