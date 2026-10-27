# XDM Integration Module

A Chrome Manifest V3 extension that connects the browser to Xtreme Download Manager (XDM). It monitors downloads and media requests and provides context menu actions for downloading links and images.

## Repository structure

```text
manifest.json       Extension configuration
main.js             Background service worker entry point
popup.html          Media list and monitoring controls
error.html          Desktop connection error page
disabled.html       Monitoring disabled page
register.html       Desktop registration page
src/
  background/       Application, desktop connector, and request watcher
  content/          Injected link/image collectors and keep-alive script
  shared/           Shared logger
  ui/               Scripts for the popup, error, and registration pages
styles/             Shared page stylesheet
assets/             All icons and images, without subfolders
FetchV/             Separate extension; not used by the XDM extension
```

The HTML pages stay at the repository root to preserve their extension URLs, including the registration page. Chrome loads `main.js` as a module; it imports the background application from `src/background/`.

## Load locally

1. Open `chrome://extensions` and enable **Developer mode**.
2. Select **Load unpacked** and choose this repository root, which contains the XDM `manifest.json`.
3. Start the XDM desktop application. The connector communicates with it at `http://127.0.0.1:8597`.
4. After editing the extension, select **Reload** on its extension card. Refresh web pages before checking injected scripts.

There is no build step or package installation required. `FetchV/` has its own manifest and is independent of XDM.

## Verify changes

Check that the extension loads without service worker errors. With XDM running, check the popup, monitoring toggle, media downloads, and the context menu actions for individual links/images and all links/images. With XDM stopped, check the connection error page and its launch action. Check the disabled page when monitoring is disabled in XDM.

When moving files, update module imports, HTML resource paths, manifest icon paths, dynamic toolbar icon paths, and the root-relative file paths passed to `chrome.scripting.executeScript`. Images assigned by popup scripts resolve relative to the HTML page.
