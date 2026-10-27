class VideoPopup {
    run() {
        document.addEventListener('DOMContentLoaded', this.onLoad.bind(this), false);
    }

    onLoad() {
        const contentEl = document.getElementById('content');
        if (contentEl) {
            contentEl.style.display = 'none';
        }

        this.loadState();
        chrome.runtime.onMessage.addListener(message => {
            if (message.type === 'media-updated') this.loadState();
        });
        document.getElementById('launchDesktop')?.addEventListener('click', () => window.open('xdm+app://launch'));

        const chk = document.getElementById("chk");
        if (chk) {
            chk.addEventListener('click', (e) => {
                chrome.runtime.sendMessage({ type: "cmd", enabled: chk.checked });
                window.close();
            });
        }

        const clearBtn = document.getElementById('clear');
        const confirmPanel = document.getElementById('clearConfirmPanel');
        const cancelClearBtn = document.getElementById('cancelClearBtn');
        const confirmClearBtn = document.getElementById('confirmClearBtn');

        if (clearBtn && confirmPanel) {
            clearBtn.addEventListener('click', (e) => {
                confirmPanel.style.display = 'block';
            });
        }

        if (cancelClearBtn && confirmPanel) {
            cancelClearBtn.addEventListener('click', (e) => {
                confirmPanel.style.display = 'none';
            });
        }

        if (confirmClearBtn) {
            confirmClearBtn.addEventListener('click', (e) => {
                chrome.runtime.sendMessage({ type: "clear", tabId: this.tabId });
                window.setTimeout(() => window.close(), 500);
            });
        }

        const formatBtn = document.getElementById('format');
        const formatModal = document.getElementById('formatModal');
        const closeFormatModalBtn = document.getElementById('closeFormatModalBtn');
        const gotItFormatBtn = document.getElementById('gotItFormatBtn');

        const showFormatModal = () => {
            if (formatModal) formatModal.classList.add('show');
        };

        const hideFormatModal = () => {
            if (formatModal) formatModal.classList.remove('show');
        };

        if (formatBtn) {
            formatBtn.addEventListener('click', showFormatModal);
        }
        if (closeFormatModalBtn) {
            closeFormatModalBtn.addEventListener('click', hideFormatModal);
        }
        if (gotItFormatBtn) {
            gotItFormatBtn.addEventListener('click', hideFormatModal);
        }
        if (formatModal) {
            formatModal.addEventListener('click', (e) => {
                if (e.target === formatModal) {
                    hideFormatModal();
                }
            });
        }

        const refreshBtn = document.getElementById('headerRefreshBtn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                this.loadState();
            });
        }

        // ── Theme toggle ────────────────────────────────────────
        const themeToggle = document.getElementById('themeToggle');
        const themeIcon   = document.getElementById('themeIcon');
        const R           = document.documentElement;

        const isDark = () => R.dataset.theme
            ? R.dataset.theme === 'dark'
            : matchMedia('(prefers-color-scheme: dark)').matches;

        const applyTheme = (dark) => {
            R.dataset.theme = dark ? 'dark' : 'light';
            if (themeIcon) {
                themeIcon.className = dark ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
            }
            if (themeToggle) {
                themeToggle.title       = dark ? 'Switch to light mode' : 'Switch to dark mode';
                themeToggle.ariaLabel   = themeToggle.title;
            }
        };

        // Apply saved preference on load
        try {
            const saved = localStorage.getItem('xdm-theme');
            if (saved) R.dataset.theme = saved;
        } catch (_) {}
        applyTheme(isDark());

        if (themeToggle) {
            themeToggle.addEventListener('click', () => {
                const nowDark = !isDark();
                applyTheme(nowDark);
                try { localStorage.setItem('xdm-theme', nowDark ? 'dark' : 'light'); } catch (_) {}
            });
        }
    }

    loadState() {
        chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
            this.tabId = tab?.id;
            return chrome.runtime.sendMessage({ type: 'stat', tabId: this.tabId });
        }).then(response => {
            if (response && !response.error) this.onMsg(response);
        }).catch(error => this.showError(error.message));
    }

    updateStatusCard(isEnabled, desktopAvailable) {
        const card = document.getElementById('statusCard');
        const label = document.getElementById('statusLabel');
        const sub = document.getElementById('statusSub');

        if (!card) return;

        if (isEnabled) {
            card.classList.remove('paused');
            card.classList.add('active');
            if (label) label.innerText = "Monitoring Active";
            if (sub) sub.innerText = desktopAvailable ? "Listening for downloadable media" : "HLS monitoring is active";
        } else {
            card.classList.remove('active');
            card.classList.add('paused');
            if (label) label.innerText = "Monitoring Paused";
            if (sub) sub.innerText = "Resume to capture media streams";
        }
    }

    onMsg(response) {
        const chk = document.getElementById("chk");
        if (chk) {
            chk.checked = !!response.enabled;
        }

        this.updateStatusCard(!!response.enabled, response.desktopConnected && response.desktopEnabled);
        const desktopNote = document.getElementById('desktopNote');
        if (desktopNote) {
            desktopNote.hidden = !!response.desktopConnected && !!response.desktopEnabled;
            document.getElementById('desktopNoteText').textContent = response.desktopConnected
                ? 'XDM desktop monitoring is disabled. HLS downloads are available here.'
                : 'XDM desktop is disconnected. HLS downloads are available here.';
            document.getElementById('launchDesktop').hidden = !!response.desktopConnected;
        }

        const contentEl = document.getElementById('content');
        const emptyState = document.getElementById('emptyState');
        const mediaCount = document.getElementById('mediaCount');

        const list = (response && response.list) ? response.list : [];

        if (mediaCount) {
            mediaCount.innerText = `${list.length} item${list.length === 1 ? '' : 's'}`;
        }

        if (list.length > 0) {
            if (contentEl) contentEl.style.display = 'flex';
            if (emptyState) emptyState.style.display = 'none';
        } else {
            if (contentEl) contentEl.style.display = 'none';
            if (emptyState) emptyState.style.display = 'flex';
        }

        this.renderList(list);
    }

    showError(message) {
        const error = document.getElementById('popupError');
        if (error) { error.textContent = message; error.hidden = false; }
    }

    parseInfo(info) {
        if (!info || typeof info !== 'string') {
            return [];
        }

        const tokens = info.split(/[,|;]/).map(t => t.trim()).filter(Boolean);
        if (tokens.length === 0) {
            return [{ text: info.trim(), type: 'default' }];
        }

        const sizeRegex = /\b\d+(\.\d+)?\s*(B|KB|MB|GB|TB)\b/i;
        const resRegex = /\b(\d{3,4}[pP]|\d{3,4}\s*x\s*\d{3,4}|[248]K)\b/i;
        const typeRegex = /\b(mp4|m4a|mkv|webm|avi|flv|mov|mp3|aac|wav|ogg|audio|video)\b/i;

        return tokens.map(token => {
            if (sizeRegex.test(token)) {
                return { text: token, type: 'size' };
            }
            if (resRegex.test(token)) {
                return { text: token, type: 'res' };
            }
            if (typeRegex.test(token)) {
                return { text: token, type: 'type' };
            }
            return { text: token, type: 'default' };
        });
    }

    renderList(arr) {
        const table = document.getElementById("table");
        if (!table) return;

        table.innerHTML = '';
        console.log("total elements: " + arr.length);

        arr.forEach(listItem => {
            const text = listItem.text || "Media File";
            const info = listItem.info || "";
            const id = listItem.id;
            const isAudio = listItem.audioOnly === true;

            const row = table.insertRow(0);
            const cell = row.insertCell(0);

            const card = document.createElement('div');
            card.className = "media-item-row";

            // Icon Column
            const iconWrap = document.createElement('div');
            iconWrap.className = "media-icon-wrap";
            const iconImg = document.createElement('img');
            iconImg.className = "media-icon-img";
            iconImg.src = isAudio ? './assets/audio.png' : './assets/video.png';
            iconImg.alt = isAudio ? 'Audio' : 'Video';
            iconWrap.appendChild(iconImg);

            // Title Column
            const contentCol = document.createElement('div');
            contentCol.className = "media-content-col";

            const titleBtn = document.createElement('button');
            titleBtn.className = "media-title-btn";
            titleBtn.innerText = text;
            titleBtn.id = id;
            titleBtn.title = listItem.kind === 'hls' ? `${listItem.pageTitle || 'HLS video'} ? ${text}` : text;
            contentCol.appendChild(titleBtn);

            // Metadata Rail Column
            const metaRail = document.createElement('div');
            metaRail.className = "media-meta-rail";

            const parsedBadges = this.parseInfo(info);
            parsedBadges.forEach(badge => {
                const pill = document.createElement('span');
                pill.className = `meta-pill ${badge.type}`;
                pill.innerText = badge.text;
                metaRail.appendChild(pill);
            });

            card.appendChild(iconWrap);
            card.appendChild(contentCol);
            card.appendChild(metaRail);

            cell.appendChild(card);

            const handleDownload = async (e) => {
                e.stopPropagation();
                if (listItem.kind === 'hls') {
                    try {
                        const response = await chrome.runtime.sendMessage({ type: 'hls-open', itemId: id, tabId: this.tabId });
                        if (!response || response.error) throw new Error(response?.error || 'Unable to open HLS download.');
                        window.close();
                    } catch (error) { this.showError(error.message); }
                } else {
                    chrome.runtime.sendMessage({ type: 'vid', itemId: id });
                }
            };

            titleBtn.addEventListener('click', handleDownload);
            iconWrap.addEventListener('click', handleDownload);
            card.addEventListener('click', handleDownload);
        });
    }
}

var popup = new VideoPopup();
popup.run();
