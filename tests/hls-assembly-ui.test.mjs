import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAssemblyUi } from '../src/hls/assembly-ui.js';

function fixture() {
    const node = () => ({ textContent: '', dataset: {}, setAttribute(key, value) { this[key] = value; } });
    const elements = { document: { createElement: node }, wrapper: node(), label: node(), percentage: node(), card: node(), status: node() };
    class Panel {
        constructor() {
            this.ctrl = { isCompleted: true, result: null };
            this.$pause = { disabled: false };
            this.$save = { disabled: true };
        }
        setCompleted() { this.$save.disabled = false; }
        setError() { this.error = true; }
    }
    const callbacks = new Map();
    let id = 0;
    const ui = installAssemblyUi(Panel, { ...elements,
        schedule(callback) { callbacks.set(++id, callback); return id; },
        cancel(id) { callbacks.delete(id); }
    });
    return { ...elements, panel: new Panel(), ui, callbacks,
        tick() { const ready = [...callbacks.values()]; callbacks.clear(); ready.forEach(callback => callback()); } };
}

test('assembly coalesces progress bursts and stays busy through MP4 finalization', () => {
    const f = fixture();
    f.panel.fileProgress();
    f.panel.loading();
    assert(f.ui.active);
    assert(f.panel.$pause.disabled);
    for (let i = 0; i <= 1000; i++) f.panel.setFileProgress(i / 1000);
    assert.equal(f.callbacks.size, 1);
    f.tick();
    assert.equal(f.percentage.textContent, '100%');
    f.panel.setFileProgressEnd();
    f.panel.setFileProgress(0.1); // Late muxer callbacks must not regress the finalization UI.
    assert.equal(f.callbacks.size, 0);
    assert(f.ui.active);
    assert.equal(f.label.textContent, 'Finalizing MP4');
    assert(f.panel.$pause.disabled);
    f.panel.ctrl.result = new Blob(['mp4']);
    f.panel.setCompleted();
    assert(!f.ui.active);
    assert.equal(f.wrapper.dataset.active, 'false');
    assert(!f.panel.$pause.disabled);
    assert(!f.panel.$save.disabled);
});

test('preview flush progress leaves download controls alone; errors cancel queued updates', () => {
    const f = fixture();
    f.panel.ctrl.isCompleted = false;
    f.panel.loading();
    f.panel.setFileProgress(0.5);
    f.panel.setFileProgressEnd();
    assert(!f.ui.active);
    assert(!f.panel.$pause.disabled);
    f.panel.ctrl.isCompleted = true;
    f.panel.setFileProgress(0.5);
    f.panel.setError();
    assert.equal(f.callbacks.size, 0);
    assert(!f.ui.active);
    assert(!f.panel.$pause.disabled);
    assert(f.panel.error);
});
