import Hls from 'hls.js';
import { state } from './state.js';
import { elements, showStreamError, addChatMessage } from './ui.js';
import { formatTime } from './utils.js';
import { sendWsMessage } from './socket.js';
import { updateDiscordActivity } from './auth.js';
import { updateAniListProgress } from './anilist.js';
import { featureFlags } from './flags.js';
import { proxyImage } from './utils.js'; // Needed for next episode thumbnail

export async function fetchAndLoadVideoForViewer(videoInfo, playbackState) {
    console.log('Viewer: fetching fresh stream for episode', videoInfo.episodeId);

    elements.nowPlaying.textContent = 'Loading...';
    elements.emptyState.classList.add('hidden');
    elements.videoWrapper.classList.remove('hidden');
    elements.videoLoadingOverlay.classList.remove('hidden');
    // Hide retry button for initial load, show on error
    if (elements.errorRetryBtn) elements.errorRetryBtn.style.display = 'none';

    elements.videoLoadingSpinner.style.display = 'flex';
    elements.videoLoadingText.textContent = 'Loading episode...';


    try {
        const dubParam = videoInfo.isDub ? '&dub=true' : '';
        const provider = videoInfo.provider || 'animekai';
        const hianimeParam = featureFlags.isEnabled('hianime') ? '&hianime=true' : '';
        const response = await fetch(`/api/anime/watch/${encodeURIComponent(videoInfo.episodeId)}?provider=${provider}${dubParam}${hianimeParam}`);
        if (!response.ok) {
            throw new Error(`Failed to fetch episode sources (Status: ${response.status})`);
        }
        const data = await response.json();

        // Show/Hide HiAnime Warning
        if (data.serverUsed === 'hianime-fallback') {
            elements.hianimeWarning.classList.remove('hidden');
        } else {
            elements.hianimeWarning.classList.add('hidden');
        }

        if (data.sources && data.sources.length > 0) {
            const priorityOrder = ['default', 'auto', '1080p', '720p', '480p'];
            const sortedSources = [...data.sources].sort((a, b) => {
                const aIndex = priorityOrder.indexOf(a.quality) !== -1 ? priorityOrder.indexOf(a.quality) : 99;
                const bIndex = priorityOrder.indexOf(b.quality) !== -1 ? priorityOrder.indexOf(b.quality) : 99;
                return aIndex - bIndex;
            });

            const source = sortedSources[0];
            const proxyUrl = source.proxyUrl; // Use signed proxy URL

            const freshVideoData = {
                ...videoInfo,
                url: proxyUrl,
                subtitles: data.subtitles || [],
            };

            if (!videoInfo.isDub && data.subtitles && data.subtitles.length > 0) {
                // Robust English detection
                const findEnglish = (subs) => subs.find(s => s.lang?.toLowerCase().includes('english') || s.lang?.toLowerCase() === 'en' || s.lang?.toLowerCase() === 'eng');
                const engSub = findEnglish(data.subtitles) || data.subtitles[0];
                if (engSub) {
                    freshVideoData.subtitle = engSub.proxyUrl; // Use signed subtitle URL
                }
            }

            loadVideo(freshVideoData, playbackState);
            elements.videoLoadingOverlay.classList.add('hidden');

            populateCaptionMenu(data.subtitles || []);

            if (freshVideoData.subtitle) {
                loadSubtitle(freshVideoData.subtitle);
                state.captionsEnabled = true;
                updateCaptionButtonState(true);
            } else if (videoInfo.subtitle) {
                loadSubtitle(videoInfo.subtitle);
            }

            if (playbackState && (playbackState.playing || playbackState.currentTime > 0)) {
                syncPlaybackForLateJoiner(playbackState);
            }
        } else {
            console.error('No sources found for viewer');
            elements.videoLoadingSpinner.style.display = 'none';
            elements.videoLoadingText.textContent = 'No sources available for this episode';
            if (elements.errorRetryBtn) elements.errorRetryBtn.style.display = 'block';
            showStreamError('No video sources found. Try a different episode or provider.');

            setTimeout(() => {
                elements.videoLoadingOverlay.classList.add('hidden');
                loadVideo(videoInfo, playbackState);
                if (playbackState && (playbackState.playing || playbackState.currentTime > 0)) {
                    syncPlaybackForLateJoiner(playbackState);
                }
            }, 2000);
        }
    } catch (error) {
        console.error('Failed to fetch fresh stream for viewer:', error);
        elements.videoLoadingSpinner.style.display = 'none';
        elements.videoLoadingText.textContent = 'Error loading stream';
        if (elements.errorRetryBtn) elements.errorRetryBtn.style.display = 'block';
        showStreamError(`Failed to load streams: ${error.message}`);

        setTimeout(() => {
            elements.videoLoadingOverlay.classList.add('hidden');
            loadVideo(videoInfo, playbackState);
            if (playbackState && (playbackState.playing || playbackState.currentTime > 0)) {
                syncPlaybackForLateJoiner(playbackState);
            }
        }, 2000);
    }
}

