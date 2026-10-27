// XDM adapter around FetchV's original Panel, Fetcher, Controller and muxer workflow.
import { Controller, Panel } from '../../vendor/stream/hls-loader.js';
import { saveBlob } from '../hls/save.js';
import { requireCompletedVideo } from '../hls/playlist.js';
import { Options } from '../../vendor/stream/modules/options.js';
import { clearCompletedCache } from '../hls/cache.js';
import { migrateAutomaticSave } from '../hls/preferences.js';
import { installAssemblyUi } from '../hls/assembly-ui.js';
import { createTransferState, connectTransferPanel } from './transfer.js';

const taskId = new URL(location.href).searchParams.get('task');
const status = document.getElementById('downloadStatus');
const errorBox = document.getElementById('downloadError');
let controller, saving = false, saveTransferState;
const setTransferState = createTransferState(document);
setTransferState('preparing');
const assemblyUi = installAssemblyUi(Panel, {
    document, wrapper: document.getElementById('assemblyStatus'),
    label: document.getElementById('assemblyLabel'), percentage: document.getElementById('assemblyPercent'),
    card: document.querySelector('.download-card'), status,
    onAssembling: () => setTransferState('assembling')
});
const clearCacheButton = document.getElementById('clearDownloadCache');
function syncCacheButton() {
    clearCacheButton.disabled = saving || !controller?.isCompleted || !controller?.result;
}
clearCacheButton.addEventListener('click', () => {
    if (clearCompletedCache(controller, saving)) {
        status.textContent = 'Cache cleared. Any files already saved in Downloads are kept.';
        if (document.querySelector('.download-card').dataset.state !== 'saved') setTransferState('cleared');
    }
    syncCacheButton();
});

window.FVLANG = {
    cancel_modal_title: 'Cancel download', cancel_modal_close: 'Keep downloading',
    cancel_modal_confirm: 'Cancel download',
    cancel_modal_content: 'Cancel this download and discard its cached video data?',
    failed: 'Failed', paused: 'Paused', downloading: 'Downloading', completed: 'Completed', waiting: 'Waiting'
};

const themeButton = document.getElementById('downloadTheme');
const systemTheme = matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
    let preference;
    try { preference = localStorage.getItem('xdm-theme'); } catch (_) {}
    const dark = preference ? preference === 'dark' : systemTheme.matches;
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
    themeButton.textContent = dark ? 'Light mode' : 'Dark mode';
    themeButton.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
}
applyTheme();
themeButton.addEventListener('click', () => {
    const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('xdm-theme', theme); } catch (_) {}
    applyTheme();
});
systemTheme.addEventListener('change', applyTheme);
window.addEventListener('storage', event => { if (event.key === 'xdm-theme') applyTheme(); });

function showError(error) {
    errorBox.textContent = String(error.message || error);
    errorBox.hidden = false;
}
function observePanel(method, after) {
    const original = Panel.prototype[method];
    Panel.prototype[method] = function (...args) {
        const result = original.apply(this, args);
        after.call(this, ...args);
        return result;
    };
}
const initializePanel = Panel.prototype.init;
Panel.prototype.init = async function (...args) {
    const result = await initializePanel.apply(this, args);
    connectTransferPanel(this);
    return result;
};
observePanel('setCompleted', () => { setTransferState('ready'); status.textContent = 'Download complete. The MP4 is ready to save to Downloads.'; syncCacheButton(); });
observePanel('setPause', () => { setTransferState('paused'); status.textContent = 'Paused. Select Resume to continue.'; });
observePanel('setStart', () => { setTransferState('downloading'); status.textContent = 'Downloading video parts. Your MP4 will be assembled next.'; errorBox.hidden = true; syncCacheButton(); });
observePanel('setError', function (message) {
    // Preserve the original state transitions; display server-provided errors as text.
    if (this.$error) this.$error.textContent = String(message);
    setTransferState('error');
    status.textContent = 'Download stopped.';
});
document.addEventListener('xdm-save-start', () => {
    saving = true;
    saveTransferState = document.querySelector('.download-card').dataset.state;
    if (controller?.isCompleted && controller.result) setTransferState('saving');
    errorBox.hidden = true;
    status.textContent = 'Saving the MP4 to Downloads...';
    syncCacheButton();
});
document.addEventListener('xdm-save-complete', event => {
    saving = false;
    setTransferState(controller?.isCompleted && controller.result ? 'saved' : saveTransferState);
    status.textContent = `Saved ${event.detail.filename} to Downloads.`;
    controller?.ui?.showDownloadsList();
    syncCacheButton();
});
document.addEventListener('xdm-save-error', event => {
    saving = false;
    setTransferState(controller?.isCompleted && controller.result ? 'ready' : saveTransferState);
    showError(event.detail.message);
    syncCacheButton();
    if (controller?.ui?.$save) controller.ui.$save.disabled = false;
    status.textContent = 'Saving did not finish. The cached video is still available; select Save to try again.';
});
window.addEventListener('unhandledrejection', event => {
    event.preventDefault();
    assemblyUi.finish();
    setTransferState('error');
    showError(event.reason || 'The download could not be completed.');
});
window.addEventListener('beforeunload', event => {
    if (saving || assemblyUi.active || (controller && !controller.isCompleted && !controller.isFailure && !controller.isStop)) {
        event.preventDefault(); event.returnValue = '';
    }
});

