import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Options } from '../vendor/fetchv/modules/options.js';
import { saveBlob, waitForDownload } from '../src/hls/save.js';
import { migrateAutomaticSave } from '../src/hls/preferences.js';

function storage(initial = {}) {
    const values = new Map(Object.entries(initial));
    globalThis.localStorage = { getItem: key => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
    return values;
}

test('FetchV options default to tab progress and webpage-title naming', () => {
    storage(); const options = new Options();
    assert.equal(options.tabProgress, true);
    assert.equal(options.filenameType, 'title');
    assert.equal(options.threads, 2);
    assert.equal(options.clearCache, true);
    assert.equal(options.autoSave, true);
    assert.equal(options.preview, false);
    assert.equal(options.defaultResolution, null);
});

test('thread, auto-save, cache, preview, naming and resolution settings persist', () => {
    const values = storage(); const options = new Options();
    options.threads = 4; options.autoSave = true; options.clearCache = false;
    options.preview = true; options.tabProgress = false; options.filenameType = 'filename';
    options.defaultResolution = '1280x720';
    const restored = new Options();
    for (const key of ['threads', 'autoSave', 'clearCache', 'preview', 'tabProgress', 'filenameType', 'defaultResolution']) {
        assert.equal(restored[key], options[key]);
    }
    restored.defaultResolution = null;
    assert.equal(new Options().defaultResolution, null);
    assert(values.has('xdm-hls-options')); assert(!values.has('options'));
});

test('corrupted settings recover to the original defaults', () => {
    for (const value of ['{bad json', 'null', '[]', '"text"']) {
        storage({ 'xdm-hls-options': value });
        assert.equal(new Options().filenameType, 'title');
        assert.equal(new Options().tabProgress, true);
    }
});

function downloads(initial = 'in_progress') {
    const listeners = new Set(), events = [], calls = [];
    globalThis.document = new EventTarget();
    for (const type of ['xdm-save-start', 'xdm-save-complete', 'xdm-save-error']) document.addEventListener(type, event => events.push(event));
    globalThis.chrome = {
        runtime: { async sendMessage(message) { calls.push(message); return { ok: true }; } },
        downloads: {
            onChanged: { addListener(fn) { listeners.add(fn); }, removeListener(fn) { listeners.delete(fn); } },
            async search() { return [{ id: 7, state: initial }]; },
            async download(options) { calls.push(options); return 7; }
        }
    };
    return { listeners, events, calls, emit(state, error) {
        for (const listener of listeners) listener({ id: 7, state: { current: state }, error: { current: error } });
    } };
}

test('saving waits for Chrome completion before reporting success or releasing cache', async () => {
    const state = downloads();
    let complete = false;
    const saved = saveBlob(new Blob(['video'], { type: 'video/mp4' }), 'Page/title');
    saved.then(() => { complete = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(complete, false);
    assert.equal(state.calls[0].filename, 'Page_title.mp4');
    assert.equal(state.calls[1].saveAs, false);
    assert.equal(state.calls[1].conflictAction, 'uniquify');
    assert.deepEqual(state.events.map(event => event.type), ['xdm-save-start']);
    state.emit('complete'); await saved;
    assert(complete); assert.equal(state.listeners.size, 0);
    assert.deepEqual(state.events.map(event => event.type), ['xdm-save-start', 'xdm-save-complete']);
});

test('interrupted saves reject and do not announce a successful save', async () => {
    const state = downloads();
    const saved = saveBlob(new Blob(['video']), 'Video');
    await new Promise(resolve => setImmediate(resolve));
    state.emit('interrupted', 'USER_CANCELED');
    await assert.rejects(saved, /USER_CANCELED/);
    assert.equal(state.listeners.size, 0);
    assert.deepEqual(state.events.map(event => event.type), ['xdm-save-start', 'xdm-save-error']);
});

test('already-completed Chrome saves are recognized without missing a state event', async () => {
    const state = downloads('complete');
    await waitForDownload(7);
    assert.equal(state.listeners.size, 0);
});

test('automatic saving is migrated once while later user choices persist', () => {
    storage(); const options = new Options(); options.autoSave = false;
    migrateAutomaticSave(options);
    assert.equal(options.autoSave, true);
    options.autoSave = false;
    migrateAutomaticSave(options);
    assert.equal(new Options().autoSave, false);
});
