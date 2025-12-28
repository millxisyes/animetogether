import { DiscordSDK } from '@discord/embedded-app-sdk';
import Hls from 'hls.js';

// Resolve Discord Client ID from window or build-time injected constant
const DISCORD_CLIENT_ID =
  (typeof window !== 'undefined' && window.DISCORD_CLIENT_ID) ||
  __DISCORD_CLIENT_ID__ ||
  '';

// Feature Flags System
const FEATURE_FLAG_MAPPINGS = {
  'hianimedev': { flag: 'hianime', name: 'HiAnime Fallback' }
};

const featureFlags = {
  // Load feature flags from localStorage
  load() {
    try {
      const stored = localStorage.getItem('featureFlags');
      return stored ? JSON.parse(stored) : {};
    } catch (e) {
      console.error('Failed to load feature flags:', e);
      return {};
    }
  },
  
  // Save feature flags to localStorage
  save(flags) {
    try {
      localStorage.setItem('featureFlags', JSON.stringify(flags));
    } catch (e) {
      console.error('Failed to save feature flags:', e);
    }
  },
  
  // Check if a feature flag is enabled
  isEnabled(flag) {
    const flags = this.load();
    return flags[flag] === true;
  },
  
  // Enable a feature flag
  enable(flag) {
    const flags = this.load();
    flags[flag] = true;
    this.save(flags);
  },
  
  // Disable a feature flag
  disable(flag) {
    const flags = this.load();
    flags[flag] = false;
    this.save(flags);
  },
  
  // Toggle a feature flag
  toggle(flag) {
    if (this.isEnabled(flag)) {
      this.disable(flag);
      return false;
    } else {
      this.enable(flag);
      return true;
    }
  }
};

// Initialize Discord SDK
const discordSdk = new DiscordSDK(DISCORD_CLIENT_ID);

// App State
const state = {
  user: null,
  channelId: null,
  isHost: false,
  ws: null,
  hls: null,
  currentVideo: null,
  isSeeking: false,
  captionsEnabled: false,
  currentSubtitle: null,
  provider: 'animekai',
  isDub: false, // Sub/Dub toggle
  lastSyncTime: 0, // For late joiner sync
};

// DOM Elements
const elements = {
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
  // Loading overlay
  videoLoadingOverlay: document.getElementById('video-loading-overlay'),
  videoLoadingText: document.getElementById('video-loading-text'),
  videoLoadingSpinner: document.getElementById('video-loading-spinner'),
  // Error alert
  streamErrorAlert: document.getElementById('stream-error-alert'),
  streamErrorMessage: document.getElementById('stream-error-message'),
  errorDismissBtn: document.getElementById('error-dismiss-btn'),
  // Volume
  muteBtn: document.getElementById('mute-btn'),
  volumeSlider: document.getElementById('volume-slider'),
  chatMessages: document.getElementById('chat-messages'),
  chatInput: document.getElementById('chat-input'),
  chatSend: document.getElementById('chat-send'),
  // Captions
  captionBtn: document.getElementById('caption-btn'),
  captionMenu: document.getElementById('caption-menu'),
  captionOptions: document.getElementById('caption-options'),
  // Dub toggle
  dubToggle: document.getElementById('dub-toggle'),
  dubLabel: document.getElementById('dub-label'),
};

const placeholderImage = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 85"><rect fill="%23111a2f" width="100%" height="100%"/></svg>';

function proxyImage(url) {
  if (!url) return placeholderImage;
  return `/proxy/image?url=${encodeURIComponent(url)}`;
}

// Check for feature flag via Discord SDK customId
// customId is set when activity is launched via a custom link with ?custom_id=xxx
function checkFeatureFlagCustomId() {
  // customId is available on discordSdk after ready()
  const customId = discordSdk.customId;
  
  if (!customId) {
    return false;
  }
  
  console.log('Discord SDK customId detected:', customId);
  
  // Check if the customId matches any feature flag mapping
  const config = FEATURE_FLAG_MAPPINGS[customId];
  if (config) {
    const isCurrentlyEnabled = featureFlags.isEnabled(config.flag);
    showFeatureFlagDialog(config.flag, config.name, isCurrentlyEnabled);
    return true;
  }
  
  return false;
}

