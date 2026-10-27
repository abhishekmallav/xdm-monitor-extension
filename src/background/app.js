"use strict";
import Logger from '../shared/logger.js';
import RequestWatcher from './request-watcher.js';
import Connector from './connector.js';
import HlsMonitor from './hls-monitor.js';
import { safeFilename } from '../shared/hls.js';

export default class App {
    constructor() {
        this.logger = new Logger();
        this.videoList = [];
        this.hlsFilenames = new Map();
        this.blockedHosts = [];
        this.fileExts = [];
        this.requestWatcher = new RequestWatcher(this.onRequestDataReceived.bind(this));
        this.tabsWatcher = [];
        this.userDisabled = false;
        this.hlsMonitor = new HlsMonitor(() => this.updateActionIcon(), url => {
            const hostname = new URL(url).hostname;
            return this.blockedHosts.some(host => hostname.includes(host));
        });
        this.hlsMonitor.ready.then(() => {
            this.userDisabled = this.hlsMonitor.paused;
            this.updateActionIcon();
        });
        this.appEnabled = false;
        this.onDownloadCreatedCallback = this.onDownloadCreated.bind(this);
        this.onDeterminingFilenameCallback = this.onDeterminingFilename.bind(this);
        this.onTabUpdateCallback = this.onTabUpdate.bind(this);
        this.activeTabId = -1;
        this.connector = new Connector(this.onMessage.bind(this), this.onDisconnect.bind(this));
    }

    start() {
        this.logger.log("starting...");
        this.starAppConnector();
        this.register();
        this.logger.log("started.");
    }

    starAppConnector() {
        this.connector.connect();
    }

    onMessage(msg) {
        this.logger.log("message from XDM");
        this.logger.log(msg);
        this.appEnabled = msg.enabled === true;
        this.fileExts = msg.fileExts || [];
        this.blockedHosts = msg.blockedHosts || [];
        this.tabsWatcher = msg.tabsWatcher;
        this.videoList = msg.videoList || [];
        this.requestWatcher.updateConfig({
            mediaExts: msg.requestFileExts,
            blockedHosts: msg.blockedHosts,
            matchingHosts: msg.matchingHosts,
            mediaTypes: msg.mediaTypes
        });
        this.updateActionIcon();
    }

    onDisconnect() {
        this.logger.log("Disconnected from native host!");
        this.logger.log("Disconnected...");
        this.updateActionIcon();
    }

    isMonitoringEnabled() {
        this.logger.log(this.appEnabled + " " + this.userDisabled);
        return this.appEnabled === true && this.userDisabled === false && this.connector.isConnected();
    }

    onRequestDataReceived(data) {
        //Streaming video data received, send to native messaging application
        this.logger.log("onRequestDataReceived");
        this.logger.log(data);
        this.isMonitoringEnabled() && this.connector.isConnected() && this.connector.postMessage("/media", data);
    }

    onDeterminingFilename(download, suggest) {
        this.logger.log("onDeterminingFilename");
        if (download.byExtensionId === chrome.runtime.id) {
            const filename = this.hlsFilenames.get(download.url);
            this.hlsFilenames.delete(download.url);
            suggest(filename ? { filename, conflictAction: 'uniquify' } : undefined);
            return;
        }
        if (!this.isMonitoringEnabled()) return;
        this.logger.log(download);
        let url = download.finalUrl || download.url;
        this.logger.log(url);
        if (this.isMonitoringEnabled() && this.shouldTakeOver(url, download.filename)) {
            chrome.downloads.cancel(
                download.id,
                () => chrome.downloads.erase({ id: download.id })
            );
            let referrer = download.referrer;
            if (!referrer && download.finalUrl !== download.url) {
                referrer = download.url;
            }
            this.triggerDownload(url, download.filename,
                referrer, download.fileSize, download.mime);
        }
    }

    onDownloadCreated(download) {
        this.logger.log("onDownloadCreated");
        this.logger.log(download);
    }

