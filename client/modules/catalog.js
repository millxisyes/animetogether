import { state } from './state.js';
import { elements } from './ui.js';
import { proxyImage } from './utils.js';
import { playEpisode } from './player.js';

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
            state.episodeList = anime.episodes; // Save for auto-next
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