// Show feature flag toggle dialog
function showFeatureFlagDialog(flag, flagName, isCurrentlyEnabled) {
  // Create modal container
  const modal = document.createElement('div');
  modal.className = 'modal feature-flag-modal';
  modal.id = 'feature-flag-modal';
  
  const action = isCurrentlyEnabled ? 'Disable' : 'Enable';
  const description = isCurrentlyEnabled 
    ? `The <strong>${flagName}</strong> feature is currently enabled. Would you like to disable it?`
    : `Would you like to enable the <strong>${flagName}</strong> feature?`;
  
  modal.innerHTML = `
    <div class="modal-backdrop"></div>
    <div class="modal-card feature-flag-card">
      <div class="modal-header">
        <h3>${action} Feature Flag</h3>
      </div>
      <div class="modal-body">
        <p>${description}</p>
      </div>
      <div class="modal-actions">
        <button class="ghost-btn" id="feature-flag-no">No</button>
        <button class="primary-btn" id="feature-flag-yes">Yes</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Handle Yes button
  document.getElementById('feature-flag-yes').addEventListener('click', () => {
    featureFlags.toggle(flag);
    const nowEnabled = featureFlags.isEnabled(flag);
    showFeatureFlagConfirmation(flagName, nowEnabled);
    modal.remove();
  });
  
  // Handle No button
  document.getElementById('feature-flag-no').addEventListener('click', () => {
    modal.remove();
  });
  
  // Handle backdrop click
  modal.querySelector('.modal-backdrop').addEventListener('click', () => {
    modal.remove();
  });
}

// Show confirmation after toggling feature flag
function showFeatureFlagConfirmation(flagName, isEnabled) {
  const modal = document.createElement('div');
  modal.className = 'modal feature-flag-modal';
  modal.id = 'feature-flag-confirmation';
  
  const status = isEnabled ? 'enabled' : 'disabled';
  
  modal.innerHTML = `
    <div class="modal-backdrop"></div>
    <div class="modal-card feature-flag-card">
      <div class="modal-header">
        <h3>Feature Flag Updated</h3>
      </div>
      <div class="modal-body">
        <p><strong>${flagName}</strong> has been ${status}.</p>
        <p class="muted-text">This setting will persist across sessions.</p>
      </div>
      <div class="modal-actions">
        <button class="primary-btn" id="feature-flag-ok">OK</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  document.getElementById('feature-flag-ok').addEventListener('click', () => {
    modal.remove();
  });
  
  modal.querySelector('.modal-backdrop').addEventListener('click', () => {
    modal.remove();
  });
}

// Initialize the app
async function init() {
  try {
    // Wait for Discord SDK to be ready
    await discordSdk.ready();
    console.log('Discord SDK ready');
    
    // Check for feature flag via customId (available after ready())
    // Link format: https://discord.com/activities/<APP_ID>?custom_id=hianimedev
    checkFeatureFlagCustomId();

    // Authorize with Discord
    const { code } = await discordSdk.commands.authorize({
      client_id: DISCORD_CLIENT_ID,
      response_type: 'code',
      state: '',
      prompt: 'none',
      scope: ['identify', 'guilds', 'rpc.activities.write'],
    });

    // Exchange code for access token
    const tokenResponse = await fetch('/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });

    const { access_token } = await tokenResponse.json();

    // Authenticate with Discord
    const auth = await discordSdk.commands.authenticate({ access_token });
    state.user = auth.user;
    state.channelId = discordSdk.channelId;

    console.log('Authenticated:', state.user.username);

    connectWebSocket();
    showMainScreen();
    setupEventListeners();
    loadTopAiring();

    // Initial Activity
    updateDiscordActivity('Browsing Anime');

    // Fix sizing on init
    handleResize();

  } catch (error) {
    console.error('Initialization error:', error);
    elements.loadingScreen.querySelector('p').textContent = 'Failed to connect. Please try again.';
  }
}

// WebSocket connection
function isWebSocketOpen() {
  return state.ws && state.ws.readyState === WebSocket.OPEN;
}

// Show a prominent error alert for stream failures
function showStreamError(message) {
  elements.streamErrorMessage.textContent = message;
  elements.streamErrorAlert.classList.remove('hidden');
  
  // Auto-hide after 5 seconds unless user interacts
  const autoHideTimer = setTimeout(() => {
    elements.streamErrorAlert.classList.add('hidden');
  }, 5000);
  
  // Allow manual dismiss
  const dismissHandler = () => {
    clearTimeout(autoHideTimer);
    elements.streamErrorAlert.classList.add('hidden');
    elements.errorDismissBtn.removeEventListener('click', dismissHandler);
  };
  
  elements.errorDismissBtn.addEventListener('click', dismissHandler);
}

function sendWsMessage(payload) {
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

function connectWebSocket() {
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

// Handle WebSocket messages
function handleWebSocketMessage(message) {
  switch (message.type) {
    case 'role':
      handleRoleAssignment(message);
      break;
    case 'sync':
      handleSync(message);
      break;
    case 'play':
      elements.videoPlayer.play().catch(console.error);
      updatePlayPauseIcon(true);
      updatePresenceState(true);
      break;
    case 'pause':
      elements.videoPlayer.pause();
      updatePlayPauseIcon(false);
      updatePresenceState(false);
      break;
    case 'seek':
      if (!state.isHost) {
        elements.videoPlayer.currentTime = message.currentTime;
      }
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
        updateRoleUI();
        addChatMessage({ system: true, content: 'You are now the host!' });
      } else {
        addChatMessage({ system: true, content: 'Host has changed' });
      }
      break;
    case 'chat':
      addChatMessage(message);
      break;
  }
}

// Handle role assignment
function handleRoleAssignment(message) {
  state.isHost = message.isHost;
  elements.viewerCount.textContent = message.viewerCount;
  updateRoleUI();
  
  // Late joiner sync - if there's a video playing, sync to it
  if (message.currentVideo && message.currentVideo.episodeId) {
    // Re-fetch fresh streaming URL for late joiner
    fetchAndLoadVideoForViewer(message.currentVideo, message.playbackState);
  } else if (message.currentVideo && message.currentVideo.url) {
    // Fallback: try to use existing URL (might be expired)
    loadVideo(message.currentVideo, message.playbackState);
    if (message.currentVideo.subtitle) {
      loadSubtitle(message.currentVideo.subtitle);
    }
    syncPlaybackForLateJoiner(message.playbackState);
  }
}

// Fetch fresh streaming URL for viewers (both late joiners and real-time)
async function fetchAndLoadVideoForViewer(videoInfo, playbackState) {
  console.log('Viewer: fetching fresh stream for episode', videoInfo.episodeId);
  
  // Show loading indicator for viewers
  elements.nowPlaying.textContent = 'Loading...';
  elements.emptyState.classList.add('hidden');
  elements.videoWrapper.classList.remove('hidden');
  elements.videoLoadingOverlay.classList.remove('hidden');
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

    if (data.sources && data.sources.length > 0) {
      // Try sources in priority order
      const priorityOrder = ['default', 'auto', '1080p', '720p', '480p'];
      const sortedSources = [...data.sources].sort((a, b) => {
        const aIndex = priorityOrder.indexOf(a.quality) !== -1 ? priorityOrder.indexOf(a.quality) : 99;
        const bIndex = priorityOrder.indexOf(b.quality) !== -1 ? priorityOrder.indexOf(b.quality) : 99;
        return aIndex - bIndex;
      });
      
      const source = sortedSources[0];
      const proxyUrl = `/proxy/hls?url=${encodeURIComponent(source.url)}`;

      const freshVideoData = {
        ...videoInfo,
        url: proxyUrl,
        subtitles: data.subtitles || [],
      };

      // Handle subtitles
      if (!videoInfo.isDub && data.subtitles && data.subtitles.length > 0) {
        const engSub = data.subtitles.find(s => s.lang === 'English') || data.subtitles[0];
        if (engSub) {
          freshVideoData.subtitle = `/proxy/subtitle?url=${encodeURIComponent(engSub.url)}`;
        }
      }

      loadVideo(freshVideoData, playbackState);
      elements.videoLoadingOverlay.classList.add('hidden');
      
      // Populate caption menu for viewer too
      populateCaptionMenu(data.subtitles || []);
      
      if (freshVideoData.subtitle) {
        loadSubtitle(freshVideoData.subtitle);
        state.captionsEnabled = true;
        updateCaptionButtonState(true);
      } else if (videoInfo.subtitle) {
        loadSubtitle(videoInfo.subtitle);
      }
      
      // Sync playback position if needed (for late joiners or if playback has started)
      if (playbackState && (playbackState.playing || playbackState.currentTime > 0)) {
        syncPlaybackForLateJoiner(playbackState);
      }
    } else {
      console.error('No sources found for viewer');
      // Show error prominently
      elements.videoLoadingSpinner.style.display = 'none';
      elements.videoLoadingText.textContent = 'No sources available for this episode';
      showStreamError('No video sources found. Try a different episode or provider.');
      
      // Still try to fallback to original URL
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
    // Show error prominently and keep overlay visible
    elements.videoLoadingSpinner.style.display = 'none';
    elements.videoLoadingText.textContent = 'Error loading stream';
    showStreamError(`Failed to load streams: ${error.message}`);
    
    // Try fallback after showing error
    setTimeout(() => {
      elements.videoLoadingOverlay.classList.add('hidden');
      loadVideo(videoInfo, playbackState);
      if (playbackState && (playbackState.playing || playbackState.currentTime > 0)) {
        syncPlaybackForLateJoiner(playbackState);
      }
    }, 2000);
  }
}

function syncPlaybackForLateJoiner(playbackState) {
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
        elements.videoPlayer.play().catch(() => {});
        updatePlayPauseIcon(true);
      }
    }, 500);
  }
}

