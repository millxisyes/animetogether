import { elements, addChatMessage } from './ui.js';
import { discordSdk } from './auth.js';

// Persist token in localStorage
const TOKEN_KEY = 'anilist_token';
// Persist user profile
const USER_KEY = 'anilist_user';

export let anilistUser = null;

export function initAniList() {
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) {
        fetchUserProfile(token);
    } else {
        updateAniListUI();
    }
}

export function loginToAniList() {
    // 1. Open External Link
    // We must use the full proxy URL because openExternalLink opens in system browser
    const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
    const host = window.location.host; // e.g. 123456.discordsays.com or localhost
    const loginUrl = `${protocol}//${host}/api/anilist/login`;

    if (discordSdk && discordSdk.commands) {
        discordSdk.commands.openExternalLink({ url: loginUrl });
    } else {
        // Fallback for dev mode
        window.open(loginUrl, '_blank');
    }

    // 2. Show UI for pasting code
    const stepUI = document.getElementById('anilist-auth-step');
    if (stepUI) stepUI.classList.remove('hidden');
}

export function logoutAniList() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    anilistUser = null;
    updateAniListUI();
    addChatMessage({ system: true, content: 'Disconnected from AniList.' });
}

async function fetchUserProfile(token) {
    const query = `
    query {
        Viewer {
            id
            name
            avatar {
                large
            }
        }
    }
    `;

    try {
        const response = await fetch('/api/anilist/graphql', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
            body: JSON.stringify({ query })
        });

        const data = await response.json();
        if (data.data && data.data.Viewer) {
            anilistUser = data.data.Viewer;
            localStorage.setItem(USER_KEY, JSON.stringify(anilistUser));
            localStorage.setItem(TOKEN_KEY, token); // Persist token!
            updateAniListUI();
            console.log('AniList User:', anilistUser.name);
            addChatMessage({ system: true, content: `Connected to AniList as ${anilistUser.name}` });
            return true;
        } else {
            // Check for specific auth errors
            if (response.status === 401 || (data.errors && data.errors.some(e => e.message === 'Invalid token' || e.status === 401))) {
                console.error('Invalid AniList token, logging out.');
                logoutAniList();
            } else {
                console.error('Failed to fetch AniList profile (Network/API Error):', data);
                // Do NOT logout, just fail silently or show error state
            }
            return false;
        }
    } catch (e) {
        console.error('AniList profile fetch error:', e);
        // Do NOT logout on network error
        return false;
    }
}

function updateAniListUI() {
    const settingsBtn = document.getElementById('anilist-login-btn');
    const logoutBtn = document.getElementById('anilist-logout-btn');
    const statusText = document.getElementById('anilist-status');
    const stepUI = document.getElementById('anilist-auth-step');
    const verifyBtn = document.getElementById('anilist-verify-btn');

    if (!settingsBtn || !statusText) return;


    // Verify Button Listener (One time bind check needed? Or just rebind)
    // To avoid multiple listeners, we can check a flag or replace element.
    if (verifyBtn && !verifyBtn.hasAttribute('data-bound')) {
        verifyBtn.setAttribute('data-bound', 'true');
        verifyBtn.addEventListener('click', async () => {
            const input = document.getElementById('anilist-token-input');
            if (input && input.value) {
                const token = input.value.trim();

                // Show Loading
                const originalText = verifyBtn.textContent;
                verifyBtn.textContent = 'Verifying...';
                verifyBtn.disabled = true;

                const success = await fetchUserProfile(token);

                verifyBtn.disabled = false;

                if (success) {
                    input.value = '';
                    // updateAniListUI calls via fetchUserProfile success
                } else {
                    verifyBtn.textContent = 'Failed';
                    setTimeout(() => verifyBtn.textContent = originalText, 2000);
                    alert('Invalid Token. Please try again.');
                }
            }
        });
    }


    if (anilistUser) {
        if (settingsBtn) settingsBtn.classList.add('hidden');
        if (logoutBtn) {
            logoutBtn.classList.remove('hidden');
            logoutBtn.onclick = logoutAniList;
        }
        if (stepUI) stepUI.classList.add('hidden'); // Hide input on success
        if (statusText) {
            statusText.innerHTML = `Signed in as <span class="highlight">${anilistUser.name}</span>`;
            statusText.classList.remove('hidden');
        }
    } else {
        if (settingsBtn) {
            settingsBtn.textContent = 'Get Login Code';
            settingsBtn.classList.remove('hidden');
            settingsBtn.onclick = () => {
                console.log('Connect Button Clicked via replacement handler');
                loginToAniList();
            };
        }
        if (logoutBtn) logoutBtn.classList.add('hidden');
        if (statusText) {
            statusText.textContent = '';
            statusText.classList.add('hidden');
        }
    }
}

