(function () {
    // Tab updates can inject this file repeatedly into the same isolated world.
    if (globalThis.__xdmKeepAliveStarted) return;
    globalThis.__xdmKeepAliveStarted = true;
    let retryDelay = 1000;
    function hasContext() {
        try { return !!chrome.runtime.id; } catch (_) { return false; }
    }
    function connect() {
        // An extension reload invalidates old content scripts. They must stop
        // rather than registering listeners against their old runtime.
        if (!hasContext()) return;
        try {
            const port = chrome.runtime.connect({ name: 'keep-alive-ping' });
            port.onDisconnect.addListener(() => {
                const failed = !!chrome.runtime.lastError;
                if (!hasContext()) return;
                retryDelay = failed ? Math.min(retryDelay * 2, 30000) : 1000;
                setTimeout(connect, retryDelay);
            });
        } catch (_) {
            // Invalidated contexts cannot reconnect; navigation creates a new one.
        }
    }
    setTimeout(connect, 1000);
})();