function showSyncIndicator(text = 'Syncing...') {
  elements.syncIndicator.textContent = text;
  elements.syncIndicator.classList.remove('hidden');
  setTimeout(() => elements.syncIndicator.classList.add('hidden'), 1500);
}

// Update UI based on role
function updateRoleUI() {
  elements.roleBadge.textContent = state.isHost ? 'Host' : 'Viewer';
  elements.roleBadge.className = `badge ${state.isHost ? 'host' : 'viewer'}`;

  const isPip = document.body.classList.contains('pip-mode');

  // Host controls visibility
  if (state.isHost) {
    elements.emptyMessage.textContent = 'Search and select an anime to watch together!';
    if (elements.sidebarToggle) elements.sidebarToggle.classList.remove('hidden');
    
    // Show sidebar for host when not in PIP
    if (!isPip) {
      elements.sidebar.classList.remove('hidden');
    }
  } else {
    // Viewer mode
    elements.sidebar.classList.add('hidden');
    elements.emptyMessage.textContent = 'Waiting for host to select an anime...';
    if (elements.sidebarToggle) elements.sidebarToggle.classList.add('hidden');
  }
}

// Show main screen
function showMainScreen() {
  elements.loadingScreen.classList.remove('active');
  elements.mainScreen.classList.add('active');
}

