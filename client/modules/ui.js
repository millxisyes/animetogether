import { state } from './state.js';
import {
    searchAnime,
    loadRecentEpisodes,
    loadTopAiring,
    showSearchResults
} from './catalog.js';
import {
    togglePlayPause,
    handleSeek,
    updateVolumeIcon,
    updateProgress,
    updateTimeDisplay,
    skipIntro
} from './player.js';
import { sendWsMessage } from './socket.js';
import { captionSettings } from './captionSettings.js';

// DOM Elements
export const elements = {
    loadingScreen: document.getElementById('loading-screen'),
    mainScreen: document.getElementById('main-screen'),
    roleBadge: document.getElementById('role-badge'),
    viewerCount: document.getElementById('viewer-count-num'),
    sidebar: document.getElementById('sidebar'),
    sidebarToggle: document.getElementById('sidebar-toggle'),
    floatingToolbar: document.getElementById('floating-toolbar'),
    fullscreenToggle: document.getElementById('fullscreen-toggle'),
    searchInput: document.getElementById('search-input'),
    searchBtn: document.getElementById('search-btn'),
    animeResults: document.getElementById('anime-results'),
    animeDetails: document.getElementById('anime-details'),
    animeInfo: document.getElementById('anime-info'),
    episodeList: document.getElementById('episode-list'),
    backToResults: document.getElementById('back-to-results'),
    emptyState: document.getElementById('empty-state'),
    emptyMessage: document.getElementById('empty-message'),
    videoWrapper: document.getElementById('video-wrapper'),
    videoPlayer: document.getElementById('video-player'),
    playPauseBtn: document.getElementById('play-pause-btn'),
    progressBar: document.getElementById('progress-bar'),
    progressFill: document.getElementById('progress-fill'),
    progressBuffer: document.getElementById('progress-buffer'),
    timeDisplay: document.getElementById('time-display'),
    nowPlaying: document.getElementById('now-playing'),
    syncIndicator: document.getElementById('sync-indicator'),
    videoLoadingOverlay: document.getElementById('video-loading-overlay'),
    videoLoadingText: document.getElementById('video-loading-text'),
    videoLoadingSpinner: document.getElementById('video-loading-spinner'),
    streamErrorAlert: document.getElementById('stream-error-alert'),
    streamErrorMessage: document.getElementById('stream-error-message'),
    errorDismissBtn: document.getElementById('error-dismiss-btn'),
    muteBtn: document.getElementById('mute-btn'),
    volumeSlider: document.getElementById('volume-slider'),
    chatMessages: document.getElementById('chat-messages'),
    chatInput: document.getElementById('chat-input'),
    chatSend: document.getElementById('chat-send'),
    captionBtn: document.getElementById('caption-btn'),
    captionMenu: document.getElementById('caption-menu'),
    captionOptions: document.getElementById('caption-options'),
    dubToggle: document.getElementById('dub-toggle'),
    dubLabel: document.getElementById('dub-label'),
    skipIntroBtn: document.getElementById('skip-intro-btn'),
    hianimeWarning: document.getElementById('hianime-warning'),
};

export function showMainScreen() {
    elements.loadingScreen.classList.remove('active');
    elements.mainScreen.classList.add('active');
}

export function updateRoleUI(isHost) {
    elements.roleBadge.textContent = isHost ? 'Host' : 'Viewer';
    elements.roleBadge.className = `badge ${isHost ? 'host' : 'viewer'}`;

    const isPip = document.body.classList.contains('pip-mode');

    if (isHost) {
        elements.emptyMessage.textContent = 'Search and select an anime to watch together!';
        if (elements.sidebarToggle) elements.sidebarToggle.classList.remove('hidden');
        if (!isPip) {
            elements.sidebar.classList.remove('hidden');
        }
    } else {
        elements.sidebar.classList.add('hidden');
        elements.emptyMessage.textContent = 'Waiting for host to select an anime...';
        if (elements.sidebarToggle) elements.sidebarToggle.classList.add('hidden');
    }
}

export function updateFullscreenUI(isFullscreen) {
    if (elements.fullscreenToggle) {
        elements.fullscreenToggle.textContent = isFullscreen ? '✕' : '⛶';
        elements.fullscreenToggle.title = isFullscreen ? 'Exit Fullscreen (F or Esc)' : 'Fullscreen (F)';
        elements.fullscreenToggle.classList.toggle('active', isFullscreen);
    }
}

export function showStreamError(message) {
    elements.streamErrorMessage.textContent = message;
    elements.streamErrorAlert.classList.remove('hidden');

    const autoHideTimer = setTimeout(() => {
        elements.streamErrorAlert.classList.add('hidden');
    }, 5000);

    const dismissHandler = () => {
        clearTimeout(autoHideTimer);
        elements.streamErrorAlert.classList.add('hidden');
        elements.errorDismissBtn.removeEventListener('click', dismissHandler);
    };

    elements.errorDismissBtn.addEventListener('click', dismissHandler);
}

