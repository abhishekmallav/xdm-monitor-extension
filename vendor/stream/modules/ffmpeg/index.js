// Local MV3 adapter for FetchV's FFmpeg worker. No remote loading or IndexedDB code cache.
import { FFmpegWASM } from './ffmpeg.js';
export const ffmpeg = (async () => {
    const worker = new FFmpegWASM.FFmpeg();
    await worker.load({ coreURL: new URL('./ffmpeg-core.v2.js', import.meta.url).href, wasmURL: new URL('./ffmpeg-core.wasm', import.meta.url).href });
    return worker;
})();