export async function playEpisode(episodeId, title, episode, thumbnail) {
    if (!state.isHost) return;

    elements.nowPlaying.textContent = 'Loading...';
    elements.emptyState.classList.add('hidden');
    elements.videoWrapper.classList.remove('hidden');
    elements.videoLoadingOverlay.classList.remove('hidden');
    // Hide retry button for initial load
    if (elements.errorRetryBtn) elements.errorRetryBtn.style.display = 'none';

    elements.videoLoadingSpinner.style.display = 'flex';
    elements.videoLoadingText.textContent = 'Loading episode...';

    try {
        const dubParam = state.isDub ? '&dub=true' : '';
        const hianimeParam = featureFlags.isEnabled('hianime') ? '&hianime=true' : '';
        const response = await fetch(`/api/anime/watch/${encodeURIComponent(episodeId)}?provider=${state.provider}${dubParam}${hianimeParam}`);
        if (!response.ok) {
            throw new Error(`Failed to fetch episode sources (Status: ${response.status})`);
        }
        const data = await response.json();

        // Show/Hide HiAnime Warning
        if (data.serverUsed === 'hianime-fallback') {
            elements.hianimeWarning.classList.remove('hidden');
        } else {
            elements.hianimeWarning.classList.add('hidden');
        }

        if (data.sources && data.sources.length > 0) {
            const allSources = data.sources;
            let workingSource = null;
            let workingUrl = null;

            const priorityOrder = ['default', 'auto', '1080p', '720p', '480p', '360p'];
            const sortedSources = [...allSources].sort((a, b) => {
                const aIndex = priorityOrder.indexOf(a.quality) !== -1 ? priorityOrder.indexOf(a.quality) : 99;
                const bIndex = priorityOrder.indexOf(b.quality) !== -1 ? priorityOrder.indexOf(b.quality) : 99;
                return aIndex - bIndex;
            });

            for (const source of sortedSources) {
                const proxyUrl = source.proxyUrl; // Use signed
                try {
                    const testResponse = await fetch(proxyUrl, { method: 'HEAD' }).catch(() => null);
                    if (testResponse && testResponse.ok) {
                        workingSource = source;
                        workingUrl = proxyUrl;
                        break;
                    }
                } catch (e) {
                    console.log(`Source ${source.quality} failed, trying next...`);
                }
            }

            if (!workingUrl) {
                workingSource = sortedSources[0];
                workingUrl = workingSource.proxyUrl;
            }

            const allSubtitles = data.subtitles || [];

            const videoData = {
                url: workingUrl,
                title: title,
                episode: episode,
                thumbnail: thumbnail,
                subtitle: null,
                subtitles: allSubtitles,
                isDub: state.isDub,
                episodeId: episodeId,
                provider: state.provider,
                sources: allSources,
            };

            if (!state.isDub && allSubtitles.length > 0) {
                // Robust English detection
                const findEnglish = (subs) => subs.find(s => s.lang?.toLowerCase().includes('english') || s.lang?.toLowerCase() === 'en' || s.lang?.toLowerCase() === 'eng');
                const engSub = findEnglish(allSubtitles) || allSubtitles[0];
                if (engSub) {
                    videoData.subtitle = engSub.proxyUrl;
                }
            }

            sendWsMessage({
                type: 'load-video',
                video: videoData,
            });

            loadVideo(videoData, { playing: false, currentTime: 0 });
            elements.videoLoadingOverlay.classList.add('hidden');

            populateCaptionMenu(allSubtitles);

            if (videoData.subtitle) {
                loadSubtitle(videoData.subtitle);
                state.captionsEnabled = true;
                updateCaptionButtonState(true);
            }

        } else {
            elements.videoLoadingSpinner.style.display = 'none';
            elements.videoLoadingText.textContent = 'No sources available';
            if (elements.errorRetryBtn) elements.errorRetryBtn.style.display = 'block';
            showStreamError('No video sources found for this episode. Try a different episode or provider.');
            addChatMessage({ system: true, content: 'No video sources found for this episode' });
            setTimeout(() => elements.videoLoadingOverlay.classList.add('hidden'), 3000);
        }
    } catch (error) {
        console.error('Play episode error:', error);
        elements.videoLoadingSpinner.style.display = 'none';
        elements.videoLoadingText.textContent = 'Error loading stream';
        if (elements.errorRetryBtn) elements.errorRetryBtn.style.display = 'block';
        showStreamError(`Stream error: ${error.message}`);
        addChatMessage({ system: true, content: `Failed to load episode: ${error.message}` });
        setTimeout(() => elements.videoLoadingOverlay.classList.add('hidden'), 3000);
    }
}

