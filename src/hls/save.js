import { safeFilename } from '../shared/hls.js';

function announce(type, detail = {}) {
    document.dispatchEvent(new CustomEvent(type, { detail }));
}

export function waitForDownload(id) {
    return new Promise((resolve, reject) => {
        const check = item => {
            if (item?.state === 'complete') finish();
            else if (item?.state === 'interrupted') finish(new Error(item.error || 'Chrome interrupted the save.'));
        };
        const listener = change => {
            if (change.id === id) check({ state: change.state?.current, error: change.error?.current });
        };
        function finish(error) {
            chrome.downloads.onChanged.removeListener(listener);
            if (error) reject(error); else resolve();
        }
        chrome.downloads.onChanged.addListener(listener);
        chrome.downloads.search({ id }).then(items => check(items[0]), finish);
    });
}

export async function saveBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const filename = safeFilename(name);
    announce('xdm-save-start');
    try {
        const registered = await chrome.runtime.sendMessage({ type: 'hls-filename', url, filename });
        if (!registered?.ok) throw new Error(registered?.error || 'Unable to prepare Chrome download.');
        const id = await chrome.downloads.download({ url, filename, saveAs: false, conflictAction: 'uniquify' });
        await waitForDownload(id);
        announce('xdm-save-complete', { filename });
    } catch (error) {
        announce('xdm-save-error', { message: error.message });
        throw error;
    } finally { URL.revokeObjectURL(url); }
}
