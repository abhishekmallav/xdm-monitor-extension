import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attributes, parsePlaylist, requireCompletedVideo } from '../src/hls/playlist.js';

const media = '#EXTM3U\n#EXTINF:5,\nsegment.ts\n#EXT-X-ENDLIST\n';
function source(files, requests = []) {
    return async url => {
        requests.push(url);
        return new Response(files[url] || '', { status: files[url] ? 200 : 404 });
    };
}
test('playlist attribute parsing preserves quoted codec lists and relative rendition URLs', () => {
    assert.deepEqual(attributes('BANDWIDTH=400000,CODECS="avc1.42c00a,mp4a.40.2",RESOLUTION=320x180'),
        { BANDWIDTH: '400000', CODECS: 'avc1.42c00a,mp4a.40.2', RESOLUTION: '320x180' });
    const parsed = parsePlaylist('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=400000\n../video.m3u8?token=1\n', 'https://cdn.test/path/master.m3u8');
    assert.equal(parsed.variants[0].url, 'https://cdn.test/video.m3u8?token=1');
});
test('completed media playlists are accepted without fetching video segments', async () => {
    const requests = [];
    const result = await requireCompletedVideo('https://cdn.test/video.m3u8', null,
        source({ 'https://cdn.test/video.m3u8': media }, requests));
    assert.equal(Object.keys(result).length, 1);
    assert.deepEqual(requests, ['https://cdn.test/video.m3u8']);
});
test('live or unfinished media playlists are rejected before starting FetchV', async () => {
    await assert.rejects(requireCompletedVideo('https://cdn.test/video.m3u8', null,
        source({ 'https://cdn.test/video.m3u8': media.replace('#EXT-X-ENDLIST', '') })), /Live or unfinished/);
});
test('master validation follows remembered quality and its default separate audio', async () => {
    const requests = [];
    const master = '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English",DEFAULT=YES,URI="audio.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=200000,RESOLUTION=160x90,AUDIO="audio"\nlow.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=400000,RESOLUTION=320x180,AUDIO="audio"\nhigh.m3u8\n';
    await requireCompletedVideo('https://cdn.test/master.m3u8', '160x90', source({
        'https://cdn.test/master.m3u8': master, 'https://cdn.test/low.m3u8': media,
        'https://cdn.test/high.m3u8': media, 'https://cdn.test/audio.m3u8': media
    }, requests));
    assert.deepEqual(requests, ['https://cdn.test/master.m3u8', 'https://cdn.test/low.m3u8', 'https://cdn.test/audio.m3u8']);
});
test('circular masters and HTTP access failures terminate with a useful error', async () => {
    await assert.rejects(requireCompletedVideo('https://cdn.test/master.m3u8', null, source({
        'https://cdn.test/master.m3u8': '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nmaster.m3u8\n'
    })), /circular/);
    await assert.rejects(requireCompletedVideo('https://cdn.test/missing.m3u8', null, source({})), /HTTP 404/);
});
test('HTML login pages are not mistaken for completed playlists', () => {
    assert.throws(() => parsePlaylist('<html>Log in</html>', 'https://cdn.test/video.m3u8'), /did not return an HLS/);
});
test('HLS variables in variant URLs are resolved during completed-video validation', async () => {
    const requests = [];
    await requireCompletedVideo('https://cdn.test/master.m3u8?token=secret', null, source({
        'https://cdn.test/master.m3u8?token=secret': '#EXTM3U\n#EXT-X-DEFINE:QUERYPARAM="token"\n#EXT-X-DEFINE:NAME="quality",VALUE="720"\n#EXT-X-STREAM-INF:BANDWIDTH=1\n{$quality}/video.m3u8?token={$token}\n',
        'https://cdn.test/720/video.m3u8?token=secret': media
    }, requests));
    assert.equal(requests[1], 'https://cdn.test/720/video.m3u8?token=secret');
});