export function loadVideo(video, playbackState) {
    if (!video || !video.url) {
        console.error('loadVideo called with invalid video data:', video);
        return;
    }
    state.currentVideo = video;

    elements.emptyState.classList.add('hidden');
    elements.videoWrapper.classList.remove('hidden');
    const title = (video.title || 'Unknown').trim();
    const episode = video.episode || '?';
    elements.nowPlaying.textContent = `${title} - Ep ${episode}`;
    elements.progressFill.style.width = '0%';
    elements.videoPlayer.playbackRate = 1; // Reset speed
    // Reset UI speed button
    if (elements.speedBtn) elements.speedBtn.textContent = '1x';
    document.querySelectorAll('#speed-menu .caption-option').forEach(b => {
        b.classList.remove('active');
        if (b.dataset.speed === '1') b.classList.add('active');
    });

    updateTimeDisplay();

    if (state.hls) {
        state.hls.destroy();
        state.hls = null;
    }

    const oldTracks = elements.videoPlayer.querySelectorAll('track');
    oldTracks.forEach(t => t.remove());

    const videoElement = elements.videoPlayer;

    if (Hls.isSupported()) {
        state.hls = new Hls({ enableCEA708Captions: true });
        state.hls.loadSource(video.url);
        state.hls.attachMedia(videoElement);

        state.hls.on(Hls.Events.MANIFEST_PARSED, () => {
            if (playbackState && playbackState.playing) {
                videoElement.currentTime = playbackState.currentTime;
                videoElement.play().catch(() => { });
                updatePlayPauseIcon(true);
            }
        });
    } else if (videoElement.canPlayType('application/vnd.apple.mpegurl')) {
        videoElement.src = video.url;
        videoElement.addEventListener('loadedmetadata', () => {
            if (playbackState && playbackState.playing) {
                videoElement.currentTime = playbackState.currentTime;
                videoElement.play().catch(() => { });
                updatePlayPauseIcon(true);
            }
        });
    }

    // Auto-Next Listener
    videoElement.removeEventListener('ended', handleVideoEnded);
    videoElement.addEventListener('ended', handleVideoEnded);

    addChatMessage({ system: true, content: `Now playing: ${title} - Episode ${episode}` });
    updateDiscordActivity(`Watching ${title}`, `Episode ${episode}`);

    // Populate quality menu using sources or HLS levels
    if (video.sources) {
        populateQualityMenu(video.sources);
    }
}

