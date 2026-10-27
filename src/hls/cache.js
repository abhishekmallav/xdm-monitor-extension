// Release only this completed download's temporary media; saved files are untouched.
export function clearCompletedCache(controller, saving = false) {
    if (!controller?.isCompleted || !controller.result || saving) return false;
    const ui = controller.ui;
    if (ui.clearCacheTimer) clearInterval(ui.clearCacheTimer);
    ui.clearCacheTimer = 1;
    controller.result = null;
    controller.webWorker?.clear();
    for (const track of Object.values(controller.tracks || {})) {
        if (track && typeof track === 'object' && Array.isArray(track.localFrags)) track.localFrags.length = 0;
    }
    for (const fragments of Object.values(controller.loadedFragments || {})) {
        if (Array.isArray(fragments)) fragments.length = 0;
    }
    for (const key of Object.keys(controller.localM3u8 || {})) delete controller.localM3u8[key];
    if (ui.$previewVideo) {
        ui.$previewVideo.pause();
        ui.$previewVideo.removeAttribute('src');
        ui.$previewVideo.load();
    }
    if (controller.previewURL) URL.revokeObjectURL(controller.previewURL);
    controller.previewURL = null;
    controller.isPreviewed = false;
    ui.hide(ui.$clearCacheStatus, ui.$preview);
    ui.show(ui.$clearCacheEnd, ui.$fileIcon);
    for (const button of [ui.$save, ui.$saveDownloaded, ui.$cancel]) if (button) button.disabled = true;
    return true;
}
