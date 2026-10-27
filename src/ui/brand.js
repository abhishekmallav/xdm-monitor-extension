// Capture image errors without inline handlers, which Manifest V3 CSP blocks.
document.addEventListener('error', event => {
    const image = event.target;
    if (!image?.matches?.('img.brand-icon[data-fallback-src]')) return;
    const fallback = image.dataset.fallbackSrc;
    delete image.dataset.fallbackSrc;
    if (fallback) image.src = fallback;
}, true);
