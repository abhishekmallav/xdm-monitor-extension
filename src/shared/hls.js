// Shared detection helpers. Playlists and credentials stay inside the extension.
export const HLS_TYPES = new Set([
    'application/vnd.apple.mpegurl', 'application/x-mpegurl',
    'audio/mpegurl', 'audio/x-mpegurl'
]);

export function isHlsResponse(url, headers = []) {
    try {
        const type = headers.find(h => h.name.toLowerCase() === 'content-type')?.value || '';
        return /^https?:$/.test(new URL(url).protocol) &&
            (/\.m3u8?$/i.test(new URL(url).pathname) || HLS_TYPES.has(type.split(';')[0].trim().toLowerCase()));
    } catch { return false; }
}

export function safeFilename(title) {
    let name = String(title || 'HLS video').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
        .replace(/[. ]+$/g, '').trim().slice(0, 160) || 'HLS video';
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = '_' + name;
    while (new TextEncoder().encode(name).length > 180) name = Array.from(name).slice(0, -1).join('');
    return name.replace(/\.mp4$/i, '') + '.mp4';
}

export function publicStream(stream) {
    let name = new URL(stream.url).pathname.split('/').pop() || 'HLS video';
    try { name = decodeURIComponent(name); } catch (_) {}
    return { id: stream.id, text: name, pageTitle: stream.title, info: 'HLS | Chrome download',
        kind: 'hls', tabId: String(stream.tabId), url: stream.url };
}

// Do not copy cookies or browser-managed connection/range headers into replay rules.
export function replayHeaders(headers = []) {
    const excluded = /^(cookie|host|connection|content-length|content-type|range|if-.*|accept-encoding|user-agent|sec-.*|proxy-.*|:.*)$/i;
    return headers.filter(h => h.value && !excluded.test(h.name));
}