    onTabUpdate(tabId, changeInfo, tab) {
        if (!tab.url || !/^https?:/.test(tab.url)) {
            return;
        }
        chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ["src/content/ping.js"],
        }).then(() => this.logger.log("script injected")).catch(() => {});
        if (!this.isMonitoringEnabled()) {
            return;
        }
        if (changeInfo.title) {
            if (this.tabsWatcher &&
                this.tabsWatcher.find(t => tab.url.indexOf(t) > 0)) {
                this.logger.log("Tab changed: " + changeInfo.title + " => " + tab.url);
                try {
                    this.connector.postMessage("/tab-update", {
                        tabUrl: tab.url,
                        tabTitle: changeInfo.title
                    });
                } catch (ex) {
                    console.log(ex);
                }
            }
        }
    }

    register() {
        this.keepAwake();
        chrome.downloads.onCreated.addListener(
            this.onDownloadCreatedCallback
        );
        chrome.downloads.onDeterminingFilename.addListener(
            this.onDeterminingFilenameCallback
        );
        chrome.tabs.onUpdated.addListener(
            this.onTabUpdateCallback
        );
        chrome.runtime.onMessage.addListener(this.onPopupMessage.bind(this));
        this.requestWatcher.register();
        this.hlsMonitor.register();
        chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => {
            if (tab) this.activeTabId = String(tab.id);
            this.updateActionIcon();
        }).catch(() => {});
        this.attachContextMenu();
        chrome.tabs.onActivated.addListener(this.onTabActivated.bind(this));
    }

    isSupportedProtocol(url) {
        if (!url) return false;
        let u = new URL(url);
        return u.protocol === 'http:' || u.protocol === 'https:';
    }

    shouldTakeOver(url, file) {
        let u = new URL(url);
        if (!this.isSupportedProtocol(url)) {
            return false;
        }
        let hostName = u.host;
        if (this.blockedHosts.find(item => hostName.indexOf(item) >= 0)) {
            return false;
        }
        let path = file || u.pathname;
        let upath = path.toUpperCase();
        if (this.fileExts.find(ext => upath.endsWith(ext))) {
            return true;
        }
        return false;
    }

    desktopMedia(tabId) {
        if (!this.connector.isConnected() || !this.appEnabled) return [];
        const hlsUrls = new Set(this.hlsMonitor.list(tabId).map(item => item.url));
        return this.videoList.filter(vid => (!vid.tabId || vid.tabId == '-1' || vid.tabId == '0' ||
            vid.tabId == tabId) && !hlsUrls.has(vid.url));
    }

    updateActionIcon() {
        chrome.action.setIcon({ path: this.getActionIcon() });
        const count = this.desktopMedia(this.activeTabId).length + this.hlsMonitor.list(this.activeTabId).length;
        chrome.action.setBadgeText({ text: count ? String(count) : '' });
        // HLS is available even when the desktop application is disconnected.
        chrome.action.setPopup({ popup: './popup.html' });
        chrome.runtime.sendMessage({ type: 'media-updated' }).catch(() => {});
    }

    getActionIconName(icon) {
        return "assets/" + (!this.userDisabled ? icon + ".png" : icon + "-mono.png");
    }

    getActionIcon() {
        return {
            "16": this.getActionIconName("icon16"),
            "48": this.getActionIconName("icon48"),
            "128": this.getActionIconName("icon128")
        }
    }

    triggerDownload(url, file, referer, size, mime) {
        chrome.cookies.getAll({ "url": url }, cookies => {
            let cookieStr = undefined;
            if (cookies) {
                cookieStr = cookies.map(cookie => cookie.name + "=" + cookie.value).join("; ");
            }
            let requestHeaders = { "User-Agent": [navigator.userAgent] };
            if (referer) {
                requestHeaders["Referer"] = [referer];
            }
            let responseHeaders = {};
            if (size) {
                let fz = +size;
                if (fz > 0) {
                    responseHeaders["Content-Length"] = [fz];
                }
            }
            if (mime) {
                responseHeaders["Content-Type"] = [mime];
            }
            let data = {
                url: url,
                cookie: cookieStr,
                requestHeaders: requestHeaders,
                responseHeaders: responseHeaders,
                filename: file,
                fileSize: size,
                mimeType: mime
            };
            this.logger.log(data);
            this.connector.postMessage("/download", data);
        });
    }

    diconnect() {
        this.onDisconnect();
    }

    onPopupMessage(request, sender, sendResponse) {
        this.logger.log(request.type);
        if (['stat', 'hls-open', 'hls-task', 'hls-release', 'hls-filename', 'hls-resources'].includes(request.type)) {
            if (!sender.url?.startsWith(chrome.runtime.getURL(''))) return;
            (async () => {
                await this.hlsMonitor.ready;
                await this.hlsMonitor.queue;
                if (request.type === 'stat') {
                    const tabId = request.tabId ?? this.activeTabId;
                    return { enabled: !this.userDisabled, desktopConnected: !!this.connector.isConnected(),
                        desktopEnabled: this.appEnabled,
                        list: [...this.desktopMedia(tabId), ...this.hlsMonitor.list(tabId)] };
                }
                if (request.type === 'hls-open') {
                    await this.hlsMonitor.open(request.itemId, request.tabId);
                    return { ok: true };
                }
                if (!sender.tab || !sender.url.startsWith(chrome.runtime.getURL('hls.html'))) {
                    throw new Error('Invalid downloader page.');
                }
                if (request.type === 'hls-task') return this.hlsMonitor.getTask(request.taskId, sender.tab.id);
                if (request.type === 'hls-resources') return this.hlsMonitor.resources(request.taskId, sender.tab.id);
                if (request.type === 'hls-filename') {
                    if (!request.url?.startsWith('blob:' + chrome.runtime.getURL(''))) throw new Error('Invalid download URL.');
                    this.hlsFilenames.set(request.url, safeFilename(request.filename));
                    return { ok: true };
                }
                await this.hlsMonitor.cleanupTask(sender.tab.id);
                return { ok: true };
            })().then(sendResponse, error => sendResponse({ error: error.message }));
            return true;
        }
        else if (request.type === 'cmd') {
            this.userDisabled = request.enabled === false;
            this.hlsMonitor.setPaused(this.userDisabled).catch(console.error);
            this.updateActionIcon();
        }
        else if (request.type === "vid") {
            let vid = request.itemId;
            this.connector.postMessage("/vid", {
                vid: vid + "",
            });
        }
        else if (request.type === "clear") {
            this.hlsMonitor.clear(request.tabId ?? this.activeTabId);
            if (this.connector.isConnected()) this.connector.postMessage("/clear", {});
        }
        else if (request.type === "links") {
            this.sendLinksToXDM(request.links, request.pageUrl);
        }
    }

    sendLinkToXDM(info, tab) {
        let url = info.linkUrl;
        if (!this.isSupportedProtocol(url)) {
            url = info.srcUrl;
        }
        if (!this.isSupportedProtocol(url)) {
            url = info.pageUrl;
        }
        if (!this.isSupportedProtocol(url)) {
            return;
        }
        this.triggerDownload(url, null, info.pageUrl, null, null);
    }

    sendImageToXDM(info, tab) {
        let url = info.srcUrl;
        if (!this.isSupportedProtocol(url))
            url = info.linkUrl;
        if (!this.isSupportedProtocol(url)) {
            url = info.pageUrl;
        }
        if (!this.isSupportedProtocol(url)) {
            return;
        }
        this.triggerDownload(url, null, info.pageUrl, null, null);
    }

    getAllLinks(info, tab, image) {
        this.logger.log(tab);
        chrome.scripting.executeScript({
            target: { tabId: tab.id, allFrames: true },
            files: [image === true ? "src/content/get-images.js" : "src/content/get-links.js"],
        }).then(() => this.logger.log("script injected in all frames"));
    }

    onMenuClicked(info, tab) {
        if (info.menuItemId == "download-any-link") {
            this.sendLinkToXDM(info, tab);
        }
        if (info.menuItemId == "download-image-link") {
            this.sendImageToXDM(info, tab);
        }
        if (info.menuItemId == "download-all-links") {
            this.getAllLinks(info, tab, false);
        }
        if (info.menuItemId == "download-all-images") {
            this.getAllLinks(info, tab, true);
        }
    }

    attachContextMenu() {
        chrome.contextMenus.create({
            id: 'download-any-link',
            title: "Download with XDM",
            contexts: ["link", "video", "audio", "all"]
        });

        chrome.contextMenus.create({
            id: 'download-image-link',
            title: "Download Image with XDM",
            contexts: ["image"]
        });

        chrome.contextMenus.create({
            id: 'download-all-links',
            title: "Download All links with XDM",
            contexts: ["all"]
        });

        chrome.contextMenus.create({
            id: 'download-all-images',
            title: "Download All images with XDM",
            contexts: ["all"]
        });

        chrome.contextMenus.onClicked.addListener(this.onMenuClicked.bind(this));
    }

    onTabActivated(activeInfo) {
        this.activeTabId = activeInfo.tabId + "";
        this.logger.log("Active tab: " + this.activeTabId);
        this.updateActionIcon();
    }

    sendLinksToXDM(links, pageUrl) {
        this.fetchAllCookiesForUrls(links).then(cookieMap => {
            this.logger.log(cookieMap);
            const data = [];
            for (const url of cookieMap.keys()) {
                data.push({
                    url: url,
                    cookie: cookieMap.get(url),
                    requestHeaders: {
                        "User-Agent": [navigator.userAgent],
                        "Referer": [pageUrl]
                    },
                    responseHeaders: {}
                });
            }
            this.logger.log(data);
            this.connector.postMessage("/link", data);
        });
    }

    fetchAllCookiesForUrls(links) {
        return new Promise((resolve, reject) => {
            this.fetchCookiesForUrls(links, 0, new Map(), resolve);
        });
    }

    fetchCookiesForUrls(links, index, cookieMap, resolve) {
        if (index === links.length) {
            resolve(cookieMap);
            return;
        }
        const url = links[index];
        chrome.cookies.getAll({ "url": url }, cookies => {
            if (cookies) {
                const cookieStr = cookies.map(cookie => cookie.name + "=" + cookie.value).join("; ");
                cookieMap.set(url, cookieStr);
            }
            this.fetchCookiesForUrls(links, index + 1, cookieMap, resolve);
        });
    }

    keepAwake() {
        chrome.runtime.onConnect.addListener(port => {
            if (port.name !== 'keep-alive-ping') return;
            port.onMessage.addListener(this.onKeepAliveMessage.bind(this));
            port.onDisconnect.addListener(this.deleteTimer.bind(this));
            port._timer = setTimeout(this.forceReconnect.bind(this), 250e3, port);
        });
    }

    forceReconnect(port) {
        this.deleteTimer(port);
        port.disconnect();
    }

    onKeepAliveMessage(msg, port) {
        console.log('received', msg, 'from', port.sender);
    }

    deleteTimer(port) {
        if (port._timer) {
            clearTimeout(port._timer);
            delete port._timer;
        }
    }
}
