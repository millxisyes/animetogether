import express from 'express';
import { signUrl } from '../utils/security.js';

const router = express.Router();

// Search Subtitles
router.get('/search', async (req, res) => {
    const { query, imdb_id, ep, season } = req.query;

    const API_KEY = process.env.OPENSUBTITLES_API_KEY;
    const USER_AGENT = process.env.OPENSUBTITLES_USER_AGENT || 'AnimeTogether v1.0';

    console.log(`[Subtitles] Search: query="${query}" imdb="${imdb_id}" ep="${ep}" season="${season}"`);

    if (!query && !imdb_id) {
        return res.status(400).json({ error: 'Query or IMDB ID required' });
    }

    try {
        if (!API_KEY) {
            console.warn('[Subtitles] No API Key. Returning mock data.');
            return res.json({
                data: [
                    {
                        id: 'mock-1',
                        attributes: {
                            language: 'en',
                            url: 'https://raw.githubusercontent.com/andreyvit/subtitle-tools/master/sample.srt',
                            format: 'srt',
                            files: [{ file_id: 123, file_name: '[Mock] English Subtitle.srt' }]
                        }
                    }
                ]
            });
        }

        const url = new URL('https://api.opensubtitles.com/api/v1/subtitles');
        if (query) url.searchParams.append('query', query);
        if (imdb_id) url.searchParams.append('imdb_id', parseInt(imdb_id)); // Ensure number
        if (season) url.searchParams.append('season_number', parseInt(season));
        if (ep) url.searchParams.append('episode_number', parseInt(ep));

        console.log(`[Subtitles] Fetching: ${url.toString()}`);

        const response = await fetch(url.toString(), {
            headers: {
                'Api-Key': API_KEY,
                'User-Agent': USER_AGENT,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[Subtitles] API Error ${response.status}:`, errorText);
            // Don't throw, return empty to avoid client crash
            return res.json({ data: [] });
        }

        const data = await response.json();
        console.log(`[Subtitles] Success. Found: ${data.total_count}`);

        // Ensure we always return an object with a data array
        const results = data.data || [];
        results.forEach(item => {
            if (item.attributes && item.attributes.url) {
                const url = item.attributes.url;
                item.attributes.proxyUrl = `/proxy/subtitle?url=${encodeURIComponent(url)}&sig=${signUrl(url)}`;
            }
        });

        res.json({ data: results });

    } catch (error) {
        console.error('[Subtitles] Internal Error:', error);
        res.status(500).json({ error: 'Failed to search subtitles', data: [] });
    }
});

// Proxy Subtitle Download
router.get('/download', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).send('URL required');

    try {
        console.log(`[Subtitles] Downloading: ${url}`);
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0'
            }
        });

        if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);

        const content = await response.text();

        // Basic VTT conversion check
        let finalContent = content;
        let mimeType = 'text/vtt';

        // If it looks like SRT but we need VTT
        if (!content.trim().startsWith('WEBVTT') && content.includes('-->')) {
            finalContent = 'WEBVTT\n\n' + content.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
        }

        res.setHeader('Content-Type', mimeType);
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.send(finalContent);

    } catch (error) {
        console.error('[Subtitles] Download error:', error);
        res.status(500).send('Failed to download subtitle');
    }
});

export default router;