// Setup event listeners
function setupEventListeners() {
  // Resizing and PIP Mode
  window.addEventListener('resize', handleResize);

  // Sidebar Toggle
  if (elements.sidebarToggle) {
    elements.sidebarToggle.addEventListener('click', () => {
      elements.sidebar.classList.toggle('hidden');
      elements.sidebarToggle.classList.toggle('active');
    });
  }

  // Fullscreen Toggle
  if (elements.fullscreenToggle) {
    elements.fullscreenToggle.addEventListener('click', toggleFullscreen);
  }

  // Dub Toggle
  if (elements.dubToggle) {
    elements.dubToggle.addEventListener('click', () => {
      state.isDub = !state.isDub;
      elements.dubToggle.classList.toggle('active', state.isDub);
      elements.dubLabel.textContent = state.isDub ? 'DUB' : 'SUB';
    });
  }

  // Auto-hide toolbar when video is playing
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
    if (state.currentVideo && !elements.videoPlayer.paused) {
      hideToolbarTimeout = setTimeout(startAutoHide, 3000);
    }
  });

  // Search
  if (elements.searchBtn) elements.searchBtn.addEventListener('click', searchAnime);
  if (elements.searchInput) {
    elements.searchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') searchAnime();
    });
  }

  // Quick links
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

  // Back button
  if (elements.backToResults) {
    elements.backToResults.addEventListener('click', () => {
      elements.animeDetails.classList.add('hidden');
      elements.animeResults.classList.remove('hidden');
    });
  }

  // Video controls
  if (elements.playPauseBtn) elements.playPauseBtn.addEventListener('click', togglePlayPause);
  if (elements.progressBar) elements.progressBar.addEventListener('click', handleSeek);

  // Volume controls
  if (elements.volumeSlider) {
    elements.volumeSlider.addEventListener('input', (e) => {
      const volume = parseFloat(e.target.value);
      elements.videoPlayer.volume = volume;
      updateVolumeIcon(volume);
    });
  }
  if (elements.muteBtn) {
    elements.muteBtn.addEventListener('click', () => {
      elements.videoPlayer.muted = !elements.videoPlayer.muted;
      updateVolumeIcon(elements.videoPlayer.muted ? 0 : elements.videoPlayer.volume);
    });
  }

  // Subtitle Toggle (embedded subtitles only)
  if (elements.subtitleToggleBtn) {
    elements.subtitleToggleBtn.addEventListener('click', toggleSubtitles);
  }

  // Video events
  if (elements.videoPlayer) {
    elements.videoPlayer.addEventListener('timeupdate', updateProgress);
    elements.videoPlayer.addEventListener('loadedmetadata', () => {
      updateTimeDisplay();
    });
    elements.videoPlayer.addEventListener('play', () => updateDiscordActivityState(true));
    elements.videoPlayer.addEventListener('pause', () => updateDiscordActivityState(false));
    
    // Double-click to toggle fullscreen
    elements.videoPlayer.addEventListener('dblclick', (e) => {
      e.preventDefault();
      toggleFullscreen();
    });
    
    // Click to play/pause (only for host)
    elements.videoPlayer.addEventListener('click', (e) => {
      // Avoid triggering on double-click
      if (e.detail === 1) {
        setTimeout(() => {
          if (state.isHost) togglePlayPause();
        }, 200);
      }
    });
  }

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // Don't trigger when typing in input fields
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
      case 'Escape':
        // Only handle CSS-only fullscreen mode
        // Native fullscreen handles its own Escape key exit
        const isNativeFullscreen = document.fullscreenElement || 
                                   document.webkitFullscreenElement || 
                                   document.mozFullScreenElement || 
                                   document.msFullscreenElement;
        if (document.body.classList.contains('fullscreen-mode') && !isNativeFullscreen) {
          toggleFullscreen();
        }
        break;
      case 'l':
      case 'L':
        // Toggle library sidebar
        if (state.isHost && elements.sidebar) {
          e.preventDefault();
          elements.sidebar.classList.toggle('hidden');
          if (elements.sidebarToggle) elements.sidebarToggle.classList.toggle('active');
        }
        break;
      case 'c':
      case 'C':
        // Toggle caption menu
        e.preventDefault();
        if (elements.captionMenu) {
          elements.captionMenu.classList.toggle('hidden');
        }
        break;
      case 'm':
        // Mute toggle
        e.preventDefault();
        if (elements.videoPlayer) {
          elements.videoPlayer.muted = !elements.videoPlayer.muted;
          updateVolumeIcon(elements.videoPlayer.muted ? 0 : elements.videoPlayer.volume);
        }
        break;
      case 'ArrowUp':
        // Volume up
        e.preventDefault();
        if (elements.videoPlayer) {
          const newVol = Math.min(1, elements.videoPlayer.volume + 0.1);
          elements.videoPlayer.volume = newVol;
          if (elements.volumeSlider) elements.volumeSlider.value = newVol;
          updateVolumeIcon(newVol);
        }
        break;
      case 'ArrowDown':
        // Volume down
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

  // Default controls state
  if (elements.playPauseBtn) updatePlayPauseIcon(false);

  // Host sync - includes episodeId to prevent desync with different anime
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

  // Caption button event
  if (elements.captionBtn) {
    elements.captionBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      elements.captionMenu.classList.toggle('hidden');
    });
  }

  // Close caption menu when clicking elsewhere
  document.addEventListener('click', (e) => {
    if (elements.captionMenu && !elements.captionMenu.contains(e.target) && e.target !== elements.captionBtn) {
      elements.captionMenu.classList.add('hidden');
    }
  });

  // Chat
  if (elements.chatSend) elements.chatSend.addEventListener('click', sendChatMessage);
  if (elements.chatInput) {
    elements.chatInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') sendChatMessage();
    });
  }
}

