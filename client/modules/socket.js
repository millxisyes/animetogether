import { state } from './state.js';
import { addChatMessage, updateRoleUI } from './ui.js';
import { elements } from './dom.js';
import {
    handleSync,
    handleRemotePlay,
    handleRemotePause,
    handleRemoteSeek,
    loadVideo,
    loadSubtitle,
    fetchAndLoadVideoForViewer,
    syncPlaybackForLateJoiner,
    updateCaptionButtonState
} from './player.js';
import { updateSettingsUI } from './settings.js';
import { updateDiscordActivity } from './auth.js';

export function isWebSocketOpen() {
    return state.ws && state.ws.readyState === WebSocket.OPEN;
}

export function sendWsMessage(payload) {
    if (!isWebSocketOpen()) {
        console.warn('WebSocket not ready, dropping message', payload?.type);
        return false;
    }

    try {
        state.ws.send(JSON.stringify(payload));
        return true;
    } catch (err) {
        console.error('Failed to send WS message', err);
        return false;
    }
}

export function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    console.log('Connecting to WS:', wsUrl);
    state.ws = new WebSocket(wsUrl);

    state.ws.onopen = () => {
        console.log('WebSocket connected');
        sendWsMessage({
            type: 'join',
            channelId: state.channelId,
            odUserId: state.user.id,
            username: state.user.username,
            avatar: state.user.avatar,
        });
    };

    state.ws.onmessage = (event) => {
        try {
            const message = JSON.parse(event.data);
            handleWebSocketMessage(message);
        } catch (e) {
            console.error('Failed to parse WS message', e);
        }
    };

    state.ws.onclose = () => {
        console.log('WebSocket disconnected, reconnecting...');
        setTimeout(connectWebSocket, 3000);
    };

    state.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
    };
}

function handleWebSocketMessage(message) {
    switch (message.type) {
        case 'role':
            handleRoleAssignment(message);
            break;
        case 'sync':
            handleSync(message);
            break;
        case 'play':
            handleRemotePlay();
            break;
        case 'pause':
            handleRemotePause();
            break;
        case 'seek':
            handleRemoteSeek(message.currentTime);
            break;
        case 'load-video':
            if (message.video) {
                // Viewers need to fetch their own fresh stream URL to avoid session/token issues
                if (!state.isHost && message.video.episodeId) {
                    fetchAndLoadVideoForViewer(message.video, message.playbackState);
                } else {
                    // Host already loaded the video, or no episodeId for re-fetch
                    loadVideo(message.video, message.playbackState);
                    if (message.video.subtitle) {
                        loadSubtitle(message.video.subtitle);
                    }
                }
                const videoTitle = (message.video.title || 'Unknown').trim();
                const videoEpisode = message.video.episode || '?';
                updateDiscordActivity(`Watching ${videoTitle}`, `Episode ${videoEpisode}`);
            }
            break;
        case 'subtitle-change':
            if (!state.isHost) loadSubtitle(message.subtitle);
            break;
        case 'viewer-joined':
            elements.viewerCount.textContent = message.viewerCount;
            addChatMessage({ system: true, content: `A viewer joined (${message.viewerCount} watching)` });
            break;
        case 'viewer-left':
            elements.viewerCount.textContent = message.viewerCount;
            addChatMessage({ system: true, content: `A viewer left (${message.viewerCount} watching)` });
            break;
        case 'host-changed':
            if (message.newHostId === state.user.id) {
                state.isHost = true;
                updateRoleUI(true);
                addChatMessage({ system: true, content: 'You are now the host!' });
            } else {
                addChatMessage({ system: true, content: 'Host has changed' });
            }
            break;
        case 'chat':
            addChatMessage(message);
            break;
        case 'error':
            addChatMessage({ system: true, content: `Error: ${message.message}` });
            break;
        case 'settings-update':
            updateSettingsUI(message.settings);
            addChatMessage({ system: true, content: 'Room settings updated.' });
            break;
    }
}

function handleRoleAssignment(message) {
    state.isHost = message.isHost;
    elements.viewerCount.textContent = message.viewerCount;
    updateRoleUI(state.isHost);

    // Initial Settings
    if (message.settings) {
        updateSettingsUI(message.settings);
    }

    // Late joiner sync - if there's a video playing, sync to it
    if (message.currentVideo && message.currentVideo.episodeId) {
        // Re-fetch fresh streaming URL for late joiner
        fetchAndLoadVideoForViewer(message.currentVideo, message.playbackState);
    } else if (message.currentVideo && message.currentVideo.url) {
        // Fallback: try to use existing URL (might be expired, but we have signed URL now?)
        // If message.currentVideo.url is signed, it might still be valid or session bound.
        // Ideally we re-fetch ALWAYS. But if no episodeId, we can't.
        loadVideo(message.currentVideo, message.playbackState);
        if (message.currentVideo.subtitle) {
            loadSubtitle(message.currentVideo.subtitle);
        }
        syncPlaybackForLateJoiner(message.playbackState);
    }
}
