import { DiscordSDK } from '@discord/embedded-app-sdk';
import { state } from './state.js';
import { showMainScreen, setupEventListeners, showStreamError, handleResize } from './ui.js';
import { elements } from './dom.js';
import { connectWebSocket } from './socket.js';
import { loadTopAiring } from './catalog.js';
import { checkFeatureFlagCustomId } from './flags.js';

// Resolve Discord Client ID from window or build-time injected constant
const DISCORD_CLIENT_ID =
    (typeof window !== 'undefined' && window.DISCORD_CLIENT_ID) ||
    __DISCORD_CLIENT_ID__ ||
    '';

// Initialize Discord SDK
export const discordSdk = new DiscordSDK(DISCORD_CLIENT_ID);

export async function init() {
    try {
        // Wait for Discord SDK to be ready
        await discordSdk.ready();
        console.log('Discord SDK ready');

        // Check for feature flag via customId
        checkFeatureFlagCustomId(discordSdk);

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

        if (!tokenResponse.ok) {
            const errorText = await tokenResponse.text();
            console.error('Token exchange failed:', errorText);
            throw new Error(`Token exchange failed: ${tokenResponse.status}. Check server logs.`);
        }

        const { access_token } = await tokenResponse.json();

        // Authenticate with Discord
        const auth = await discordSdk.commands.authenticate({ access_token });
        state.user = auth.user;
        state.channelId = discordSdk.channelId;

        console.log('Authenticated:', state.user.username);

        connectWebSocket();
        showMainScreen();
        // Setup event listeners after main screen is shown logic?
        // In original app.js, setupEventListeners was called before loadTopAiring
        setupEventListeners();
        loadTopAiring();

        // Initial Activity
        updateDiscordActivity('Browsing Anime');

        // Fix sizing on init
        handleResize();

    } catch (error) {
        console.error('Initialization error:', error);
        if (elements.loadingScreen) {
            const p = elements.loadingScreen.querySelector('p');
            if (p) p.textContent = 'Failed to connect. Please try again.';
        }
    }
}

export async function updateDiscordActivity(details, stateText, smallText) {
    try {
        const activity = {
            details: details,
            state: stateText || 'Browsing',
            assets: {
                large_image: 'app_icon',
                large_text: 'AnimeTogether',
                small_image: 'play_icon',
                small_text: smallText || (state.isHost ? 'Host' : 'Viewer'),
            },
        };

        if (state.currentVideo && elements.videoPlayer && !elements.videoPlayer.paused) {
            activity.timestamps = {
                start: Date.now() - (elements.videoPlayer.currentTime * 1000),
            };
        }

        await discordSdk.commands.setActivity({ activity });
    } catch (e) {
        // console.log('Rich Presence update failed (likely dev env):', e);
    }
}