export function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

export function addChatMessage(message) {
    if (!elements.chatMessages) return;
    const div = document.createElement('div');
    div.className = `chat-message${message.system ? ' system' : ''}`;
    if (message.system) {
        div.textContent = message.content;
    } else {
        const username = message.username || 'Unknown';
        div.innerHTML = `<span class="username">${escapeHtml(username)}:</span><span class="content">${escapeHtml(message.content)}</span>`;
    }
    elements.chatMessages.appendChild(div);
    elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
}

export function sendChatMessage() {
    const content = elements.chatInput.value.trim();
    if (!content) return;
    sendWsMessage({
        type: 'chat',
        username: state.user.username,
        content: content,
    });
    elements.chatInput.value = '';
}

export function handleResize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const isPip = width < 600 || height < 400;

    if (isPip) {
        document.body.classList.add('pip-mode');
        if (elements.sidebar) elements.sidebar.classList.add('hidden');
    } else {
        document.body.classList.remove('pip-mode');
        if (state.isHost && state.user && elements.sidebar) {
            elements.sidebar.classList.remove('hidden');
        }
    }

    if (state.user) updateRoleUI(state.isHost);
}

export function toggleFullscreen() {
    const isCurrentlyFullscreen = document.body.classList.contains('fullscreen-mode');

    const fsElement = document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.mozFullScreenElement ||
        document.msFullscreenElement;

    if (!isCurrentlyFullscreen && !fsElement) {
        const elem = document.documentElement;
        const requestFS = elem.requestFullscreen ||
            elem.webkitRequestFullscreen ||
            elem.mozRequestFullScreen ||
            elem.msRequestFullscreen;

        document.body.classList.add('fullscreen-mode');
        updateFullscreenUI(true);

        if (requestFS) {
            requestFS.call(elem).catch(() => {
                console.log('Using CSS fullscreen mode');
            });
        }
    } else {
        document.body.classList.remove('fullscreen-mode');
        updateFullscreenUI(false);

        if (fsElement) {
            const exitFS = document.exitFullscreen ||
                document.webkitExitFullscreen ||
                document.mozCancelFullScreen ||
                document.msExitFullscreen;
            if (exitFS) {
                exitFS.call(document).catch(() => { });
            }
        }
    }
}

function handleFullscreenChange() {
    const fsElement = document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.mozFullScreenElement ||
        document.msFullscreenElement;

    if (!fsElement && document.body.classList.contains('fullscreen-mode')) {
        document.body.classList.remove('fullscreen-mode');
        updateFullscreenUI(false);
    } else if (fsElement && !document.body.classList.contains('fullscreen-mode')) {
        document.body.classList.add('fullscreen-mode');
        updateFullscreenUI(true);
    }
}