export function populateQualityMenu(sources) {
    if (!elements.qualityOptions || !state.isHost) {
        if (elements.qualityBtn) elements.qualityBtn.parentElement.style.display = 'none'; // Hide if not host
        return;
    }

    // Show quality controls
    if (elements.qualityBtn) elements.qualityBtn.parentElement.style.display = 'flex';

    elements.qualityOptions.innerHTML = '';
    const buttons = [];

    // Helper to create button
    const createBtn = (label, quality, isSelected) => {
        const btn = document.createElement('button');
        btn.className = `caption-option ${isSelected ? 'active' : ''}`;
        btn.textContent = label;
        btn.dataset.quality = quality;

        btn.addEventListener('click', () => {
            // UI Update
            buttons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            if (elements.qualityBtn) elements.qualityBtn.textContent = label === 'default' ? 'Auto' : label;
            elements.qualityMenu.classList.add('hidden');

            // Logic
            const targetSource = sources.find(s => s.quality === quality);
            if (targetSource && state.currentVideo) {
                const currentTime = elements.videoPlayer.currentTime;
                const wasPlaying = !elements.videoPlayer.paused;

                // Update URL
                state.currentVideo.url = targetSource.proxyUrl;

                // Reload HLS or Src
                const videoElement = elements.videoPlayer;
                if (state.hls) {
                    state.hls.loadSource(targetSource.proxyUrl);
                } else {
                    videoElement.src = targetSource.proxyUrl;
                }

                // Seek back to time
                const restoreTime = () => {
                    videoElement.currentTime = currentTime;
                    if (wasPlaying) videoElement.play().catch(() => { });
                };

                if (state.hls) {
                    state.hls.once(Hls.Events.MANIFEST_PARSED, restoreTime);
                } else {
                    videoElement.addEventListener('loadedmetadata', restoreTime, { once: true });
                }

                // Notify peers of new URL? 
                // Actually peers should probably stick to their own quality or 'auto'. 
                // But if we want to force everyone onto a specific source we can via sync.
                // Ideally, just switch local quality for host is fine, peers handle their own via separate fetch. 
                // But wait, playEpisode sets the URL for everyone via ws 'load-video'.
                // If host switches quality, we probably SHOULD update the 'currentVideo' state but NOT necessarily force execute 'load-video' for everyone unless we want to force quality.
                // For now, let's keep it client-side for the host. 
                // If we want viewers to have quality control, we need to expose the sources list to them in 'load-video'.
                // We already pass `sources: allSources` in `playEpisode`, so viewers HAVE the list.
                // So we just need to enable the menu for viewers too!
            }
        });

        elements.qualityOptions.appendChild(btn);
        buttons.push(btn);
    };

    // Sort: default/auto first, then high to low resolutions
    const priorityOrder = ['default', 'auto', '1080p', '720p', '480p', '360p'];
    const sorted = [...sources].sort((a, b) => {
        const aIndex = priorityOrder.indexOf(a.quality);
        const bIndex = priorityOrder.indexOf(b.quality);
        // If both known, compare index
        if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
        // If only a known
        if (aIndex !== -1) return -1;
        // If only b known
        if (bIndex !== -1) return 1;
        return 0;
    });

    sorted.forEach(source => {
        // Determine if active
        // Simplistic check: if source url matches current
        let isActive = false;
        if (state.currentVideo && state.currentVideo.url === source.proxyUrl) isActive = true;

        createBtn(source.quality === 'default' ? 'Auto' : source.quality, source.quality, isActive);
    });
}

export function loadSubtitle(url) {
    const video = elements.videoPlayer;
    if (!video) return;

    const oldTracks = video.querySelectorAll('track');
    oldTracks.forEach(t => t.remove());

    const track = document.createElement('track');
    track.kind = 'captions';
    track.label = 'English';
    track.srclang = 'en';
    track.default = true;
    track.src = url;

    video.appendChild(track);

    const enableSubtitles = () => {
        try {
            if (video.textTracks && video.textTracks.length > 0) {
                for (let i = 0; i < video.textTracks.length; i++) {
                    video.textTracks[i].mode = 'showing';
                }
            }
        } catch (e) {
            console.warn('Could not enable subtitles:', e);
        }
    };

    track.addEventListener('load', () => enableSubtitles());
    setTimeout(enableSubtitles, 200);
    setTimeout(enableSubtitles, 1000);

    state.captionsEnabled = true;
    updateCaptionButtonState(true);
    addChatMessage({ system: true, content: 'Subtitles loaded' });
}

