import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';
import config from './config.js';
import { setupWebSocket } from './websocket.js';
import apiRoutes from './routes/api.js';
import proxyRoutes from './routes/proxy.js';
import subtitlesRoutes from './routes/subtitles.js';


const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Generate cache-busting version on server start
const BUILD_VERSION = Date.now().toString();
console.log(`Server starting with build version: ${BUILD_VERSION}`);

const app = express();
const server = createServer(app);

// Middleware
app.use(cors());
app.use(express.json());

// Serve index.html with dynamic cache-busting version
// Cache index.html in memory
const htmlPath = join(__dirname, '../client/index.html');
let cachedHtml = readFileSync(htmlPath, 'utf-8');
cachedHtml = cachedHtml.replace(/__BUILD_VERSION__/g, BUILD_VERSION);

// Serve index.html from memory
app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.send(cachedHtml);
});

// Serve static files for the Discord Activity client with proper cache control
app.use(express.static(join(__dirname, '../client'), {
  setHeaders: (res, path) => {
    // Disable caching for CSS and HTML to prevent stale styles
    if (path.endsWith('.css') || path.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
    // Ensure correct MIME types
    if (path.endsWith('.css')) {
      res.setHeader('Content-Type', 'text/css; charset=utf-8');
    }
  }
}));
app.use('/dist', express.static(join(__dirname, '../client/dist')));



// API routes for anime browsing (proxied to Consumet)
app.use('/api', apiRoutes);



// Subtitles search/download helper
app.use('/api/subtitles', subtitlesRoutes);

// HLS proxy to bypass CSP restrictions
app.use('/proxy', proxyRoutes);

// Discord Activity token exchange endpoint
app.post('/api/token', async (req, res) => {
  const { code } = req.body;

  if (!code) {
    return res.status(400).json({ error: 'Code is required' });
  }

  try {
    const response = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: config.discord.clientId,
        client_secret: config.discord.clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: `https://${config.discord.clientId}.discordsays.com/.proxy/`,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Token exchange error response:', data);
      return res.status(response.status).json(data);
    }

    res.json({ access_token: data.access_token });
  } catch (error) {
    console.error('Token exchange error:', error);
    res.status(500).json({ error: 'Failed to exchange token' });
  }
});

// WebSocket server for video sync
// Handle both direct /ws and Discord's /.proxy/ws paths
const wss = new WebSocketServer({ noServer: true });
setupWebSocket(wss);

// Handle WebSocket upgrade for both paths
server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;

  console.log('WebSocket upgrade request for path:', pathname);

  // Accept connections on /ws, /ws/, /.proxy/ws, etc.
  const normalizedPath = pathname.replace(/\/+$/, ''); // Remove trailing slashes
  if (normalizedPath === '/ws' || normalizedPath === '/.proxy/ws') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    console.log('Rejected WebSocket path:', pathname);
    socket.destroy();
  }
});

server.listen(config.server.port, () => {
  console.log(`AnimeTogether server running on http://${config.server.host}:${config.server.port}`);
});
