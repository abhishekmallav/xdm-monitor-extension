# FetchV v3 download workflow snapshot

Source inspected and downloaded on 2026-10-27:

- Reference page: https://fetchv.net/m3u8downloader
- Loader: https://fetchv.net/static/v3/extensions/dist/hls-loader.js
- Modules: https://fetchv.net/static/v3/extensions/dist/modules/

The application-specific Panel, Fetcher and Controller implementations are derived from that loader, with its original control flow, settings, download-thread logic, cache countdown, quality handling and muxer workflow retained. `upstream/hls-loader.js` preserves the exact loader snapshot; `upstream/panel.html` preserves the download-panel markup. The XDM page uses that markup with XDM's own CSS instead of the hosted site's CSS, advertisements, analytics, navigation and install/review prompts.

Local adaptation boundaries:

1. `scripts/adapt-fetchv.mjs` decodes constant string lookups, excludes the website bootstrap/self-check preamble and BroadcastChannel auto-start, resolves worker paths from `import.meta.url`, and exports the original three classes. Run it with `npm run vendor:fetchv`.
2. `src/ui/hls.js` supplies the task from XDM's background worker and replaces the website's message bridge with trusted extension calls. Existing XDM tab-scoped request-header replay is used instead of the hosted site's response-header rewriting.
3. `modules/saveAs.js` points to `src/hls/save.js`, which uses Chrome downloads and waits for the actual save to finish. It saves directly to the default Downloads location without a chooser and does not use the website's StreamSaver iframe/service worker.
4. `modules/options.js` changes the localStorage namespace to `xdm-hls-options` and enables Auto Save by default. Its reference defaults already enable Tab Progress and Webpage Title naming. XDM performs a one-time migration of the automatic-save preference and preserves later user choices.
5. `modules/ffmpeg/index.js` loads the same FFmpeg core from bundled local URLs instead of downloading/decompressing and caching code at runtime. `ffmpeg-core.wasm` is the inflated published `ffmpeg-core.v2.wasm`. The original cache-loading wrapper is retained as `upstream/ffmpeg-index.js`. The FFmpeg worker's remote default URL is replaced with a local default.
6. The XDM adapter enforces completed-video scope, adds shared light/dark controls, safely renders errors, and enables the ordinary AES-128 decrypter across Chromium rather than depending on the reference's browser/locale switch. It does not add DRM support. XDM also adds labeled controls, statistic pills, a slimmer progress bar, and a safe on-demand completed-cache action.

Other runtime parser, muxer and worker files are retained from the referenced public modules. `SHA256.json` records the bundled snapshot. FetchV-specific code remains attributable to its original owner; it is not relabeled as XDM-authored or assumed to carry the licenses of its third-party dependencies. Retain upstream notices when redistributing.

Third-party components include HLS.js, FFmpeg, MP4Box and ISOBoxer. The original modules retain the notices present in the supplied distributions. Relevant upstream source projects:

- https://github.com/video-dev/hls.js
- https://github.com/FFmpeg/FFmpeg
- https://github.com/ffmpegwasm/ffmpeg.wasm
- https://github.com/gpac/mp4box.js
- https://github.com/madebyhiro/codem-isoboxer

The runtime does not load anything from fetchv.net, unpkg, a CDN, or another code-hosting service.