export function populateCaptionMenu(subtitles) {
    if (!elements.captionOptions) return;
    elements.captionOptions.innerHTML = '';
    const buttons = [];

    const offBtn = document.createElement('button');
    offBtn.className = 'caption-option active';
    offBtn.dataset.lang = 'off';
    offBtn.textContent = 'Off';
    elements.captionOptions.appendChild(offBtn);
    buttons.push(offBtn);

    if (subtitles && subtitles.length > 0) {
        subtitles.forEach((sub, index) => {
            const lang = sub.lang || 'Unknown';
            const isDefault = lang === 'English' || index === 0;
            const btn = document.createElement('button');
            btn.className = 'caption-option';
            btn.dataset.lang = lang;
            if (sub.proxyUrl) btn.dataset.url = sub.proxyUrl; // Use signed
            btn.textContent = lang;
            if (isDefault) {
                offBtn.classList.remove('active');
                btn.classList.add('active');
            }
            elements.captionOptions.appendChild(btn);
            buttons.push(btn);
        });
    }

    buttons.forEach(btn => {
        btn.addEventListener('click', () => {
            buttons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            if (btn.dataset.lang === 'off') {
                disableSubtitles();
            } else if (btn.dataset.url) {
                loadSubtitle(btn.dataset.url);
            }
            elements.captionMenu.classList.add('hidden');
        });
    });
}

export function disableSubtitles() {
    const video = elements.videoPlayer;
    if (!video) return;
    for (let i = 0; i < video.textTracks.length; i++) {
        video.textTracks[i].mode = 'disabled';
    }
    state.captionsEnabled = false;
    updateCaptionButtonState(false);
}

export function updateCaptionButtonState(enabled) {
    if (elements.captionBtn) {
        elements.captionBtn.classList.toggle('active', enabled);
    }
}

export function updatePlayPauseIcon(playing) {
    const playIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>';
    const pauseIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>';
    elements.playPauseBtn.innerHTML = playing ? pauseIcon : playIcon;
}

export function togglePlayPause() {
    if (!state.isHost && !(state.roomSettings && state.roomSettings.freeMode)) return;
    const video = elements.videoPlayer;
    if (video.paused) {
        video.play().catch(() => { });
        updatePlayPauseIcon(true);
        sendWsMessage({ type: 'play' });
    } else {
        video.pause();
        updatePlayPauseIcon(false);
        sendWsMessage({ type: 'pause' });
    }
}

export function updateVolumeIcon(volume) {
    if (!elements.muteBtn) return;
    let icon;
    if (volume === 0 || elements.videoPlayer.muted) {
        icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>';
    } else if (volume < 0.5) {
        icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a4 4 0 0 1 0 5.07"></path></svg>';
    } else {
        icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a7 7 0 0 1 0 9.9M19.07 4.93a10 10 0 0 1 0 14.14"></path></svg>';
    }
    elements.muteBtn.innerHTML = icon;
}

export function handleSeek(e) {
    if (!state.isHost && !(state.roomSettings && state.roomSettings.freeMode)) return;
    if (!elements.videoPlayer.duration || !isFinite(elements.videoPlayer.duration)) return;
    const rect = elements.progressBar.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const time = percent * elements.videoPlayer.duration;
    elements.videoPlayer.currentTime = time;
    sendWsMessage({ type: 'seek', currentTime: time });
}

export function updateProgress() {
    const video = elements.videoPlayer;
    if (!video.duration || !isFinite(video.duration)) {
        elements.progressFill.style.width = '0%';
        if (elements.progressBuffer) elements.progressBuffer.style.width = '0%';
        updateTimeDisplay();
        return;
    }

    const percent = (video.currentTime / video.duration) * 100;
    elements.progressFill.style.width = `${percent}%`;

    if (elements.progressBuffer && video.buffered.length > 0) {
        const bufferedEnd = video.buffered.end(video.buffered.length - 1);
        const bufferPercent = (bufferedEnd / video.duration) * 100;
        elements.progressBuffer.style.width = `${bufferPercent}%`;
    }

    updateTimeDisplay();

    // Save history
    if (state.isHost) saveToHistory();
    // Start saving for everyone? Or just host? 
    // Usually local history is local. Video plays for everyone.
    // Let's save for everyone if they are watching.
    // Actually limit it to whenever progress updates.
    saveToHistory();

    // Check for AniList scrobble (90%)
    checkAniListProgress(video);
}