// Handle Resize & PIP Mode
function handleResize() {
  const width = window.innerWidth;
  const height = window.innerHeight;

  // Define PIP threshold
  const isPip = width < 600 || height < 400;

  if (isPip) {
    document.body.classList.add('pip-mode');
    // In PIP, sidebar is always hidden
    if (elements.sidebar) elements.sidebar.classList.add('hidden');
  } else {
    document.body.classList.remove('pip-mode');
    // Restore sidebar visibility based on host state when exiting PIP
    if (state.isHost && state.user && elements.sidebar) {
      elements.sidebar.classList.remove('hidden');
    }
  }

  // Update UI logic
  if (state.user) updateRoleUI();
}

// Helper: Update Discord Activity
async function updateDiscordActivity(details, stateText, smallText) {
  try {
    await discordSdk.commands.setActivity({
      activity: {
        details: details,
        state: stateText || 'Browsing',
        assets: {
          large_image: 'app_icon',
          large_text: 'AnimeTogether',
          small_image: 'play_icon',
          small_text: smallText || (state.isHost ? 'Host' : 'Viewer'),
        },
        timestamps: state.currentVideo && !elements.videoPlayer.paused ? {
          start: Date.now() - (elements.videoPlayer.currentTime * 1000),
        } : undefined,
      }
    });
  } catch (e) {
    // console.log('Rich Presence update failed (likely dev env):', e);
  }
}

function updateDiscordActivityState(isPlaying) {
  if (!state.currentVideo) return;
  updateDiscordActivity(
    `Watching ${state.currentVideo.title}`,
    `Episode ${state.currentVideo.episode}`,
    isPlaying ? 'Playing' : 'Paused'
  );
}

function updatePresenceState(isPlaying) {
  updateDiscordActivityState(isPlaying);
}

// Search anime
async function searchAnime() {
  const query = elements.searchInput.value.trim();
  if (!query) return;

  elements.animeResults.innerHTML = '<div class="spinner"></div>';
  showSearchResults();

  try {
    const response = await fetch(`/api/anime/search?query=${encodeURIComponent(query)}&provider=${state.provider}`);
    const data = await response.json();
    displayAnimeResults(data.results || []);
  } catch (error) {
    console.error('Search error:', error);
    elements.animeResults.innerHTML = '<p class="placeholder-text">Failed to search. Try again.</p>';
  }
}

// Load recent episodes
async function loadRecentEpisodes() {
  elements.animeResults.innerHTML = '<div class="spinner"></div>';
  showSearchResults();

  try {
    const response = await fetch(`/api/anime/recent?provider=${state.provider}`);
    const data = await response.json();
    displayAnimeResults(data.results || []);
  } catch (error) {
    console.error('Recent episodes error:', error);
    elements.animeResults.innerHTML = '<p class="placeholder-text">Failed to load. Try again.</p>';
  }
}

// Load top airing
async function loadTopAiring() {
  elements.animeResults.innerHTML = '<div class="spinner"></div>';
  showSearchResults();

  try {
    const response = await fetch(`/api/anime/top-airing?provider=${state.provider}`);
    const data = await response.json();
    displayAnimeResults(data.results || []);
  } catch (error) {
    console.error('Top airing error:', error);
    elements.animeResults.innerHTML = '<p class="placeholder-text">Failed to load. Try again.</p>';
  }
}

// Display anime results
function displayAnimeResults(results) {
  if (results.length === 0) {
    elements.animeResults.innerHTML = '<p class="placeholder-text">No results found</p>';
    return;
  }

  elements.animeResults.innerHTML = '';

  results.forEach(anime => {
    const card = document.createElement('div');
    card.className = 'anime-card';
    card.dataset.id = anime.id;

    const img = document.createElement('img');
    img.src = proxyImage(anime.image);
    img.alt = anime.title;
    img.onerror = () => { img.src = placeholderImage; img.onerror = null; };

    const info = document.createElement('div');
    info.className = 'anime-card-info';

    const title = document.createElement('div');
    title.className = 'anime-card-title';
    title.textContent = anime.title;

    const meta = document.createElement('div');
    meta.className = 'anime-card-meta';
    meta.textContent = `${anime.subOrDub || ''} ${anime.releaseDate ? `• ${anime.releaseDate}` : ''}`.trim();

    info.appendChild(title);
    info.appendChild(meta);
    card.appendChild(img);
    card.appendChild(info);

    card.addEventListener('click', () => loadAnimeDetails(anime.id));
    elements.animeResults.appendChild(card);
  });
}

function showSearchResults() {
  elements.animeDetails.classList.add('hidden');
  elements.animeResults.classList.remove('hidden');
}

