// Scope validation only; FetchV's bundled loader still performs downloading and muxing.
export function attributes(text) {
    const result = {};
    for (const match of text.matchAll(/([A-Z0-9-]+)=((?:"[^"]*")|[^,]*)/g)) {
        result[match[1]] = match[2].replace(/^"|"$/g, '');
    }
    return result;
}

export function parsePlaylist(text, url, inheritedVariables = {}) {
    const lines = text.trim().split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (lines[0] !== '#EXTM3U') throw new Error('The server did not return an HLS playlist. Play the video again to refresh access.');
    const variants = [], audio = [];
    const variables = { ...inheritedVariables };
    const expand = value => value.replace(/\{\$([A-Za-z0-9_-]+)\}/g, (_, name) => {
        if (!(name in variables)) throw new Error(`Undefined playlist variable: ${name}`);
        return variables[name];
    });
    let pending;
    for (const line of lines) {
        if (line.startsWith('#EXT-X-DEFINE:')) {
            const definition = attributes(line.slice(14));
            if (definition.NAME && definition.VALUE !== undefined) variables[definition.NAME] = expand(definition.VALUE);
            if (definition.QUERYPARAM) variables[definition.QUERYPARAM] = new URL(url).searchParams.get(definition.QUERYPARAM) || '';
        } else if (line.startsWith('#EXT-X-STREAM-INF:')) pending = attributes(line.slice(18));
        else if (line.startsWith('#EXT-X-MEDIA:')) {
            const item = attributes(line.slice(13));
            if (item.TYPE === 'AUDIO' && item.URI) audio.push({ ...item, url: new URL(expand(item.URI), url).href });
        } else if (!line.startsWith('#') && pending) {
            variants.push({ ...pending, url: new URL(expand(line), url).href });
            pending = undefined;
        }
    }
    return { variants, audio, completed: lines.includes('#EXT-X-ENDLIST'), text, variables };
}

export async function requireCompletedVideo(url, preferredResolution, fetchFn = fetch) {
    const playlists = {};
    async function inspect(address, visited = new Set(), variables = {}) {
        if (!/^https?:$/.test(new URL(address).protocol)) throw new Error('Invalid playlist URL.');
        if (visited.has(address) || visited.size >= 8) throw new Error('The playlist contains a circular or excessively nested reference.');
        visited.add(address);
        const response = await fetchFn(address, { credentials: 'include', signal: AbortSignal.timeout(30000) });
        if (!response.ok) throw new Error(`Playlist request failed: HTTP ${response.status}. Play the source video again and reopen the download.`);
        const text = await response.text();
        const playlist = parsePlaylist(text, response.url || address, variables);
        // Preserve redirect-aware URL resolution in the original loader.
        if (!response.url || response.url === address) playlists[address] = new Blob([text], { type: 'application/vnd.apple.mpegurl' });
        if (!playlist.variants.length) {
            if (!playlist.completed) throw new Error('Live or unfinished streams are not supported. Open a completed video instead.');
            return;
        }
        const ranked = [...playlist.variants].sort((a, b) => Number(b.BANDWIDTH || 0) - Number(a.BANDWIDTH || 0));
        const variant = ranked.find(item => preferredResolution && item.RESOLUTION === preferredResolution) || ranked[0];
        await inspect(variant.url, new Set(visited), playlist.variables);
        const renditions = playlist.audio.filter(item => item['GROUP-ID'] === variant.AUDIO);
        const audio = renditions.find(item => item.DEFAULT === 'YES') || renditions[0];
        if (audio) await inspect(audio.url, new Set(visited), playlist.variables);
    }
    await inspect(url);
    return playlists;
}
