import { state } from './state.js';
import { elements } from './dom.js';
import { proxyImage } from './utils.js';
import { playEpisode } from './player.js';
import { fetchAniListScore, fetchUserAnimeList } from './anilist.js';

export async function searchAnime() {
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

export async function loadRecentEpisodes() {
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

export async function loadTopAiring() {
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

export function loadWatchHistory() {
    elements.animeResults.innerHTML = '';
    showSearchResults();

    try {
        const history = JSON.parse(localStorage.getItem('watchHistory') || '[]');
        if (history.length === 0) {
            elements.animeResults.innerHTML = '<p class="placeholder-text">No watch history yet.</p>';
            return;
        }

        history.forEach(item => {
            const card = document.createElement('div');
            card.className = 'anime-card';

            const img = document.createElement('img');
            img.src = proxyImage(item.thumbnail);
            img.alt = item.title;
            img.onerror = () => { img.src = ''; };

            const info = document.createElement('div');
            info.className = 'anime-card-info';

            const title = document.createElement('div');
            title.className = 'anime-card-title';
            title.textContent = item.title;

            const meta = document.createElement('div');
            meta.className = 'anime-card-meta';
            const progress = item.duration ? Math.round((item.currentTime / item.duration) * 100) : 0;
            meta.innerHTML = `Ep ${item.episode} <span style="opacity:0.7">• ${progress}%</span>`;

            info.appendChild(title);
            info.appendChild(meta);
            card.appendChild(img);
            card.appendChild(info);

            card.addEventListener('click', () => {
                // To resume, we need to play the episode. 
                // We should probably seek to currentTime after load, but playEpisode doesn't take start time.
                // It's okay, user can seek. Or we can improve playEpisode later.
                // Actually, if we play, history will update.
                playEpisode(item.id, item.title, item.episode, item.thumbnail);
            });

            elements.animeResults.appendChild(card);
        });

    } catch (e) {
        console.error('Failed to load history:', e);
        elements.animeResults.innerHTML = '<p class="placeholder-text">Failed to load history.</p>';
    }
}

export function displayAnimeResults(results) {
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
        img.onerror = () => { img.src = ''; img.onerror = null; };

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

export function showSearchResults() {
    elements.animeDetails.classList.add('hidden');
    elements.animeResults.classList.remove('hidden');
}

// Helper to get watch history for an anime
function getAnimeHistory(animeId) {
    try {
        const history = JSON.parse(localStorage.getItem('watchHistory') || '[]');
        return history.filter(h => h.animeId === animeId);
    } catch { return []; }
}

// Helper to check if watched
function isEpisodeWatched(episodeId) {
    try {
        const history = JSON.parse(localStorage.getItem('watchHistory') || '[]');
        return history.some(h => h.id === episodeId); // approximate check
    } catch { return false; }
}

// Watch Later Logic
function getWatchLater() {
    try {
        return JSON.parse(localStorage.getItem('watchLater') || '[]');
    } catch { return []; }
}

function addToWatchLater(anime) {
    const list = getWatchLater();
    if (!list.some(a => a.id === anime.id)) {
        list.unshift({
            id: anime.id,
            title: anime.title,
            image: anime.image,
            addedAt: Date.now()
        });
        localStorage.setItem('watchLater', JSON.stringify(list));
    }
}

function removeFromWatchLater(animeId) {
    const list = getWatchLater();
    const newList = list.filter(a => a.id !== animeId);
    localStorage.setItem('watchLater', JSON.stringify(newList));
}

function isInWatchLater(animeId) {
    return getWatchLater().some(a => a.id === animeId);
}

export function loadWatchLater() {
    elements.animeResults.innerHTML = '';
    showSearchResults();

    const list = getWatchLater();
    if (list.length === 0) {
        elements.animeResults.innerHTML = '<p class="placeholder-text">Your Watch Later list is empty.</p>';
        return;
    }

    displayAnimeResults(list);
}

export async function loadPlanningList() {
    elements.animeResults.innerHTML = '<div class="spinner"></div>';
    showSearchResults();

    try {
        const list = await fetchUserAnimeList('PLANNING');
        if (list.length === 0) {
            elements.animeResults.innerHTML = '<p class="placeholder-text">Your Planning list is empty or not connected.</p>';
            return;
        }
        displayAniListResults(list); // Use specialized display for AniList objects
    } catch (e) {
        console.error('Failed to load planning list:', e);
        elements.animeResults.innerHTML = '<p class="placeholder-text">Failed to load planning list.</p>';
    }
}

// Specialized display for AniList objects (which have slightly different structure or might need Consumet mapping)
// Actually, fetchUserAnimeList maps it to a standard structure we can use.
// But wait, displayAnimeResults expects Consumet structure?
// Consumet: { id, title, image, releaseDate, subOrDub }
// AniList Mapped: { id, title, image, banner, description, episodes, progress, score }
// The IDs from AniList might NOT match Consumet IDs (GogoAnime usually).
// If we click an item from AniList list, `loadAnimeDetails` will look up by ID.
// If the ID is an AniList ID, `loadAnimeDetails` (which calls `/api/anime/info/:id`) might fail if the provider expects a GogoAnime ID.
// The backend `/api/anime/info/:id` usually expects a GogoAnime ID.
// So when clicking a "Planning" item, we might need to SEARCH for the anime by title first to get the Gogo ID.
// Or we can rely on `loadAnimeDetails` to handle it? 
// Current `loadAnimeDetails` just calls `/api/anime/info/`.
// Use a modified click handler for AniList items.

function displayAniListResults(results) {
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
        img.onerror = () => { img.src = ''; img.onerror = null; };

        const info = document.createElement('div');
        info.className = 'anime-card-info';

        const title = document.createElement('div');
        title.className = 'anime-card-title';
        title.textContent = anime.title;

        const meta = document.createElement('div');
        meta.className = 'anime-card-meta';
        meta.innerHTML = `Planning <span style="opacity:0.7">• ${anime.score ? anime.score + '%' : ''}</span>`;

        info.appendChild(title);
        info.appendChild(meta);
        card.appendChild(img);
        card.appendChild(info);

        card.addEventListener('click', () => {
            // For AniList items, we must SEARCH by title to find the streamable version
            // as we don't have the GogoAnime ID.
            searchAndLoadAnime(anime.title);
        });
        elements.animeResults.appendChild(card);
    });
}

async function searchAndLoadAnime(query) {
    elements.animeResults.classList.add('hidden');
    elements.animeDetails.classList.remove('hidden');
    elements.animeInfo.innerHTML = '<div class="spinner"></div>';
    elements.episodeList.innerHTML = '';

    try {
        // Auto-search logic
        const response = await fetch(`/api/anime/search?query=${encodeURIComponent(query)}&provider=${state.provider}`);
        const data = await response.json();
        if (data.results && data.results.length > 0) {
            // Pick the first result? Or show a mini-selector?
            // Taking first result is risky but acceptable for "Instant Play".
            // Better: Let's show the details of the first result.
            const firstMatch = data.results[0];
            loadAnimeDetails(firstMatch.id);
        } else {
            elements.animeInfo.innerHTML = '<p class="placeholder-text">Anime not found on provider.</p>';
        }
    } catch (e) {
        console.error('Auto-search failed:', e);
        elements.animeInfo.innerHTML = '<p class="placeholder-text">Failed to find anime.</p>';
    }
}

export async function loadAnimeDetails(animeId) {
    elements.animeResults.classList.add('hidden');
    elements.animeDetails.classList.remove('hidden');
    elements.animeInfo.innerHTML = '<div class="spinner"></div>';
    elements.episodeList.innerHTML = '';

    try {
        const response = await fetch(`/api/anime/info/${encodeURIComponent(animeId)}?provider=${state.provider}`);
        const anime = await response.json();
        const coverImage = proxyImage(anime.image);

        const detailHeader = document.createElement('div');
        detailHeader.className = 'anime-detail-header';

        const cover = document.createElement('img');
        cover.src = coverImage;
        cover.alt = anime.title || 'Anime cover';

        const infoWrapper = document.createElement('div');
        infoWrapper.className = 'anime-detail-info';

        const titleEl = document.createElement('h3');
        titleEl.style.display = 'flex';
        titleEl.style.alignItems = 'center';
        titleEl.style.gap = '10px';
        titleEl.textContent = anime.title || 'Unknown title';

        // Fetch and append score
        if (anime.title) {
            fetchAniListScore(anime.title).then(score => {
                if (score) {
                    const scoreBadge = document.createElement('span');
                    scoreBadge.textContent = `${score}%`;
                    scoreBadge.style.fontSize = '0.8rem';
                    scoreBadge.style.padding = '2px 8px';
                    scoreBadge.style.borderRadius = '12px';
                    scoreBadge.style.fontWeight = 'bold';

                    if (score >= 75) {
                        scoreBadge.style.backgroundColor = 'rgba(76, 175, 80, 0.2)';
                        scoreBadge.style.color = '#81c784'; // Green
                    } else if (score >= 60) {
                        scoreBadge.style.backgroundColor = 'rgba(255, 152, 0, 0.2)';
                        scoreBadge.style.color = '#ffb74d'; // Orange
                    } else {
                        scoreBadge.style.backgroundColor = 'rgba(244, 67, 54, 0.2)';
                        scoreBadge.style.color = '#e57373'; // Red
                    }

                    titleEl.appendChild(scoreBadge);
                }
            });
        }

        // Watch Later Button
        const wlBtn = document.createElement('button');
        wlBtn.className = 'mini-btn text-btn';
        wlBtn.style.marginTop = '8px';
        const inList = isInWatchLater(anime.id);
        wlBtn.textContent = inList ? 'Remove from Watch Later' : 'Add to Watch Later';
        wlBtn.onclick = (e) => {
            e.stopPropagation();
            if (isInWatchLater(anime.id)) {
                removeFromWatchLater(anime.id);
                wlBtn.textContent = 'Add to Watch Later';
            } else {
                addToWatchLater(anime);
                wlBtn.textContent = 'Remove from Watch Later';
            }
        };

        const descEl = document.createElement('p');
        const safeDescription = anime.description ? anime.description.toString() : '';
        descEl.textContent = safeDescription.length > 200
            ? `${safeDescription.substring(0, 200)}...`
            : (safeDescription || 'No description available');

        infoWrapper.appendChild(titleEl);
        infoWrapper.appendChild(descEl);
        infoWrapper.appendChild(wlBtn);
        detailHeader.appendChild(cover);
        detailHeader.appendChild(infoWrapper);

        elements.animeInfo.innerHTML = '';
        elements.animeInfo.appendChild(detailHeader);

        if (anime.episodes && anime.episodes.length > 0) {
            state.episodeList = anime.episodes; // Save for auto-next
            elements.episodeList.innerHTML = '';

            anime.episodes.forEach(ep => {
                const item = document.createElement('div');
                item.className = 'episode-item';
                if (state.currentVideo && state.currentVideo.episodeId === ep.id) {
                    item.classList.add('playing');
                }
                // Visual Progress
                if (isEpisodeWatched(ep.id)) {
                    item.classList.add('watched');
                    // item.style.opacity = '0.6'; // Optional: fade watched?
                    // Or add checkmark
                    const check = document.createElement('span');
                    check.textContent = '✓ ';
                    check.style.color = 'var(--accent)';
                    check.style.marginRight = '4px';
                    item.prepend(check);
                }

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