// Load anime details
async function loadAnimeDetails(animeId) {
  elements.animeResults.classList.add('hidden');
  elements.animeDetails.classList.remove('hidden');
  elements.animeInfo.innerHTML = '<div class="spinner"></div>';
  elements.episodeList.innerHTML = '';

  try {
    const response = await fetch(`/api/anime/info/${encodeURIComponent(animeId)}?provider=${state.provider}`);
    const anime = await response.json();
    const coverImage = proxyImage(anime.image);

    // Render anime info safely (avoid HTML injection from API content)
    const detailHeader = document.createElement('div');
    detailHeader.className = 'anime-detail-header';

    const cover = document.createElement('img');
    cover.src = coverImage;
    cover.alt = anime.title || 'Anime cover';

    const infoWrapper = document.createElement('div');
    infoWrapper.className = 'anime-detail-info';

    const titleEl = document.createElement('h3');
    titleEl.textContent = anime.title || 'Unknown title';

    const descEl = document.createElement('p');
    const safeDescription = anime.description ? anime.description.toString() : '';
    descEl.textContent = safeDescription.length > 200
      ? `${safeDescription.substring(0, 200)}...`
      : (safeDescription || 'No description available');

    infoWrapper.appendChild(titleEl);
    infoWrapper.appendChild(descEl);
    detailHeader.appendChild(cover);
    detailHeader.appendChild(infoWrapper);

    elements.animeInfo.innerHTML = '';
    elements.animeInfo.appendChild(detailHeader);

    if (anime.episodes && anime.episodes.length > 0) {
      elements.episodeList.innerHTML = '';

      anime.episodes.forEach(ep => {
        const item = document.createElement('div');
        item.className = 'episode-item';
        item.dataset.id = ep.id || '';
        item.dataset.title = anime.title || '';
        item.dataset.episode = ep.number || '';
        item.dataset.thumbnail = coverImage || '';

        const number = document.createElement('span');
        number.textContent = ep.number ?? '';
        item.appendChild(number);

        item.addEventListener('click', () => playEpisode(
          ep.id,
          anime.title || 'Unknown',
          ep.number,
          coverImage
        ));

        elements.episodeList.appendChild(item);
      });
    } else {
      elements.episodeList.innerHTML = '<p class="placeholder-text">No episodes available</p>';
    }
  } catch (error) {
    console.error('Anime details error:', error);
    elements.animeInfo.innerHTML = '<p class="placeholder-text">Failed to load details. Try again.</p>';
  }
}

// Play episode - tries multiple servers if one fails
async function playEpisode(episodeId, title, episode, thumbnail) {
  if (!state.isHost) return;

  // Show loading state
  elements.nowPlaying.textContent = 'Loading...';
  elements.emptyState.classList.add('hidden');
  elements.videoWrapper.classList.remove('hidden');
  elements.videoLoadingOverlay.classList.remove('hidden');
  elements.videoLoadingSpinner.style.display = 'flex';
  elements.videoLoadingText.textContent = 'Loading episode...';

  try {
    // Add dub parameter to API call
    const dubParam = state.isDub ? '&dub=true' : '';
    const hianimeParam = featureFlags.isEnabled('hianime') ? '&hianime=true' : '';
    const response = await fetch(`/api/anime/watch/${encodeURIComponent(episodeId)}?provider=${state.provider}${dubParam}${hianimeParam}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch episode sources (Status: ${response.status})`);
    }
    const data = await response.json();

    if (data.sources && data.sources.length > 0) {
      // Store all sources for fallback
      const allSources = data.sources;
      
      // Try to find a working source
      let workingSource = null;
      let workingUrl = null;
      
      // Prioritize sources by quality
      const priorityOrder = ['default', 'auto', '1080p', '720p', '480p', '360p'];
      const sortedSources = [...allSources].sort((a, b) => {
        const aIndex = priorityOrder.indexOf(a.quality) !== -1 ? priorityOrder.indexOf(a.quality) : 99;
        const bIndex = priorityOrder.indexOf(b.quality) !== -1 ? priorityOrder.indexOf(b.quality) : 99;
        return aIndex - bIndex;
      });

      // Try each source until one works
      for (const source of sortedSources) {
        const proxyUrl = `/proxy/hls?url=${encodeURIComponent(source.url)}`;
        try {
          // Quick test fetch to see if URL is valid
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

      // If no working source found via HEAD, just use first one and let HLS handle errors
      if (!workingUrl) {
        workingSource = sortedSources[0];
        workingUrl = `/proxy/hls?url=${encodeURIComponent(workingSource.url)}`;
      }

      // Store all available subtitles
      const allSubtitles = data.subtitles || [];

      const videoData = {
        url: workingUrl,
        title: title,
        episode: episode,
        thumbnail: thumbnail,
        subtitle: null,
        subtitles: allSubtitles, // Store all available subtitles
        isDub: state.isDub,
        // Store metadata for re-fetching streams for late joiners
        episodeId: episodeId,
        provider: state.provider,
        sources: allSources, // Store all sources for potential fallback
      };

      // Set default subtitle (English or first available)
      if (!state.isDub && allSubtitles.length > 0) {
        const engSub = allSubtitles.find(s => s.lang === 'English') || allSubtitles[0];
        if (engSub) {
          videoData.subtitle = `/proxy/subtitle?url=${encodeURIComponent(engSub.url)}`;
        }
      }

      sendWsMessage({
        type: 'load-video',
        video: videoData,
      });

      loadVideo(videoData, { playing: false, currentTime: 0 });
      elements.videoLoadingOverlay.classList.add('hidden');
      
      // Populate caption menu
      populateCaptionMenu(allSubtitles);
      
      if (videoData.subtitle) {
        loadSubtitle(videoData.subtitle);
        state.captionsEnabled = true;
        updateCaptionButtonState(true);
      }

    } else {
      // Show error prominently
      elements.videoLoadingSpinner.style.display = 'none';
      elements.videoLoadingText.textContent = 'No sources available';
      showStreamError('No video sources found for this episode. Try a different episode or provider.');
      addChatMessage({ system: true, content: 'No video sources found for this episode' });
      
      // Keep overlay visible longer so user can see the error
      setTimeout(() => elements.videoLoadingOverlay.classList.add('hidden'), 3000);
    }
  } catch (error) {
    console.error('Play episode error:', error);
    // Show error prominently and keep overlay visible
    elements.videoLoadingSpinner.style.display = 'none';
    elements.videoLoadingText.textContent = 'Error loading stream';
    showStreamError(`Stream error: ${error.message}`);
    addChatMessage({ system: true, content: `Failed to load episode: ${error.message}` });
    
    // Keep overlay visible longer
    setTimeout(() => elements.videoLoadingOverlay.classList.add('hidden'), 3000);
  }
}

// Populate the caption/subtitle menu with available options
function populateCaptionMenu(subtitles) {
  console.log('Populating caption menu with', subtitles?.length || 0, 'subtitles');
  
  if (!elements.captionOptions) {
    console.error('Caption options element not found');
    return;
  }
  
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
      if (sub.url) btn.dataset.url = sub.url;
      btn.textContent = lang;
      if (isDefault) {
        offBtn.classList.remove('active');
        btn.classList.add('active');
      }
      elements.captionOptions.appendChild(btn);
      buttons.push(btn);
    });
  }
  
  // Add click handlers
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      console.log('Caption selected:', btn.dataset.lang, btn.dataset.url);
      
      // Remove active from all
      buttons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      if (btn.dataset.lang === 'off') {
        disableSubtitles();
      } else if (btn.dataset.url) {
        const proxyUrl = `/proxy/subtitle?url=${encodeURIComponent(btn.dataset.url)}`;
        loadSubtitle(proxyUrl);
        state.captionsEnabled = true;
        updateCaptionButtonState(true);
      }
      
      elements.captionMenu.classList.add('hidden');
    });
  });
}

