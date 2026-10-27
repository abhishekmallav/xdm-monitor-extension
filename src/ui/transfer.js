// Presentation adapter; download, muxing and preference behavior stay in the engine.
export function createTransferState(document) {
    const card = document.querySelector('.download-card');
    const badge = document.getElementById('transferState');
    const stages = [...document.querySelectorAll('.transfer-stages li')];
    const states = {
        preparing: ['Preparing', -1], downloading: ['Downloading', 0], paused: ['Paused', 0],
        assembling: ['Assembling MP4', 1], ready: ['Ready to save', 2],
        saving: ['Saving', 2], saved: ['Saved to Downloads', 3], cleared: ['Cache cleared', -1]
    };
    let currentStep = -1;
    return function setState(state) {
        const [text, step] = states[state] || ['Stopped', currentStep];
        currentStep = step;
        card.dataset.state = state;
        badge.textContent = text;
        stages.forEach((stage, index) => {
            stage.dataset.complete = String(index < step);
            if (index === step) stage.setAttribute('aria-current', 'step');
            else stage.removeAttribute('aria-current');
        });
    };
}

export function connectTransferPanel(panel) {
    const drawer = panel.$collapseOption;
    // The engine initializes a Bootstrap collapse here. The XDM view presents
    // the same preference controls in a native modal drawer instead.
    drawer.classList.remove('collapse', 'collapsing');
    drawer.style.removeProperty('height');
    panel.$options.onclick = () => {
        if (!drawer.open) drawer.showModal();
        panel.$options.setAttribute('aria-expanded', 'true');
    };
    panel.$optionsClose.onclick = () => drawer.close();
    drawer.addEventListener('close', () => {
        panel.$options.setAttribute('aria-expanded', 'false');
        panel.$options.focus();
    });
    drawer.addEventListener('click', event => {
        const rect = drawer.getBoundingClientRect();
        if (event.target === drawer && (event.clientX < rect.left || event.clientX > rect.right ||
            event.clientY < rect.top || event.clientY > rect.bottom)) drawer.close();
    });

    const updateThreads = () => panel.$threads.forEach(button => {
        button.setAttribute('aria-pressed', String(button.classList.contains('text-danger')));
    });
    updateThreads();
    new MutationObserver(updateThreads).observe(drawer, { subtree: true, attributes: true, attributeFilter: ['class'] });

    const progress = panel.$progress;
    const percentage = document.getElementById('transferPercent');
    const updateProgress = () => {
        const value = Math.max(0, Math.min(100, parseFloat(progress.style.width) || 0));
        const text = `${Math.round(value)}%`;
        if (percentage.textContent !== text) percentage.textContent = text;
        progress.parentElement.setAttribute('aria-valuenow', String(value));
    };
    updateProgress();
    new MutationObserver(updateProgress).observe(progress, {
        attributes: true, attributeFilter: ['style'], childList: true, characterData: true, subtree: true
    });
    const updateFilename = () => { panel.$filename.title = panel.$filename.textContent; };
    updateFilename();
    new MutationObserver(updateFilename).observe(panel.$filename, { childList: true, characterData: true, subtree: true });
    panel.$rename.addEventListener('click', () => { panel.$filenameInput.focus(); panel.$filenameInput.select(); });
}
