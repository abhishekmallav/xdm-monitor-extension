import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const script = fs.readFileSync(new URL('../src/content/ping.js', import.meta.url), 'utf8');
test('repeated injections keep one port and stop reconnecting after extension invalidation', () => {
    let connections = 0, disconnect;
    const timers = [];
    const runtime = { id: 'extension', connect() {
        connections++;
        return { onDisconnect: { addListener(fn) { disconnect = fn; } } };
    } };
    const context = vm.createContext({ chrome: { runtime }, setTimeout(callback) { timers.push(callback); } });
    vm.runInContext(script, context);
    vm.runInContext(script, context);
    assert.equal(timers.length, 1);
    timers.shift()();
    assert.equal(connections, 1);
    disconnect();
    assert.equal(timers.length, 1);
    delete runtime.id;
    timers.shift()();
    assert.equal(connections, 1);
    disconnect();
    assert.equal(timers.length, 0);
});

test('invalidated runtime listener registration cannot throw out of the content script', () => {
    const context = vm.createContext({ chrome: { runtime: { id: 'old', connect() { throw Error('Extension context invalidated'); } } }, setTimeout(callback) { callback(); } });
    assert.doesNotThrow(() => vm.runInContext(script, context));
});