function disableSubtitles() {
  const video = elements.videoPlayer;
  if (!video) return;
  
  // Disable all text tracks
  for (let i = 0; i < video.textTracks.length; i++) {
    video.textTracks[i].mode = 'disabled';
  }
  
  state.captionsEnabled = false;
  updateCaptionButtonState(false);
}

function updateCaptionButtonState(enabled) {
  if (elements.captionBtn) {
    elements.captionBtn.classList.toggle('active', enabled);
  }
}

// Load video into player
function loadVideo(video, playbackState) {
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
  updateTimeDisplay();

  if (state.hls) {
    state.hls.destroy();
    state.hls = null;
  }

  // Clear any existing subtitle tracks
  const oldTracks = elements.videoPlayer.querySelectorAll('track');
  oldTracks.forEach(t => t.remove());

  const videoElement = elements.videoPlayer;

  // Basic crossOrigin support is handled in HTML, but good to reinforce if created dynamically in future

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

  addChatMessage({ system: true, content: `Now playing: ${title} - Episode ${episode}` });
  updateDiscordActivity(`Watching ${title}`, `Episode ${episode}`);
}

function loadSubtitle(url) {
  const video = elements.videoPlayer;
  if (!video) {
    console.error('No video element for subtitles');
    return;
  }

  console.log('Loading subtitle from:', url);

  // Remove existing tracks
  const oldTracks = video.querySelectorAll('track');
  oldTracks.forEach(t => t.remove());

  const track = document.createElement('track');
  track.kind = 'captions';
  track.label = 'English';
  track.srclang = 'en';
  track.default = true;
  track.src = url;

  // Add track to video
  video.appendChild(track);

  // Function to enable subtitles
  const enableSubtitles = () => {
    try {
      if (video.textTracks && video.textTracks.length > 0) {
        for (let i = 0; i < video.textTracks.length; i++) {
          video.textTracks[i].mode = 'showing';
        }
        console.log('Subtitles enabled, tracks:', video.textTracks.length);
      }
    } catch (e) {
      console.warn('Could not enable subtitles:', e);
    }
  };

  // Enable on track load
  track.addEventListener('load', () => {
    console.log('Track loaded');
    enableSubtitles();
  });
  
  track.addEventListener('error', (e) => {
    console.error('Track load error:', e);
  });

  // Also try enabling after delays (some browsers need this)
  setTimeout(enableSubtitles, 200);
  setTimeout(enableSubtitles, 1000);
  setTimeout(enableSubtitles, 2000);

  state.captionsEnabled = true;
  updateCaptionButtonState(true);
  addChatMessage({ system: true, content: 'Subtitles loaded' });
}

function handleSync(message) {
  if (state.isHost) return;

  const video = elements.videoPlayer;
  if (!video || !state.currentVideo) return;
  
  // Verify we're watching the same episode to prevent desync
  if (message.episodeId && state.currentVideo.episodeId && message.episodeId !== state.currentVideo.episodeId) {
    console.warn('Sync episodeId mismatch - ignoring sync for different episode');
    return;
  }
  
  // Ensure video has valid duration
  if (!video.duration || !isFinite(video.duration)) return;
  
  const timeDiff = Math.abs(video.currentTime - message.currentTime);

  // Only resync if difference is more than 2 seconds
  if (timeDiff > 2) {
    showSyncIndicator();
    video.currentTime = message.currentTime;
  }

  // Sync play state
  if (message.playing && video.paused) {
    video.play().catch(() => {});
    updatePlayPauseIcon(true);
    updatePresenceState(true);
  } else if (!message.playing && !video.paused) {
    video.pause();
    updatePlayPauseIcon(false);
    updatePresenceState(false);
  }
}

