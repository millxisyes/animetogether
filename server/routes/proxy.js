import express from 'express';
import { signUrl, verifyUrl, isPrivateHost } from '../utils/security.js';

const router = express.Router();

// HLS proxy to bypass Discord Activity CSP restrictions
// This proxies m3u8 playlists and .ts segments

router.get('/hls', async (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'URL parameter is required' });
  }

  const { sig } = req.query;
  if (!verifyUrl(url, sig)) {
    return res.status(403).json({ error: 'Invalid or missing signature' });
  }

  try {
    const decodedUrl = decodeURIComponent(url);
    const urlObj = new URL(decodedUrl);

    if (isPrivateHost(urlObj.hostname)) {
      return res.status(403).json({ error: 'Forbidden host' });
    }
    const response = await fetch(decodedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        ...(isValidUrl(decodedUrl) ? { 'Referer': new URL(decodedUrl).origin } : {}),
      },
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Failed to fetch resource' });
    }

    const contentType = response.headers.get('content-type');
    const isPlaylist = decodedUrl.includes('.m3u8') || contentType?.includes('mpegurl');

    if (isPlaylist) {
      // Rewrite m3u8 playlist URLs to go through our proxy
      let content = await response.text();
      const baseUrl = decodedUrl.substring(0, decodedUrl.lastIndexOf('/') + 1);

      // Rewrite relative URLs in the playlist
      content = content.split('\n').map(line => {
        line = line.trim();
        if (line && !line.startsWith('#')) {
          // This is a URL line (segment or sub-playlist)
          let absoluteUrl;
          if (line.startsWith('http://') || line.startsWith('https://')) {
            absoluteUrl = line;
          } else {
            absoluteUrl = baseUrl + line;
          }
          const sig = signUrl(absoluteUrl);
          return `/proxy/hls?url=${encodeURIComponent(absoluteUrl)}&sig=${sig}`;
        }
        // Handle URI in EXT-X-KEY or similar tags
        if (line.includes('URI="')) {
          return line.replace(/URI="([^"]+)"/g, (match, uri) => {
            let absoluteUri;
            if (uri.startsWith('http://') || uri.startsWith('https://')) {
              absoluteUri = uri;
            } else {
              absoluteUri = baseUrl + uri;
            }
            const sig = signUrl(absoluteUri);
            return `URI="/proxy/hls?url=${encodeURIComponent(absoluteUri)}&sig=${sig}"`;
          });
        }
        return line;
      }).join('\n');

      res.set('Content-Type', 'application/vnd.apple.mpegurl');
      res.set('Access-Control-Allow-Origin', '*');
      res.send(content);
    } else {
      // Binary segment - stream it directly
      res.set('Content-Type', contentType || 'video/mp2t');
      res.set('Access-Control-Allow-Origin', '*');

      const buffer = await response.arrayBuffer();
      res.send(Buffer.from(buffer));
    }
  } catch (error) {
    console.error('Proxy error:', error);
    res.status(500).json({ error: 'Proxy failed' });
  }
});

// Proxy for video segments and other resources
router.get('/video', async (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'URL parameter is required' });
  }

  const { sig } = req.query;
  if (!verifyUrl(url, sig)) {
    return res.status(403).json({ error: 'Invalid or missing signature' });
  }

  try {
    const decodedUrl = decodeURIComponent(url);
    const urlObj = new URL(decodedUrl);

    if (isPrivateHost(urlObj.hostname)) {
      return res.status(403).json({ error: 'Forbidden host' });
    }

    const response = await fetch(decodedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        ...(isValidUrl(decodedUrl) ? { 'Referer': new URL(decodedUrl).origin } : {}),
      },
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Failed to fetch video' });
    }

    const contentType = response.headers.get('content-type');
    res.set('Content-Type', contentType || 'video/mp4');
    res.set('Access-Control-Allow-Origin', '*');

    const buffer = await response.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (error) {
    console.error('Video proxy error:', error);
    res.status(500).json({ error: 'Video proxy failed' });
  }
});

// Image proxy to bypass Discord CSP for anime images
router.get('/image', async (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'URL parameter is required' });
  }

  // const { sig } = req.query;
  // if (!verifyUrl(url, sig)) {
  //   return res.status(403).json({ error: 'Invalid or missing signature' });
  // }

  try {
    const decodedUrl = decodeURIComponent(url);
    const urlObj = new URL(decodedUrl);

    if (isPrivateHost(urlObj.hostname)) {
      return res.status(403).json({ error: 'Forbidden host' });
    }
    const response = await fetch(decodedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        ...(isValidUrl(decodedUrl) ? { 'Referer': new URL(decodedUrl).origin } : {}),
        'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
      },
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Failed to fetch image' });
    }

    const contentType = response.headers.get('content-type');
    res.set('Content-Type', contentType || 'image/jpeg');
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours

    const buffer = await response.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (error) {
    console.error('Image proxy error:', error);
    res.status(500).json({ error: 'Image proxy failed' });
  }
});

