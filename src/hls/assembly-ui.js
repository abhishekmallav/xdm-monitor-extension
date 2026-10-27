// Keep worker progress out of the page's layout flow and coalesce frequent messages.
export function installAssemblyUi(Panel, { document, wrapper, label, percentage, card, status,
    schedule = callback => setTimeout(callback, 100), cancel = clearTimeout, onAssembling = () => {} }) {
    let active = false, finalizing = false, timer = null, pending = -1, displayed = -1, buttons = new Map();
    const write = () => {
        timer = null;
        if (!active || displayed === pending) return;
        displayed = pending;
        percentage.textContent = displayed >= 0 ? `${displayed}%` : '';
    };
    function begin(panel) {
        if (active) return;
        active = true;
        finalizing = false;
        pending = displayed = -1;
        percentage.textContent = '';
        label.textContent = 'Assembling MP4';
        status.textContent = 'All video parts downloaded. Assembling the MP4 file...';
        wrapper.dataset.active = 'true';
        wrapper.setAttribute('aria-hidden', 'false');
        card.dataset.phase = 'assembling';
        onAssembling();
        buttons = new Map([panel.$pause, panel.$start, panel.$stop, panel.$cancel,
            panel.$save, panel.$saveDownloaded].filter(Boolean).map(button => [button, button.disabled]));
        for (const button of buttons.keys()) button.disabled = true;
    }
    function finish() {
        if (timer !== null) cancel(timer);
        timer = null;
        if (!active) return;
        active = false;
        wrapper.dataset.active = 'false';
        wrapper.setAttribute('aria-hidden', 'true');
        delete card.dataset.phase;
        for (const [button, disabled] of buttons) button.disabled = disabled;
        buttons.clear();
    }
    Panel.prototype.fileProgress = function () {
        this.$fileProgressWrap = wrapper;
        this.$fileProgress = percentage;
    };
    Panel.prototype.loading = function () {
        if (this.ctrl.isCompleted && !this.ctrl.result) begin(this);
        // Controller.loadingRemove expects a removable node; it need not be in the DOM.
        return document.createElement('span');
    };
    Panel.prototype.setFileProgress = function (value) {
        if (!this.ctrl.isCompleted || this.ctrl.result || finalizing || !Number.isFinite(value)) return;
        begin(this);
        const next = Math.max(pending, Math.round(Math.max(0, Math.min(1, value)) * 100));
        if (next === pending) return;
        pending = next;
        if (timer === null) timer = schedule(write);
    };
    Panel.prototype.setFileProgressEnd = function () {
        if (!active) return;
        finalizing = true;
        if (timer !== null) cancel(timer);
        timer = null;
        label.textContent = 'Finalizing MP4';
        percentage.textContent = '';
        status.textContent = 'Video parts assembled. Finalizing the MP4 file...';
        // FFmpeg can still be working. Completion, not this callback, ends the busy state.
    };
    for (const method of ['setCompleted', 'setError']) {
        const original = Panel.prototype[method];
        Panel.prototype[method] = function (...args) {
            finish();
            return original.apply(this, args);
        };
    }
    return { get active() { return active; }, finish };
}