// Throttle AniList updates to avoid spam
let anilistUpdatedEpisode = null;
function checkAniListProgress(video) {
    if (!state.currentVideo || !state.currentVideo.episode) return;

    // Avoid double update for same episode session
    if (anilistUpdatedEpisode === state.currentVideo.episodeId) return;

    if (video.duration > 0 && (video.currentTime / video.duration) > 0.9) {
        anilistUpdatedEpisode = state.currentVideo.episodeId;
        updateAniListProgress(state.currentVideo.title, state.currentVideo.episode);
    }
}

export function updateTimeDisplay() {
    const video = elements.videoPlayer;
    const current = formatTime(video.currentTime);
    const duration = formatTime(video.duration);
    elements.timeDisplay.textContent = `${current} / ${duration}`;
}

// History Throttle
let lastHistorySave = 0;
function saveToHistory() {
    if (!state.currentVideo || !state.currentVideo.episodeId) return;

    const now = Date.now();
    if (now - lastHistorySave < 5000) return; // Throttle 5s
    lastHistorySave = now;

    try {
        const history = JSON.parse(localStorage.getItem('watchHistory') || '[]');
        const newItem = {
            id: state.currentVideo.episodeId, // distinct by episode
            animeId: state.currentVideo.episodeId.split('$')[0], // ballpark anime id
            title: state.currentVideo.title,
            episode: state.currentVideo.episode,
            thumbnail: state.currentVideo.thumbnail || null,
            currentTime: elements.videoPlayer.currentTime,
            duration: elements.videoPlayer.duration,
            timestamp: now,
            provider: state.provider
        };

        // Remove existing entry for this specific episode
        const filtered = history.filter(h => h.id !== newItem.id);
        // Add new at top
        filtered.unshift(newItem);
        // Keep max 50
        const trimmed = filtered.slice(0, 50);

        localStorage.setItem('watchHistory', JSON.stringify(trimmed));
    } catch (e) {
        console.error('Failed to save history:', e);
    }
}

export function syncPlaybackForLateJoiner(playbackState) {
    if (!state.isHost && playbackState) {
        setTimeout(() => {
            const serverTime = playbackState.currentTime;
            const timeSinceUpdate = (Date.now() - playbackState.lastUpdate) / 1000;
            const estimatedTime = playbackState.playing
                ? serverTime + timeSinceUpdate
                : serverTime;

            if (Math.abs(elements.videoPlayer.currentTime - estimatedTime) > 1) {
                elements.videoPlayer.currentTime = estimatedTime;
                showSyncIndicator('Synced!');
            }

            if (playbackState.playing && elements.videoPlayer.paused) {
                elements.videoPlayer.play().catch(() => { });
                updatePlayPauseIcon(true);
            }
        }, 500);
    }
}

export function showSyncIndicator(text = 'Syncing...') {
    elements.syncIndicator.textContent = text;
    elements.syncIndicator.classList.remove('hidden');
    setTimeout(() => elements.syncIndicator.classList.add('hidden'), 1500);
}

function updateDiscordActivityState(isPlaying) {
    if (!state.currentVideo) return;
    updateDiscordActivity(
        `Watching ${state.currentVideo.title}`,
        `Episode ${state.currentVideo.episode}`,
        isPlaying ? 'Playing' : 'Paused'
    );
}

export function handleSync(message) {
    if (state.isHost) return;

    const video = elements.videoPlayer;
    if (!video || !state.currentVideo) return;

    if (message.episodeId && state.currentVideo.episodeId && message.episodeId !== state.currentVideo.episodeId) {
        console.warn('Sync episodeId mismatch - ignoring sync for different episode');
        return;
    }

    if (!video.duration || !isFinite(video.duration)) return;

    const timeDiff = Math.abs(video.currentTime - message.currentTime);

    if (timeDiff > 2) {
        showSyncIndicator();
        video.currentTime = message.currentTime;
    }

    if (message.playing && video.paused) {
        video.play().catch(() => { });
        updatePlayPauseIcon(true);
        updateDiscordActivityState(true);
    } else if (!message.playing && !video.paused) {
        video.pause();
        updatePlayPauseIcon(false);
        updateDiscordActivityState(false);
    }

    if (message.playbackRate && video.playbackRate !== message.playbackRate) {
        video.playbackRate = message.playbackRate;
        if (elements.speedBtn) elements.speedBtn.textContent = `${message.playbackRate}x`;
    }
}

