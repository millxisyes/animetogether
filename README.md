# AnimeTogether

A Discord Activity for watching anime together with friends! The host can browse and select anime, and all viewers automatically sync to the host's playback.

## Features

- 🎬 **Watch Together** - Synchronized playback across all participants
- 👑 **Host Controls** - First person to join becomes the host with playback control
- 🔍 **Anime Browser** - Search, browse recent episodes, and top airing anime
- 💬 **Live Chat** - Chat with other viewers while watching
- 🔄 **Auto-Sync** - Viewers automatically sync to the host's position
- 📺 **HLS Support** - Full support for m3u8 streams via proxy (CSP compliant)

## Prerequisites

- Node.js 18+ 
- A Discord Application with Activities enabled
- ngrok or cloudflared for local development (Discord requires HTTPS)

## Setup

### 1. Create Discord Application

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application
3. Go to **OAuth2** and note your Client ID and Client Secret
4. Go to **Activities** and enable the feature
5. Add your development URL (e.g., `https://your-ngrok-url.ngrok.io`)

### 2. Configure Environment

Copy the example environment file and fill in your credentials:

```bash
cp .env.example .env
```

Edit `.env`:
```
DISCORD_CLIENT_ID=your_client_id_here
DISCORD_CLIENT_SECRET=your_client_secret_here
CONSUMET_API_URL=https://api.consumet.org
PORT=3000
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Run the Server

```bash
npm run dev
```

### 5. Expose to Internet (for development)

Discord Activities require HTTPS. Use ngrok or cloudflared:

```bash
# Using ngrok
ngrok http 3000

# Using cloudflared
cloudflared tunnel --url http://localhost:3000
```

### 6. Update Discord Application

1. Copy your ngrok/cloudflared URL
2. Go to Discord Developer Portal > Your App > Activities
3. Set the URL mapping:
   - `/` → `your-tunnel-url`

## Architecture

```
animetogether/
├── server/
│   ├── index.js          # Express server + WebSocket
│   ├── config.js         # Configuration
│   ├── websocket.js      # Room management & sync logic
│   └── routes/
│       ├── api.js        # Anime API (Consumet proxy)
│       └── proxy.js      # HLS proxy for CSP compliance
├── client/
│   ├── index.html        # Main HTML
│   ├── styles.css        # Styling
│   └── app.js            # Discord SDK + Player logic
└── package.json
```

## How It Works

### Room Management
- Rooms are managed by Discord channel ID
- First user to join becomes the host
- If host leaves, the next viewer becomes the host

### Video Sync
- Host controls play/pause/seek
- Position syncs to viewers every 2 seconds
- Large time differences (>2s) trigger immediate sync

### HLS Proxy
- Discord Activities have strict CSP rules
- m3u8 streams and segments are proxied through our server
- Playlist URLs are rewritten to use the proxy

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/anime/search?query=` | Search anime |
| `GET /api/anime/info/:id` | Get anime details & episodes |
| `GET /api/anime/watch/:episodeId` | Get streaming links |
| `GET /api/anime/recent` | Recent episodes |
| `GET /api/anime/top-airing` | Top airing anime |
| `GET /proxy/hls?url=` | HLS stream proxy |
| `POST /api/token` | Discord OAuth token exchange |

## WebSocket Events

### Client → Server
- `join` - Join a room
- `sync` - Host sends playback state
- `play/pause/seek` - Playback controls
- `load-video` - Load new video
- `chat` - Send chat message

### Server → Client
- `role` - Assigned role (host/viewer)
- `sync` - Sync playback state
- `play/pause/seek` - Playback commands
- `load-video` - Load video
- `viewer-joined/left` - Participant updates
- `host-changed` - New host assigned
- `chat` - Chat message

## Troubleshooting

### Video not playing?
- Check browser console for HLS errors
- Ensure the Consumet API is accessible
- Verify the proxy is working

### Can't connect to Discord?
- Ensure your tunnel URL is set in Discord Developer Portal
- Check that Client ID matches in both `.env` and Discord settings
- Activities must be enabled for your application

### Sync issues?
- Sync happens every 2 seconds
- Large differences are corrected immediately
- Check WebSocket connection in browser dev tools

## License

MIT