async function start() {
    if (!taskId) throw new Error('Open a detected HLS stream from the XDM popup first.');
    const task = await chrome.runtime.sendMessage({ type: 'hls-task', taskId });
    if (!task || task.error) throw new Error(task?.error || 'Unable to open this download session.');
    document.title = `${task.title || 'HLS video'} — XDM`;
    document.getElementById('sourceHost').textContent = new URL(task.pageUrl || task.url).hostname;
    controller = new Controller('container', 'panel');
    // Ordinary AES-128 playlists with accessible keys use the same decrypter in every Chromium browser.
    controller.encryptedAllow = true;
    const nativeLoadModule = controller.loadModule.bind(controller);
    controller.loadModule = async (path, member) => {
        const module = await nativeLoadModule(path, member);
        if (member !== 'Hls') return module;
        // Preserve FetchV's pipeline while enforcing the agreed completed-videos-only scope.
        return class CompletedVideoHls extends module {
            trigger(event, data) {
                if (this === controller.hls && event === module.Events.LEVEL_LOADED && data?.details?.live) {
                    controller.isPause = true;
                    controller.isFailure = true;
                    controller.ui.setError('Live or unfinished streams are not supported. Open a completed video instead.');
                    queueMicrotask(() => this.stopLoad());
                    return false;
                }
                return super.trigger(event, data);
            }
        };
    };
    controller.sendMessage = async (command, data = {}) => {
        // XDM already installs tab-scoped replay rules. Do not apply FetchV's website-only response-header rules.
        if (command === 'SET_RULES' || command === 'REMOVE_RULES') return 0;
        if (command === 'GET_ALL_STORAGE') {
            const result = await chrome.runtime.sendMessage({ type: 'hls-resources', taskId });
            return result?.error ? {} : result || {};
        }
        if (command === 'OPEN_DOWNLOADS') return chrome.tabs.create({ url: 'chrome://downloads/' });
        if (command === 'OPEN_INITIATOR' && /^https?:/.test(task.pageUrl || '')) return chrome.tabs.create({ url: task.pageUrl });
        if (command === 'BG_FETCH') {
            try {
                if (!/^https?:$/.test(new URL(data.url).protocol)) throw new Error('Invalid media URL.');
                const response = await fetch(data.url, { method: data.method || 'GET', credentials: 'include', signal: AbortSignal.timeout(30000) });
                return response.ok ? { ok: true, content: await response.blob() } : { ok: false, statusText: `HTTP ${response.status}` };
            } catch (error) { return { ok: false, statusText: error.message }; }
        }
        return null;
    };
    controller.save = async blob => {
        if (controller.ui?.$save) controller.ui.$save.disabled = true;
        let name = (controller.filename || task.title || 'HLS video').replace(/\.m3u8?$/i, '');
        if (controller.currentPart > 1) name += `-Part-${controller.currentPart}`;
        try { await saveBlob(blob, name); }
        finally { if (controller.ui?.$save) controller.ui.$save.disabled = false; }
    };
    status.textContent = 'Checking that the video is complete...';
    const preferences = new Options();
    migrateAutomaticSave(preferences);
    controller.localM3u8 = await requireCompletedVideo(task.url, preferences.defaultResolution);
    const path = new URL(task.url).pathname;
    let name = path.split('/').pop() || 'video.m3u8';
    try { name = decodeURIComponent(name); } catch (_) {}
    await controller.load({
        url: task.url, title: task.title || 'HLS video', name, method: 'GET',
        tabId: task.tabId, requestId: task.requestId, storageKey: `xdm-hls-${task.sourceTabId}`,
        initiator: task.pageUrl, contentType: 'application/vnd.apple.mpegurl', type: 'hls', headers: {}, version: 3.2
    });
    new MutationObserver(syncCacheButton).observe(controller.ui.$clearCacheEnd, { attributes: true, attributeFilter: ['class'] });
    syncCacheButton();
}
start().catch(error => { if (controller) controller.isFailure = true; setTransferState('error'); showError(error); status.textContent = 'Unable to start the download.'; });