export function handleRemotePlay() {
    elements.videoPlayer.play().catch(console.error);
    updatePlayPauseIcon(true);
    updateDiscordActivityState(true);
}

export function handleRemotePause() {
    elements.videoPlayer.pause();
    updatePlayPauseIcon(false);
    updateDiscordActivityState(false);
}

export function handleRemoteSeek(currentTime) {
    if (!state.isHost) {
        elements.videoPlayer.currentTime = currentTime;
    }
}

export function skipIntro() {
    if ((!state.isHost && !(state.roomSettings && state.roomSettings.freeMode)) || !elements.videoPlayer) return;
    const newTime = Math.min(elements.videoPlayer.duration, elements.videoPlayer.currentTime + 85);
    elements.videoPlayer.currentTime = newTime;
    sendWsMessage({ type: 'seek', currentTime: newTime });
    addChatMessage({ system: true, content: 'Skipped 85s (Intro)' });
}

export function setPlaybackRate(rate) {
    if (elements.videoPlayer) {
        elements.videoPlayer.playbackRate = rate;
        if (state.isHost) {
            // Host syncs this via the regular sync interval (every 2s)
            // But we can force a sync push if we want instant update, or just wait.
            // Let's rely on the interval.
            addChatMessage({ system: true, content: `Host set playback speed to ${rate}x` });
        }
    }
}


export async function playNext() {
    if (!state.currentVideo || !state.episodeList) return;

    const currentIndex = state.episodeList.findIndex(ep => ep.id === state.currentVideo.episodeId);
    if (currentIndex === -1 || currentIndex >= state.episodeList.length - 1) return;

    const nextEp = state.episodeList[currentIndex + 1];

    // Use current video thumbnail as best guess if not available
    await playEpisode(nextEp.id, state.currentVideo.title, nextEp.number, state.currentVideo.thumbnail);
}

export async function playPrevious() {
    if (!state.currentVideo || !state.episodeList) return;

    const currentIndex = state.episodeList.findIndex(ep => ep.id === state.currentVideo.episodeId);
    if (currentIndex <= 0) return;

    const prevEp = state.episodeList[currentIndex - 1];

    await playEpisode(prevEp.id, state.currentVideo.title, prevEp.number, state.currentVideo.thumbnail);
}

async function handleVideoEnded() {
    if (!state.isHost) return;
    console.log('Video ended. checking for next episode...');

    if (!state.episodeList || state.episodeList.length === 0) {
        console.log('No episode list available for auto-next');
        return;
    }

    const currentEpisodeId = state.currentVideo.episodeId;
    const currentIndex = state.episodeList.findIndex(e => e.id === currentEpisodeId);

    if (currentIndex !== -1 && currentIndex < state.episodeList.length - 1) {
        const nextEpisode = state.episodeList[currentIndex + 1];
        console.log('Auto-playing next episode:', nextEpisode.number);

        addChatMessage({ system: true, content: `Episode finished. Auto-playing Episode ${nextEpisode.number} in 3s...` });

        setTimeout(() => {
            playEpisode(
                nextEpisode.id,
                state.currentVideo.title, // Assume title is same
                nextEpisode.number,
                null // Thumbnail might be tricky, maybe currentVideo's or let playEpisode handle it?
                // Actually playEpisode takes thumbnail. We can use proxyImage(nextEpisode.image) if available, or just null.
                // Looking at catalog.js, episode items have thumbnails. The state.episodeList usually just has ID, title, number, url?
                // Consumet episodes usually don't have individual images in the list unless detailed.
            ).catch(console.error);
        }, 3000);
    } else {
        console.log('No next episode found or last episode reached.');
    }
}

