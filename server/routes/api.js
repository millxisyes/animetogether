import express from 'express';
import { ANIME } from '@consumet/extensions';
import { signUrl } from '../utils/security.js';
import { cache, Cache } from '../utils/cache.js';

const router = express.Router();

// Providers
const providers = {
  hianime: new ANIME.Hianime(),
  animekai: new ANIME.AnimeKai(),
};

// Default provider
const DEFAULT_PROVIDER = 'animekai';

// Helper to get provider
// Helper to get provider
function getProvider(req) {
  const providerName = req.query.provider || DEFAULT_PROVIDER;
  return providers[providerName.toLowerCase()] || providers[DEFAULT_PROVIDER];
}

// Helper to sign sources
function signSources(data) {
  if (!data) return data;

  if (data.sources) {
    data.sources.forEach(s => {
      if (s.url) {
        const endpoint = s.isM3U8 || s.url.includes('.m3u8') ? 'hls' : 'video';
        s.proxyUrl = `/proxy/${endpoint}?url=${encodeURIComponent(s.url)}&sig=${signUrl(s.url)}`;
      }
    });
  }

  if (data.subtitles) {
    data.subtitles.forEach(s => {
      if (s.url) {
        s.proxyUrl = `/proxy/subtitle?url=${encodeURIComponent(s.url)}&sig=${signUrl(s.url)}`;
      }
    });
  }

  return data;
}

// Search anime
router.get('/anime/search', async (req, res) => {
  const { query, page = 1 } = req.query;

  if (!query) {
    return res.status(400).json({ error: 'Query parameter is required' });
  }

  try {
    const provider = getProvider(req);
    const cacheKey = Cache.generateKey('search', provider.name, query, page);
    const cachedResult = cache.get(cacheKey);

    if (cachedResult) {
      console.log(`[Cache] Serving search results for "${query}"`);
      return res.json(cachedResult);
    }

    console.log(`Searching for "${query}" using ${provider.name}`);
    const results = await provider.search(query, parseInt(page));
    console.log(`Found ${results.results?.length || 0} results`);

    // Cache for 30 minutes
    cache.set(cacheKey, results, 30 * 60);

    res.json(results);
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Failed to search anime', details: error.message });
  }
});

// Get anime info (with episodes)
router.get('/anime/info/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const provider = getProvider(req);
    console.log(`Getting info for "${id}" using ${provider.name}`);
    const info = await provider.fetchAnimeInfo(id);
    console.log(`Found anime: ${info.title}, episodes: ${info.episodes?.length || 0}`);

    res.json(info);
  } catch (error) {
    console.error('Info error:', error);
    res.status(500).json({ error: 'Failed to get anime info', details: error.message });
  }
});

