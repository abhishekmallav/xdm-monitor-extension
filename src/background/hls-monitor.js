import { isHlsResponse, publicStream, replayHeaders } from '../shared/hls.js';

export default class HlsMonitor {
    constructor(onChange, isBlocked = () => false) {
        this.onChange = onChange;
        this.isBlocked = isBlocked;
        this.streams = {};
        this.requests = new Map();
        this.paused = false;
        this.queue = Promise.resolve();
        this.ready = chrome.storage.session.get(['hlsStreams', 'hlsPaused']).then(data => {
            this.streams = data.hlsStreams || {};
            this.paused = data.hlsPaused === true;
        });
    }

    register() {
        const filter = { urls: ['http://*/*', 'https://*/*'] };
        chrome.webRequest.onSendHeaders.addListener(details => {
            if (details.tabId < 0 || details.method !== 'GET') return;
            if (this.requests.size > 4000) this.requests.clear();
            this.requests.set(details.requestId, details.requestHeaders || []);
        }, filter, ['requestHeaders', 'extraHeaders']);
        chrome.webRequest.onHeadersReceived.addListener(details => {
            const headers = this.requests.get(details.requestId) || [];
            if (details.tabId < 0 || details.method !== 'GET' || details.statusCode < 200 ||
                details.statusCode >= 300 || !isHlsResponse(details.url, details.responseHeaders)) return;
            this.enqueue(async () => {
                if (this.paused || this.isBlocked(details.url)) return;
                const tab = await chrome.tabs.get(details.tabId).catch(() => null);
                if (!tab || tab.url?.startsWith(chrome.runtime.getURL(''))) return;
                const list = this.streams[details.tabId] || [];
                const existing = list.find(item => item.url === details.url);
                const item = { id: existing?.id || crypto.randomUUID(), tabId: details.tabId,
                    url: details.url, title: tab.title || 'HLS video', pageUrl: tab.url,
                    headers: replayHeaders(headers), detectedAt: Date.now() };
                this.streams[details.tabId] = [...list.filter(s => s.id !== item.id), item].slice(-50);
                await this.persist();
                this.onChange();
            });
        }, filter, ['responseHeaders']);
        const cleanup = details => this.requests.delete(details.requestId);
        chrome.webRequest.onCompleted.addListener(cleanup, filter);
        chrome.webRequest.onErrorOccurred.addListener(cleanup, filter);
        chrome.tabs.onUpdated.addListener((tabId, change) => {
            if (change.status === 'loading' && change.url) this.clear(tabId);
        });
        chrome.tabs.onRemoved.addListener(tabId => {
            this.clear(tabId);
            this.cleanupTask(tabId).catch(console.error);
        });
    }

    enqueue(action) {
        const result = this.queue.then(() => this.ready).then(action);
        this.queue = result.catch(console.error);
        return result;
    }

    persist() { return chrome.storage.session.set({ hlsStreams: this.streams }); }

    list(tabId) { return (this.streams[tabId] || []).map(publicStream); }

    clear(tabId) {
        return this.enqueue(async () => {
            delete this.streams[tabId];
            await this.persist();
            this.onChange();
        });
    }

    async setPaused(paused) {
        await this.ready;
        this.paused = paused;
        await chrome.storage.session.set({ hlsPaused: paused });
    }

    async open(id, tabId) {
        await this.queue;
        await this.ready;
        const stream = this.streams[tabId]?.find(item => item.id === id);
        if (!stream) throw new Error('This stream is no longer available. Play the video and refresh the popup.');
        const taskId = crypto.randomUUID();
        await chrome.storage.session.set({ ['hlsTask:' + taskId]: { ...stream, taskId } });
        const tab = await chrome.tabs.create({ url: chrome.runtime.getURL('hls.html') + '?task=' + taskId });
        // The downloader claims its task itself; avoid a tab-creation/load race.
        return tab.id;
    }

    getTask(taskId, tabId) {
        return this.enqueue(() => this.claimTask(taskId, tabId));
    }

    async claimTask(taskId, tabId) {
        const key = 'hlsTask:' + taskId;
        const task = (await chrome.storage.session.get(key))[key];
        if (!task || (task.downloadTabId !== undefined && task.downloadTabId !== tabId)) {
            throw new Error('Download session expired. Reopen the stream from the popup.');
        }
        task.downloadTabId = tabId;
        if (!task.ruleIds) {
            const used = new Set((await chrome.declarativeNetRequest.getSessionRules()).map(rule => rule.id));
            const sessions = await chrome.storage.session.get(null);
            for (const [key, value] of Object.entries(sessions)) {
                if (key.startsWith('hlsTask:')) for (const id of value.ruleIds || []) used.add(id);
            }
            let id = 10000;
            while (used.has(id) || used.has(id + 1)) id += 2;
            task.ruleIds = [id, id + 1];
        }
        await chrome.storage.session.set({ [key]: task });
        const headers = task.headers || [];
        const contextHeaders = headers.filter(h => /^(origin|referer)$/i.test(h.name));
        const privateHeaders = headers.filter(h => !/^(origin|referer)$/i.test(h.name));
        const [baseId] = task.ruleIds;
        const rules = [];
        if (contextHeaders.length) rules.push({ id: baseId, priority: 1,
            action: { type: 'modifyHeaders', requestHeaders: contextHeaders.map(h => ({ header: h.name, operation: 'set', value: h.value })) },
            condition: { tabIds: [tabId], resourceTypes: ['xmlhttprequest'], regexFilter: '^https?://' } });
        if (privateHeaders.length) {
            const origin = new URL(task.url).origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            rules.push({ id: baseId + 1, priority: 2,
                action: { type: 'modifyHeaders', requestHeaders: privateHeaders.map(h => ({ header: h.name, operation: 'set', value: h.value })) },
                condition: { tabIds: [tabId], resourceTypes: ['xmlhttprequest'], regexFilter: '^' + origin + '/' } });
        }
        await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [baseId, baseId + 1], addRules: rules });
        return { url: task.url, title: task.title, pageUrl: task.pageUrl, taskId, tabId, sourceTabId: task.tabId, requestId: task.id }; 
    }

    async resources(taskId, tabId) {
        const key = 'hlsTask:' + taskId;
        const task = (await chrome.storage.session.get(key))[key];
        if (!task || task.downloadTabId !== tabId) throw new Error('Download session expired.');
        return Object.fromEntries((this.streams[task.tabId] || []).map(stream => [stream.id, {
            requestId: stream.id, url: stream.url, method: 'GET', type: 'hls', headers: {}
        }]));
    }

    cleanupTask(tabId) {
        return this.enqueue(async () => {
            const all = await chrome.storage.session.get(null);
            const keys = Object.keys(all).filter(key => key.startsWith('hlsTask:') && all[key].downloadTabId === tabId);
            const ids = keys.flatMap(key => all[key].ruleIds || []);
            if (ids.length) await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: ids });
            if (keys.length) await chrome.storage.session.remove(keys);
        });
    }
}