export function setupEventListeners() {
    window.addEventListener('resize', handleResize);

    if (elements.sidebarToggle) {
        elements.sidebarToggle.addEventListener('click', () => {
            elements.sidebar.classList.toggle('hidden');
            elements.sidebarToggle.classList.toggle('active');
        });
    }

    if (elements.fullscreenToggle) {
        elements.fullscreenToggle.addEventListener('click', toggleFullscreen);
    }

    if (elements.dubToggle) {
        elements.dubToggle.addEventListener('click', () => {
            state.isDub = !state.isDub;
            elements.dubToggle.classList.toggle('active', state.isDub);
            elements.dubLabel.textContent = state.isDub ? 'DUB' : 'SUB';
        });
    }

    let hideToolbarTimeout;
    const startAutoHide = () => {
        if (elements.floatingToolbar) {
            elements.floatingToolbar.classList.add('auto-hide');
        }
    };
    const cancelAutoHide = () => {
        clearTimeout(hideToolbarTimeout);
        if (elements.floatingToolbar) {
            elements.floatingToolbar.classList.remove('auto-hide');
        }
    };

    document.addEventListener('mousemove', () => {
        cancelAutoHide();
        if (state.currentVideo && elements.videoPlayer && !elements.videoPlayer.paused) {
            hideToolbarTimeout = setTimeout(startAutoHide, 3000);
        }
    });

    if (elements.searchBtn) elements.searchBtn.addEventListener('click', searchAnime);
    if (elements.searchInput) {
        elements.searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') searchAnime();
        });
    }

    document.querySelectorAll('.quick-link').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.quick-link').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const view = btn.dataset.view;
            if (view === 'recent') loadRecentEpisodes();
            else if (view === 'top') loadTopAiring();
            else showSearchResults();
        });
    });

    if (elements.backToResults) {
        elements.backToResults.addEventListener('click', () => {
            elements.animeDetails.classList.add('hidden');
            elements.animeResults.classList.remove('hidden');
        });
    }

    if (elements.playPauseBtn) elements.playPauseBtn.addEventListener('click', togglePlayPause);
    if (elements.progressBar) elements.progressBar.addEventListener('click', handleSeek);
    if (elements.skipIntroBtn) elements.skipIntroBtn.addEventListener('click', skipIntro);

    // Restore volume
    const storedVol = localStorage.getItem('volume');
    if (storedVol !== null) {
        const vol = parseFloat(storedVol);
        if (elements.videoPlayer) elements.videoPlayer.volume = vol;
        if (elements.volumeSlider) elements.volumeSlider.value = vol;
        updateVolumeIcon(vol);
    }

    if (elements.volumeSlider) {
        elements.volumeSlider.addEventListener('input', (e) => {
            const volume = parseFloat(e.target.value);
            elements.videoPlayer.volume = volume;
            updateVolumeIcon(volume);
            localStorage.setItem('volume', volume);
        });
    }
    if (elements.muteBtn) {
        elements.muteBtn.addEventListener('click', () => {
            elements.videoPlayer.muted = !elements.videoPlayer.muted;
            updateVolumeIcon(elements.videoPlayer.muted ? 0 : elements.videoPlayer.volume);
        });
    }

    if (elements.videoPlayer) {
        elements.videoPlayer.addEventListener('timeupdate', updateProgress);
        elements.videoPlayer.addEventListener('loadedmetadata', updateTimeDisplay);

        elements.videoPlayer.addEventListener('dblclick', (e) => {
            e.preventDefault();
            toggleFullscreen();
        });

        elements.videoPlayer.addEventListener('click', (e) => {
            if (e.detail === 1) {
                setTimeout(() => {
                    if (state.isHost) togglePlayPause();
                }, 200);
            }
        });
    }

    document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        switch (e.key) {
            case ' ':
            case 'k':
                e.preventDefault();
                if (state.isHost) togglePlayPause();
                break;
            case 'f':
                e.preventDefault();
                toggleFullscreen();
                break;
            case 'l':
            case 'L':
                if (state.isHost && elements.sidebar) {
                    e.preventDefault();
                    elements.sidebar.classList.toggle('hidden');
                    if (elements.sidebarToggle) elements.sidebarToggle.classList.toggle('active');
                }
                break;
            case 'c':
            case 'C':
                e.preventDefault();
                if (elements.captionMenu) {
                    elements.captionMenu.classList.toggle('hidden');
                }
                break;
            case 'm':
                e.preventDefault();
                if (elements.videoPlayer) {
                    elements.videoPlayer.muted = !elements.videoPlayer.muted;
                    updateVolumeIcon(elements.videoPlayer.muted ? 0 : elements.videoPlayer.volume);
                }
                break;
            case 'ArrowUp':
                e.preventDefault();
                if (elements.videoPlayer) {
                    const newVol = Math.min(1, elements.videoPlayer.volume + 0.1);
                    elements.videoPlayer.volume = newVol;
                    if (elements.volumeSlider) elements.volumeSlider.value = newVol;
                    updateVolumeIcon(newVol);
                }
                break;
            case 'ArrowDown':
                e.preventDefault();
                if (elements.videoPlayer) {
                    const newVol = Math.max(0, elements.videoPlayer.volume - 0.1);
                    elements.videoPlayer.volume = newVol;
                    if (elements.volumeSlider) elements.volumeSlider.value = newVol;
                    updateVolumeIcon(newVol);
                }
                break;
            case 'ArrowLeft':
                if (state.isHost && state.currentVideo) {
                    e.preventDefault();
                    const newTime = Math.max(0, elements.videoPlayer.currentTime - 10);
                    elements.videoPlayer.currentTime = newTime;
                    sendWsMessage({ type: 'seek', currentTime: newTime });
                }
                break;
            case 'ArrowRight':
                if (state.isHost && state.currentVideo) {
                    e.preventDefault();
                    const newTime = Math.min(elements.videoPlayer.duration, elements.videoPlayer.currentTime + 10);
                    elements.videoPlayer.currentTime = newTime;
                    sendWsMessage({ type: 'seek', currentTime: newTime });
                }
                break;
        }
    });

    setInterval(() => {
        if (state.isHost && state.currentVideo && elements.videoPlayer && !elements.videoPlayer.paused) {
            sendWsMessage({
                type: 'sync',
                playing: !elements.videoPlayer.paused,
                currentTime: elements.videoPlayer.currentTime,
                episodeId: state.currentVideo.episodeId,
            });
        }
    }, 2000);

    if (elements.captionBtn) {
        elements.captionBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            elements.captionMenu.classList.toggle('hidden');
        });
    }

    document.addEventListener('click', (e) => {
        if (elements.captionMenu && !elements.captionMenu.contains(e.target) && e.target !== elements.captionBtn) {
            elements.captionMenu.classList.add('hidden');
        }
    });

    if (elements.chatSend) elements.chatSend.addEventListener('click', sendChatMessage);
    if (elements.chatInput) {
        elements.chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') sendChatMessage();
        });
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleFullscreenChange);

    // Initialize Caption Settings
    captionSettings.load();
    captionSettings.initUI();
}