// Scrobble (Update Progress)
export async function updateAniListProgress(animeTitle, episodeNumber) {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token || !anilistUser) return;

    console.log(`Scrobbling to AniList: ${animeTitle} Ep ${episodeNumber}`);

    // 1. Search for the anime ID first (using title)
    // Consumet might give us an accurate title, but AniList fuzzy search is good.
    const searchQuery = `
    query ($search: String) {
        Media (search: $search, type: ANIME) {
            id
            title {
                romaji
                english
            }
        }
    }
    `;

    try {
        const searchRes = await fetch('/api/anilist/graphql', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
            body: JSON.stringify({
                query: searchQuery,
                variables: { search: animeTitle }
            })
        });
        const searchData = await searchRes.json();
        const media = searchData.data?.Media;

        if (!media) {
            console.warn('AniList: Anime not found for scrobbling');
            return;
        }

        // 2. Update List Entry
        const mutation = `
        mutation ($mediaId: Int, $progress: Int) {
            SaveMediaListEntry (mediaId: $mediaId, progress: $progress) {
                id
                status
                progress
            }
        }
        `;

        const updateRes = await fetch('/api/anilist/graphql', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
            body: JSON.stringify({
                query: mutation,
                variables: {
                    mediaId: media.id,
                    progress: episodeNumber
                }
            })
        });

        const updateData = await updateRes.json();
        if (updateData.data?.SaveMediaListEntry) {
            console.log('AniList updated successfully:', updateData.data.SaveMediaListEntry);
            addChatMessage({ system: true, content: `AniList updated: ${media.title.english || media.title.romaji} (Ep ${episodeNumber})` });
        } else {
            console.error('AniList update failed:', updateData);
        }

    } catch (e) {
        console.error('AniList scrobble error:', e);
    }
}

// Fetch mean score (public, no token needed usually, but we have one so we use it if available)
export async function fetchAniListScore(animeTitle) {
    const searchQuery = `
    query ($search: String) {
        Media (search: $search, type: ANIME) {
            meanScore
            averageScore
        }
    }
    `;

    try {
        // Use token if available, otherwise just public query (AniList API is public for queries)
        // But our proxy expects authorization header usually? 
        // Actually the backend proxy *requires* a token. 
        // If the user isn't logged in, we can't use the proxy easily unless we make it open.
        // Or we can use direct fetch to graphql.anilist.co if not logged in (might fail due to Discord CSP?).
        // Let's try proxy with the saved token. If no token, maybe we can't show score?
        // OR we can make the proxy optional for token.
        // For now, let's assume if they are logged in.
        // Wait, user wants score to "match UI properly", implies it should always be there.
        // If user isn't logged in, they still want to see the score.
        // I should update the backend proxy to allow requests without token for queries? 
        // Or just use direct fetch if possible. 
        // Let's try direct fetch first if no token, else proxy.
        // Actually, if I can't reach AniList from client without proxy, I need proxy.

        const token = localStorage.getItem(TOKEN_KEY);
        let url = 'https://graphql.anilist.co';
        let headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        };

        if (token) {
            url = '/api/anilist/graphql';
            headers['Authorization'] = `Bearer ${token}`;
        } else {
            // If no token, we can't use the proxy as currently implemented blocks 401.
            // But direct fetch might be blocked by Discord.
            // Ideally we update proxy to be open for queries.
            // Let's try using the proxy even without token, but I need to update backend.
            // For now, let's just try direct fetch if no token.
        }

        const response = await fetch(url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
                query: searchQuery,
                variables: { search: animeTitle }
            })
        });

        const data = await response.json();
        const media = data.data?.Media;
        if (media) {
            return media.meanScore || media.averageScore;
        }
        return null;
    } catch (e) {
        console.error('Failed to fetch AniList score:', e);
        return null;
    }
}
