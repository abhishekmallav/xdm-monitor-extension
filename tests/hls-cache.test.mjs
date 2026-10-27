import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveObjectURL } from 'node:buffer';
import { clearCompletedCache } from '../src/hls/cache.js';

function download() {
    let workerClears = 0, videoResets = 0;
    const ui = {
        clearCacheTimer: null, $save: {}, $saveDownloaded: {}, $cancel: {},
        $clearCacheStatus: {}, $clearCacheEnd: {}, $preview: {}, $fileIcon: {},
        $previewVideo: { pause() {}, removeAttribute() {}, load() { videoResets++; } },
        hide(...elements) { elements.forEach(element => { element.hidden = true; }); },
        show(...elements) { elements.forEach(element => { element.hidden = false; }); }
    };
    const controller = { ui, isCompleted: true, result: new Blob(['video']),
        webWorker: { clear() { workerClears++; } },
        tracks: { video: { localFrags: [new Blob(['segment'])] }, audio: { localFrags: [] } },
        loadedFragments: { main: [new Blob(['segment'])], audio: [] },
        localM3u8: { playlist: new Blob(['playlist']) }, isPreviewed: true,
        previewURL: URL.createObjectURL(new Blob(['preview'])) };
    return { controller, counts: () => ({ workerClears, videoResets }) };
}

test('manual cache clearing releases completed media and preview without deleting saved files', () => {
    const { controller, counts } = download();
    const url = controller.previewURL;
    const playlists = controller.localM3u8;
    assert(resolveObjectURL(url));
    assert(clearCompletedCache(controller));
    assert.equal(controller.result, null);
    assert.equal(resolveObjectURL(url), undefined);
    assert.equal(controller.previewURL, null);
    assert.equal(controller.tracks.video.localFrags.length, 0);
    assert.equal(controller.loadedFragments.main.length, 0);
    assert.deepEqual(controller.localM3u8, {});
    assert.deepEqual(playlists, {});
    assert.deepEqual(counts(), { workerClears: 1, videoResets: 1 });
    assert(controller.ui.$save.disabled);
    assert(controller.ui.$saveDownloaded.disabled);
    assert.equal(controller.ui.$clearCacheEnd.hidden, false);
    assert.equal(clearCompletedCache(controller), false);
});

test('cache cannot be cleared during downloading or saving', () => {
    const { controller, counts } = download();
    controller.isCompleted = false;
    assert.equal(clearCompletedCache(controller), false);
    controller.isCompleted = true;
    assert.equal(clearCompletedCache(controller, true), false);
    assert(controller.result);
    assert.deepEqual(counts(), { workerClears: 0, videoResets: 0 });
    URL.revokeObjectURL(controller.previewURL);
});