// Subtitle/caption proxy (VTT, SRT, ASS files) - converts to VTT for browser compatibility
router.get('/subtitle', async (req, res) => {
  const { url } = req.query;

  if (!url || url === 'undefined' || url === 'null') {
    return res.status(400).json({ error: 'URL parameter is required' });
  }

  const { sig } = req.query;
  if (!verifyUrl(url, sig)) {
    return res.status(403).json({ error: 'Invalid or missing signature' });
  }

  try {
    const decodedUrl = decodeURIComponent(url);

    // Validate that the decoded URL is a valid HTTP(S) URL
    if (!isValidUrl(decodedUrl) || (!decodedUrl.startsWith('http://') && !decodedUrl.startsWith('https://'))) {
      return res.status(400).json({ error: 'Invalid subtitle URL' });
    }

    const urlObj = new URL(decodedUrl);
    if (isPrivateHost(urlObj.hostname)) {
      return res.status(403).json({ error: 'Forbidden host' });
    }

    const response = await fetch(decodedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        ...(safeGetOrigin(decodedUrl) ? { 'Referer': safeGetOrigin(decodedUrl) } : {}),
      },
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Failed to fetch subtitle' });
    }

    let content = await response.text();

    // Convert SRT to VTT if needed
    if (decodedUrl.includes('.srt') || content.match(/^\d+\r?\n\d{2}:\d{2}:\d{2},\d{3}/m)) {
      content = convertSrtToVtt(content);
    }
    // Convert ASS/SSA to VTT if needed
    else if (decodedUrl.includes('.ass') || decodedUrl.includes('.ssa') || content.includes('[Script Info]')) {
      content = convertAssToVtt(content);
    }
    // Ensure VTT header exists
    else if (!content.trim().startsWith('WEBVTT')) {
      content = 'WEBVTT\n\n' + content;
    }

    res.set('Content-Type', 'text/vtt; charset=utf-8');
    res.set('Access-Control-Allow-Origin', '*');
    res.send(content);
  } catch (error) {
    console.error('Subtitle proxy error:', error);
    res.status(500).json({ error: 'Subtitle proxy failed' });
  }
});

// Convert SRT format to VTT
function convertSrtToVtt(srt) {
  // Start with VTT header
  let vtt = 'WEBVTT\n\n';

  // Normalize line endings
  srt = srt.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Split into subtitle blocks
  const blocks = srt.trim().split(/\n\n+/);

  for (const block of blocks) {
    const lines = block.split('\n');
    if (lines.length < 2) continue;

    // Find the timestamp line (may have index before it)
    let timestampIndex = 0;
    if (lines[0].match(/^\d+$/)) {
      timestampIndex = 1;
    }

    if (timestampIndex >= lines.length) continue;

    // Convert timestamp format: 00:00:00,000 --> 00:00:00.000
    const timestamp = lines[timestampIndex].replace(/,/g, '.');

    // Get the subtitle text (everything after timestamp)
    const text = lines.slice(timestampIndex + 1).join('\n');

    if (timestamp && text) {
      vtt += `${timestamp}\n${text}\n\n`;
    }
  }

  return vtt;
}

// Convert ASS/SSA format to VTT
function convertAssToVtt(ass) {
  let vtt = 'WEBVTT\n\n';

  // Normalize line endings
  ass = ass.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  const lines = ass.split('\n');
  let inEventsSection = false;
  let formatParts = [];
  let textIndex = -1;
  let startIndex = -1;
  let endIndex = -1;

  for (const line of lines) {
    // Check for Events section
    if (line.trim() === '[Events]') {
      inEventsSection = true;
      continue;
    }

    // Check for other sections (exit Events)
    if (line.trim().startsWith('[') && line.trim() !== '[Events]') {
      inEventsSection = false;
      continue;
    }

    if (!inEventsSection) continue;

    // Parse Format line
    if (line.startsWith('Format:')) {
      formatParts = line.substring(7).split(',').map(s => s.trim().toLowerCase());
      textIndex = formatParts.indexOf('text');
      startIndex = formatParts.indexOf('start');
      endIndex = formatParts.indexOf('end');
      continue;
    }

    // Parse Dialogue lines
    if (line.startsWith('Dialogue:')) {
      const parts = line.substring(9).split(',');

      if (startIndex >= 0 && endIndex >= 0 && textIndex >= 0 && parts.length > textIndex) {
        const start = convertAssTime(parts[startIndex]?.trim());
        const end = convertAssTime(parts[endIndex]?.trim());
        // Text may contain commas, so join everything from textIndex onwards
        let text = parts.slice(textIndex).join(',').trim();

        // Remove ASS style tags like {\an8}, {\pos(x,y)}, {\fad(x,y)}, etc.
        text = text.replace(/\{[^}]*\}/g, '');
        // Convert \N to newline
        text = text.replace(/\\N/gi, '\n');
        // Remove other ASS escape sequences
        text = text.replace(/\\[nNh]/g, ' ');

        if (start && end && text) {
          vtt += `${start} --> ${end}\n${text}\n\n`;
        }
      }
    }
  }

  return vtt;
}

// Convert ASS timestamp (H:MM:SS.CC) to VTT format (HH:MM:SS.MMM)
function convertAssTime(assTime) {
  if (!assTime) return null;

  const match = assTime.match(/(\d+):(\d{2}):(\d{2})\.(\d{2})/);
  if (!match) return null;

  const hours = match[1].padStart(2, '0');
  const minutes = match[2];
  const seconds = match[3];
  const centiseconds = match[4];
  const milliseconds = (parseInt(centiseconds) * 10).toString().padStart(3, '0');

  return `${hours}:${minutes}:${seconds}.${milliseconds}`;
}

// Helper: Check if string is valid URL
function isValidUrl(string) {
  try {
    new URL(string);
    return true;
  } catch (_) {
    return false;
  }
}

function safeGetOrigin(url) {
  try {
    return new URL(url).origin;
  } catch (e) {
    return null;
  }
}

export default router;
