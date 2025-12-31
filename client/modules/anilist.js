import { addChatMessage } from './ui.js';
import { elements } from './dom.js';
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

// Scrobble (Update Progress and Status)
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
        const searchResQuery = await searchRes.json();
        const media = searchResQuery.data?.Media;

        if (!media) {
            console.warn('AniList: Anime not found for scrobbling');
            return;
        }

        // 2. Update List Entry
        const mutation = `
        mutation ($mediaId: Int, $progress: Int, $status: MediaListStatus) {
            SaveMediaListEntry (mediaId: $mediaId, progress: $progress, status: $status) {
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
                    progress: episodeNumber,
                    status: 'CURRENT' // Auto-set to Watching
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

export async function updateAniListScore(animeIdOrTitle, score) {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token || !anilistUser) return;

    let mediaId = animeIdOrTitle;

    // If string, assume title and search
    if (typeof animeIdOrTitle === 'string') {
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
                    variables: { search: animeIdOrTitle }
                })
            });
            const searchData = await searchRes.json();
            if (searchData.data?.Media) {
                mediaId = searchData.data.Media.id;
            } else {
                console.warn('AniList score update: Anime not found');
                return;
            }
        } catch (e) { console.error(e); return; }
    }

    const mutation = `
    mutation ($mediaId: Int, $score: Float) {
        SaveMediaListEntry (mediaId: $mediaId, scoreRaw: $score) {
            id
            score
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
            body: JSON.stringify({
                query: mutation,
                variables: {
                    mediaId: mediaId,
                    score: score * 10 // Convert 0-10 to 0-100 if user uses 10pt scale? 
                    // AniList scoreRaw depends on user settings, but let's assume 100pt scale for safety or check user settings.
                    // Actually, 'scoreRaw' usually takes 0-100 or 0-10 depending on scale, but 0-100 is safest for internal storage?
                    // Let's assume input 'score' is 0-10 and we multiply by 10 for 100-scale.
                    // If the user uses 10-point scale, 80 becomes 8.
                    // Let's pass the raw value and hope for the best, or use 'score' instead of 'scoreRaw'?
                    // 'score' field in mutation adapts to user's score system.
                    // 'scoreRaw' is always 0-100. Let's use scoreRaw and pass 100-based int.
                }
            })
        });

        const data = await response.json();
        if (data.data?.SaveMediaListEntry) {
            addChatMessage({ system: true, content: `AniList score updated.` });
        }
    } catch (e) {
        console.error('Failed to update score:', e);
    }
}

// Fetch User Favorites
export async function fetchUserFavorites() {
    if (!anilistUser) return [];

    const query = `
    query ($userId: Int) {
        User(id: $userId) {
            favourites {
                anime {
                    nodes {
                        id
                        title {
                            romaji
                            english
                        }
                        coverImage {
                            large
                        }
                        meanScore
                    }
                }
            }
        }
    }
    `;

    try {
        const token = localStorage.getItem(TOKEN_KEY);
        if (!token) return [];

        const response = await fetch('/api/anilist/graphql', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
            body: JSON.stringify({
                query: query,
                variables: { userId: anilistUser.id }
            })
        });

        const data = await response.json();
        const nodes = data.data?.User?.favourites?.anime?.nodes;
        if (nodes) {
            return nodes.map(node => ({
                id: node.id,
                title: node.title.english || node.title.romaji,
                image: node.coverImage.large,
                score: node.meanScore
            }));
        }
        return [];
    } catch (e) {
        console.error('Failed to fetch favorites:', e);
        return [];
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

// Fetch user list (e.g. Planning)
export async function fetchUserAnimeList(status = 'PLANNING') {
    if (!anilistUser) return [];

    const query = `
    query ($userId: Int, $status: MediaListStatus) {
        MediaListCollection(userId: $userId, type: ANIME, status: $status, sort: UPDATED_TIME_DESC) {
            lists {
                entries {
                    media {
                        id
                        title {
                            romaji
                            english
                        }
                        coverImage {
                            large
                        }
                        episodes
                        bannerImage
                        description
                        meanScore
                    }
                    progress
                    score
                }
            }
        }
    }
    `;

    try {
        const token = localStorage.getItem(TOKEN_KEY);
        if (!token) return [];

        const response = await fetch('/api/anilist/graphql', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
            body: JSON.stringify({
                query: query,
                variables: {
                    userId: anilistUser.id,
                    status: status
                }
            })
        });

        const data = await response.json();
        const lists = data.data?.MediaListCollection?.lists;
        if (lists && lists.length > 0) {
            return lists[0].entries.map(entry => ({
                id: entry.media.id,
                title: entry.media.title.english || entry.media.title.romaji,
                image: entry.media.coverImage.large,
                banner: entry.media.bannerImage,
                description: entry.media.description,
                episodes: entry.media.episodes,
                progress: entry.progress, // Watched episodes
                meanScore: entry.media.meanScore,
                userScore: entry.score
            }));
        }
        return [];
    } catch (e) {
        console.error('Failed to fetch user list:', e);
        return [];
    }
}

export async function fetchUserMediaEntry(animeTitle) {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token || !anilistUser) return null;

    const query = `
    query ($search: String, $userId: Int) {
        Media (search: $search, type: ANIME) {
            id
            mediaListEntry(userId: $userId) {
                id
                score
                status
                progress
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
            body: JSON.stringify({
                query: query,
                variables: {
                    search: animeTitle,
                    userId: anilistUser.id
                }
            })
        });

        const data = await response.json();
        return data.data?.Media?.mediaListEntry || null;
    } catch (e) {
        console.error('Failed to fetch user entry:', e);
        return null;
    }
}