// Get episode streaming links  
router.get('/anime/watch/:episodeId', async (req, res) => {
  const { episodeId } = req.params;
  const { dub, server } = req.query;

  try {
    const provider = getProvider(req);
    const isDub = dub === 'true';
    const subOrDub = isDub ? 'dub' : 'sub';

    // We don't cache streaming links aggressively because they might expire
    // But short term caching (15 mins) helps with page refreshes
    // We don't cache streaming links aggressively because they might expire
    // But short term caching (15 mins) helps with page refreshes
    // const cacheKey = Cache.generateKey('watch', provider.name, episodeId, isDub, server || 'default');
    // const cachedResult = cache.get(cacheKey);

    // if (cachedResult) {
    //   console.log(`[Cache] Serving stream links for "${episodeId}"`);
    //   return res.json(signSources(cachedResult));
    // }

    console.log(`Getting streams for episode "${episodeId}" using ${provider.name}, dub=${isDub}`);

    // If specific server requested, try that first
    if (server) {
      try {
        const sources = await provider.fetchEpisodeSources(episodeId, server, subOrDub);
        console.log(`Found ${sources.sources?.length || 0} sources using server: ${server}`);
        if (sources.subtitles) {
          console.log(`Found ${sources.subtitles.length} inline subtitles`);
        }

        if (sources.subtitles) {
          console.log(`Found ${sources.subtitles.length} inline subtitles`);
        }

        // cache.set(cacheKey, sources, 15 * 60);
        return res.json(signSources(sources));
      } catch (err) {
        console.log(`Server ${server} failed, trying fallback...`);
      }
    }

    // Try to get available servers first
    let servers = [];
    if (provider.fetchEpisodeServers) {
      try {
        servers = await provider.fetchEpisodeServers(episodeId, subOrDub);
        console.log(`Available servers: ${servers.map(s => s.name).join(', ') || 'none'}`);
      } catch (err) {
        console.log('Could not fetch servers, trying default...');
      }
    }

    // Try each server until one works
    const errors = [];
    const successfulServers = [];
    for (const serverInfo of servers) {
      try {
        console.log(`Trying server: ${serverInfo.name}`);
        // Try with server name first
        let sources;
        try {
          sources = await provider.fetchEpisodeSources(episodeId, serverInfo.name, subOrDub);
        } catch (err) {
          // If server name fails, try with URL if available
          if (serverInfo.url) {
            sources = await provider.fetchEpisodeSources(serverInfo.url, serverInfo.name, subOrDub);
          } else {
            throw err;
          }
        }
        console.log(`Found ${sources.sources?.length || 0} sources using server: ${serverInfo.name}`);
        if (sources.subtitles) {
          console.log(`Found ${sources.subtitles.length} inline subtitles`);
        }
        // Include server info in response
        sources.serverUsed = serverInfo.name;
        sources.serversAttempted = successfulServers;

        // cache.set(cacheKey, sources, 15 * 60);
        return res.json(signSources(sources));
      } catch (err) {
        errors.push(`${serverInfo.name}: ${err.message}`);
        successfulServers.push(serverInfo.name);
        console.log(`Server ${serverInfo.name} failed: ${err.message}`);
      }
    }

    // If no servers worked (or no servers list), try default with no server specified
    try {
      const sources = await provider.fetchEpisodeSources(episodeId, undefined, subOrDub);
      console.log(`Found ${sources.sources?.length || 0} sources using default server`);
      if (sources.subtitles) {
        console.log(`Found ${sources.subtitles.length} inline subtitles`);
      }
      sources.serversAttempted = successfulServers;

      // cache.set(cacheKey, sources, 15 * 60);
      return res.json(signSources(sources));
    } catch (err) {
      errors.push(`default: ${err.message}`);
      console.log(`Default server failed: ${err.message}`);
    }

    // AnimeKai-specific: Try hianime as fallback provider for this episode
    // Only try fallback if hianime feature flag is enabled by the client
    const hianimeEnabled = req.query.hianime === 'true';
    if (provider.name === 'AnimeKai' && hianimeEnabled) {
      console.log('AnimeKai failed, trying hianime as fallback (feature flag enabled)...');
      try {
        // Extract anime ID from episodeId format: "anime-id$ep=N$token=XXX"
        const animeId = episodeId.split('$')[0];
        // Search for the anime on hianime
        const searchResults = await providers.hianime.search(animeId.replace(/-/g, ' '));
        if (searchResults.results?.length > 0) {
          const hiAnimeInfo = await providers.hianime.fetchAnimeInfo(searchResults.results[0].id);
          // Get the episode number from the original episodeId
          const epMatch = episodeId.match(/\$ep=(\d+)/);
          const episodeNum = epMatch ? parseInt(epMatch[1]) : 1;
          const episode = hiAnimeInfo.episodes?.find(ep => ep.number === episodeNum);
          if (episode) {
            // Prefer VidCloud for hardsubs, default 'sub' category
            let sources;
            try {
              // category 'sub' usually implies hardsubs on VidCloud
              sources = await providers.hianime.fetchEpisodeSources(episode.id, 'VidCloud', 'sub');
            } catch (e) {
              console.log('VidCloud failed, trying default...');
              sources = await providers.hianime.fetchEpisodeSources(episode.id);
            }
            console.log(`Found ${sources.sources?.length || 0} sources using hianime fallback`);
            sources.serverUsed = 'hianime-fallback';

            // Should we cache fallback results? Maybe better not to mix providers in cache key without being explicit
            // But since cacheKey includes provider name from original request... 
            // Actually, let's cache it but it might be confusing if AnimeKai comes back up. 
            // Let's NOT cache fallback for now, so we retry main provider next time.
            return res.json(signSources(sources));
          }
        }
      } catch (fallbackErr) {
        errors.push(`hianime-fallback: ${fallbackErr.message}`);
        console.log(`Hianime fallback failed: ${fallbackErr.message}`);
      }
    }

    // All servers failed
    throw new Error(`All servers failed: ${errors.join('; ')}`);
  } catch (error) {
    console.error('Watch error:', error);
    const errorResponse = {
      error: 'Failed to get streaming links',
      details: error.message,
      message: error.message
    };
    res.status(500).json(errorResponse);
  }
});

// Get top airing anime (used as default view)
router.get('/anime/top-airing', async (req, res) => {
  const { page = 1 } = req.query;

  try {
    const provider = getProvider(req);
    const cacheKey = Cache.generateKey('top-airing', provider.name, page);
    const cachedResult = cache.get(cacheKey);

    if (cachedResult) {
      console.log(`[Cache] Serving top airing`);
      return res.json(cachedResult);
    }

    console.log(`Getting top airing using ${provider.name}`);

    // Not all providers support topAiring, fallback to trending or popular if needed
    let results;
    if (provider.fetchTopAiring) {
      results = await provider.fetchTopAiring(parseInt(page));
    } else if (provider.fetchTrendingAnime) {
      results = await provider.fetchTrendingAnime(parseInt(page));
    } else {
      // Fallback to hianime if current provider doesn't support discovery
      results = await providers.hianime.fetchTopAiring(parseInt(page));
    }

    console.log(`Found ${results.results?.length || 0} items`);

    // Cache for 10 minutes
    cache.set(cacheKey, results, 10 * 60);

    res.json(results);
  } catch (error) {
    console.error('Top airing error:', error);
    res.status(500).json({ error: 'Failed to get top airing', details: error.message });
  }
});

// Get recent episodes
router.get('/anime/recent', async (req, res) => {
  const { page = 1 } = req.query;

  try {
    const provider = getProvider(req);
    const cacheKey = Cache.generateKey('recent', provider.name, page);
    const cachedResult = cache.get(cacheKey);

    if (cachedResult) {
      console.log(`[Cache] Serving recent episodes`);
      return res.json(cachedResult);
    }

    console.log(`Getting recent episodes using ${provider.name}`);

    let results;
    if (provider.fetchRecentlyUpdated) {
      results = await provider.fetchRecentlyUpdated(parseInt(page));
    } else if (provider.fetchRecentEpisodes) {
      results = await provider.fetchRecentEpisodes(parseInt(page));
    } else {
      results = await providers.hianime.fetchRecentlyUpdated(parseInt(page));
    }

    console.log(`Found ${results.results?.length || 0} recent episodes`);

    // Cache for 10 minutes
    cache.set(cacheKey, results, 10 * 60);

    res.json(results);
  } catch (error) {
    console.error('Recent error:', error);
    res.status(500).json({ error: 'Failed to get recent episodes', details: error.message });
  }
});

export default router;