function togglePlayPause() {
  if (!state.isHost) return;
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

function updatePlayPauseIcon(playing) {
  // SVG Icons - professional monochrome style
  const playIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>';
  const pauseIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>';
  elements.playPauseBtn.innerHTML = playing ? pauseIcon : playIcon;
}

function updateVolumeIcon(volume) {
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

function handleSeek(e) {
  if (!state.isHost) return;
  if (!elements.videoPlayer.duration || !isFinite(elements.videoPlayer.duration)) return;
  const rect = elements.progressBar.getBoundingClientRect();
  const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  const time = percent * elements.videoPlayer.duration;
  elements.videoPlayer.currentTime = time;
  sendWsMessage({ type: 'seek', currentTime: time });
}

function updateProgress() {
  const video = elements.videoPlayer;
  if (!video.duration || !isFinite(video.duration)) {
    elements.progressFill.style.width = '0%';
    if (elements.progressBuffer) elements.progressBuffer.style.width = '0%';
    updateTimeDisplay();
    return;
  }
  
  // Update progress fill
  const percent = (video.currentTime / video.duration) * 100;
  elements.progressFill.style.width = `${percent}%`;
  
  // Update buffer progress
  if (elements.progressBuffer && video.buffered.length > 0) {
    const bufferedEnd = video.buffered.end(video.buffered.length - 1);
    const bufferPercent = (bufferedEnd / video.duration) * 100;
    elements.progressBuffer.style.width = `${bufferPercent}%`;
  }
  
  updateTimeDisplay();
}

function updateTimeDisplay() {
  const video = elements.videoPlayer;
  const current = formatTime(video.currentTime);
  const duration = formatTime(video.duration);
  elements.timeDisplay.textContent = `${current} / ${duration}`;
}

function formatTime(seconds) {
  if (!isFinite(seconds) || isNaN(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function toggleFullscreen() {
  const isCurrentlyFullscreen = document.body.classList.contains('fullscreen-mode');
  
  // Check native fullscreen state
  const fsElement = document.fullscreenElement || 
                    document.webkitFullscreenElement || 
                    document.mozFullScreenElement || 
                    document.msFullscreenElement;
  
  if (!isCurrentlyFullscreen && !fsElement) {
    // Enter fullscreen
    const elem = document.documentElement;
    const requestFS = elem.requestFullscreen || 
                      elem.webkitRequestFullscreen || 
                      elem.mozRequestFullScreen || 
                      elem.msRequestFullscreen;
    
    // Apply CSS fullscreen immediately for responsiveness
    document.body.classList.add('fullscreen-mode');
    updateFullscreenUI(true);
    
    if (requestFS) {
      requestFS.call(elem).catch(() => {
        // Native fullscreen blocked, CSS fullscreen is already active
        console.log('Using CSS fullscreen mode');
      });
    }
  } else {
    // Exit fullscreen
    document.body.classList.remove('fullscreen-mode');
    updateFullscreenUI(false);
    
    // Exit native fullscreen if active
    if (fsElement) {
      const exitFS = document.exitFullscreen || 
                     document.webkitExitFullscreen || 
                     document.mozCancelFullScreen || 
                     document.msExitFullscreen;
      if (exitFS) {
        exitFS.call(document).catch(() => {});
      }
    }
  }
}

function updateFullscreenUI(isFullscreen) {
  if (elements.fullscreenToggle) {
    elements.fullscreenToggle.textContent = isFullscreen ? '✕' : '⛶';
    elements.fullscreenToggle.title = isFullscreen ? 'Exit Fullscreen (F or Esc)' : 'Fullscreen (F)';
    elements.fullscreenToggle.classList.toggle('active', isFullscreen);
  }
}

// Listen for fullscreen change events (for native fullscreen)
document.addEventListener('fullscreenchange', handleFullscreenChange);
document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
document.addEventListener('mozfullscreenchange', handleFullscreenChange);
document.addEventListener('MSFullscreenChange', handleFullscreenChange);

function handleFullscreenChange() {
  const fsElement = document.fullscreenElement || 
                    document.webkitFullscreenElement || 
                    document.mozFullScreenElement || 
                    document.msFullscreenElement;
  
  // Sync CSS class with native fullscreen state
  if (!fsElement && document.body.classList.contains('fullscreen-mode')) {
    // User exited via browser controls (Esc key handled natively)
    document.body.classList.remove('fullscreen-mode');
    updateFullscreenUI(false);
  } else if (fsElement && !document.body.classList.contains('fullscreen-mode')) {
    // Entered fullscreen via other means
    document.body.classList.add('fullscreen-mode');
    updateFullscreenUI(true);
  }
}

function addChatMessage(message) {
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

function sendChatMessage() {
  const content = elements.chatInput.value.trim();
  if (!content) return;
  sendWsMessage({
    type: 'chat',
    username: state.user.username,
    content: content,
  });
  elements.chatInput.value = '';
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Start the app
init();
