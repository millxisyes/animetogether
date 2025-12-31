// Room management - keyed by Discord channel ID
import fs from 'fs';
const rooms = new Map();
const DATA_FILE = 'rooms.json';

// === Input validation limits ===
const MAX_CHANNEL_ID_LENGTH = 64;   // Discord channel IDs are ~19 chars
const MAX_USER_ID_LENGTH = 64;      // Discord user IDs are ~19 chars  
const MAX_USERNAME_LENGTH = 100;    // Discord usernames max 32 + some buffer
const MAX_AVATAR_LENGTH = 256;      // Avatar URL/hash
const MAX_CHAT_LENGTH = 500;        // Chat message limit
const MAX_TITLE_LENGTH = 256;       // Video title
const MAX_URL_LENGTH = 2048;        // URLs
const MAX_ROOMS = 1000;             // Max total rooms to prevent memory exhaustion

// === Rate limiting ===
const rateLimits = new Map();       // IP -> { joins: count, messages: 0, lastReset: timestamp }
const RATE_LIMIT_WINDOW = 60000;    // 1 minute window
const MAX_JOINS_PER_WINDOW = 10;    // Max join attempts per minute per IP
const MAX_MESSAGES_PER_WINDOW = 30; // Max chat messages per minute

// === IP Blocklist for spammers ===
const blockedIPs = new Map();       // IP -> unblockTime timestamp
const BLOCK_DURATION = 10 * 60 * 1000; // 10 minute ban for spammers

// === Persistence (Throttled & Async) ===
let saveTimeout = null;
let isSaving = false;
let hasPendingSave = false;
const SAVE_DELAY = 1000; // Wait 1s after last change before saving

async function saveRooms() {
  if (saveTimeout) clearTimeout(saveTimeout);

  saveTimeout = setTimeout(async () => {
    if (isSaving) {
      hasPendingSave = true;
      return;
    }

    isSaving = true;

    try {
      // Create serializable snapshot synchronously to ensure consistency
      const serializable = Array.from(rooms.entries()).map(([id, room]) => ({
        id,
        hostId: room.hostId,
        viewers: Array.from(room.viewers.entries()).map(([uid, v]) => [uid, { username: v.username, avatar: v.avatar }]),
        currentVideo: room.currentVideo,
        playbackState: room.playbackState
      }));

      const json = JSON.stringify(serializable);
      const tempFile = `${DATA_FILE}.tmp`;

      // Write to temp file asynchronously
      await fs.promises.writeFile(tempFile, json, 'utf8');

      // Atomic rename
      await fs.promises.rename(tempFile, DATA_FILE);

    } catch (e) {
      console.error('Failed to save rooms:', e);
    } finally {
      isSaving = false;
      if (hasPendingSave) {
        hasPendingSave = false;
        saveRooms(); // Trigger pending save
      }
    }
  }, SAVE_DELAY);
}

function loadRooms() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      data.forEach(r => {
        rooms.set(r.id, {
          hostId: r.hostId,
          hostWs: null,
          viewers: new Map(r.viewers.map(([uid, v]) => [uid, { ...v, ws: null }])),
          currentVideo: r.currentVideo,
          playbackState: r.playbackState
        });
      });
      console.log(`Loaded ${rooms.size} rooms from storage`);
    }
  } catch (e) {
    console.error('Failed to load rooms:', e);
  }
}


export function setupWebSocket(wss) {
  loadRooms();
  console.log('WebSocket server initialized');

  wss.on('connection', (ws, req) => {
    // Get real client IP (Cloudflare provides CF-Connecting-IP header)
    const clientIp = req.headers['cf-connecting-ip']
      || req.headers['x-forwarded-for']?.split(',')[0]?.trim()
      || req.socket.remoteAddress
      || 'unknown';

    // === Check if IP is blocked (silently close connection) ===
    const unblockTime = blockedIPs.get(clientIp);
    if (unblockTime) {
      if (Date.now() < unblockTime) {
        // Still blocked - close silently without logging
        ws.close();
        return;
      } else {
        // Block expired, remove from blocklist
        blockedIPs.delete(clientIp);
      }
    }

    console.log('New WebSocket connection from:', clientIp);

    let currentRoom = null;
    let odUserId = null;
    let isHost = false;

    ws.on('message', (data) => {
      // Check if blocked before processing any message
      if (blockedIPs.has(clientIp) && Date.now() < blockedIPs.get(clientIp)) {
        ws.close();
        return;
      }

      try {
        const message = JSON.parse(data.toString());
        handleMessage(ws, message);
      } catch (error) {
        console.error('WebSocket message error:', error);
      }
    });

    ws.on('close', () => {
      console.log('WebSocket closed for user:', odUserId);
      if (currentRoom) {
        leaveRoom(ws, currentRoom, odUserId);
      }
    });

    function handleMessage(ws, message) {
      switch (message.type) {
        case 'join':
          handleJoin(ws, message);
          break;
        case 'sync':
          handleSync(ws, message);
          break;
        case 'play':
        case 'pause':
        case 'seek':
          handlePlaybackControl(ws, message);
          break;
        case 'load-video':
          handleLoadVideo(ws, message);
          break;
        case 'chat':
          handleChat(ws, message);
          break;
      }
    }

    function handleJoin(ws, message) {
      const { channelId, odUserId: odUserIdFromMsg, username, avatar } = message;

      // === Input validation ===
      if (!channelId || typeof channelId !== 'string' || channelId.length > MAX_CHANNEL_ID_LENGTH) {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid channel ID' }));
        return;
      }
      if (!odUserIdFromMsg || typeof odUserIdFromMsg !== 'string' || odUserIdFromMsg.length > MAX_USER_ID_LENGTH) {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid user ID' }));
        return;
      }
      if (username && (typeof username !== 'string' || username.length > MAX_USERNAME_LENGTH)) {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid username' }));
        return;
      }
      if (avatar && (typeof avatar !== 'string' || avatar.length > MAX_AVATAR_LENGTH)) {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid avatar' }));
        return;
      }

      // === Rate limiting ===
      const clientIp = req.socket.remoteAddress || 'unknown';
      const now = Date.now();
      let rateData = rateLimits.get(clientIp);

      if (!rateData || now - rateData.lastReset > RATE_LIMIT_WINDOW) {
        rateData = { joins: 0, messages: 0, lastReset: now };
        rateLimits.set(clientIp, rateData);
      }

      rateData.joins++;
      if (rateData.joins > MAX_JOINS_PER_WINDOW) {
        // Block this IP for 10 minutes
        blockedIPs.set(clientIp, Date.now() + BLOCK_DURATION);
        console.warn(`IP ${clientIp} blocked for 10 minutes (exceeded join rate limit)`);
        ws.close();
        return;
      }

      // === Max rooms check ===
      if (!rooms.has(channelId) && rooms.size >= MAX_ROOMS) {
        console.warn(`Max rooms limit reached (${MAX_ROOMS}), rejecting new room creation`);
        ws.send(JSON.stringify({ type: 'error', message: 'Server at capacity. Please try again later.' }));
        return;
      }

      // Sanitize inputs (truncate just in case)
      const safeChannelId = channelId.slice(0, MAX_CHANNEL_ID_LENGTH);
      const safeUserId = odUserIdFromMsg.slice(0, MAX_USER_ID_LENGTH);
      const safeUsername = (username || 'Anonymous').slice(0, MAX_USERNAME_LENGTH);
      const safeAvatar = (avatar || '').slice(0, MAX_AVATAR_LENGTH);

      odUserId = safeUserId;
      currentRoom = safeChannelId;

      console.log(`User ${odUserId} (${safeUsername}) joining channel ${safeChannelId}`);
      console.log(`Current rooms: ${rooms.size}`);

      // Get or create room
      if (!rooms.has(safeChannelId)) {
        // First person to join becomes the host
        rooms.set(safeChannelId, {
          hostId: odUserId,
          hostWs: ws,
          viewers: new Map(),
          currentVideo: null,
          playbackState: {
            playing: false,
            currentTime: 0,
            lastUpdate: Date.now(),
          },
        });
        isHost = true;
        console.log(`✅ Room CREATED for channel ${safeChannelId}, host: ${odUserId} (${safeUsername})`);
      } else {
        const room = rooms.get(safeChannelId);
        // Clean up stale connections on restart
        if (room.hostId === odUserId && (!room.hostWs || room.hostWs.readyState !== 1)) {
          room.hostWs = ws;
          isHost = true;
          console.log(`Host ${odUserId} reconnected to channel ${safeChannelId}`);
        } else if (room.hostId === odUserId) {
          // Host reconnected - update socket reference
          room.hostWs = ws;
          isHost = true;
          console.log(`Host ${odUserId} reconnected to channel ${safeChannelId}`);
        } else {
          // Join as viewer
          room.viewers.set(odUserId, { ws, username: safeUsername, avatar: safeAvatar });
          isHost = false;
          console.log(`User ${odUserId} joined channel ${safeChannelId} as viewer`);
        }
      }

      saveRooms();

      const room = rooms.get(safeChannelId);

      console.log(`Sending role to ${odUserId}: isHost=${isHost}`);

      // Calculate estimated current time for late joiners
      let syncedPlaybackState = { ...room.playbackState };
      if (room.playbackState.playing && room.playbackState.lastUpdate) {
        const elapsed = (Date.now() - room.playbackState.lastUpdate) / 1000;
        syncedPlaybackState.currentTime = room.playbackState.currentTime + elapsed;
      }

      // Send role assignment and current state
      ws.send(JSON.stringify({
        type: 'role',
        isHost,
        hostId: room.hostId,
        currentVideo: room.currentVideo,
        playbackState: syncedPlaybackState,
        viewerCount: room.viewers.size + 1,
      }));

      // Notify others about new viewer
      broadcastToRoom(safeChannelId, {
        type: 'viewer-joined',
        odUserId,
        username: safeUsername,
        viewerCount: room.viewers.size + 1,
      }, ws);
    }

    function handleSync(ws, message) {
      if (!currentRoom || !isHost) return;

      const room = rooms.get(currentRoom);
      if (!room) return;

      room.playbackState = {
        playing: message.playing,
        currentTime: message.currentTime,
        lastUpdate: Date.now(),
        episodeId: message.episodeId || room.currentVideo?.episodeId,
      };

      // Broadcast sync to all viewers (includes episodeId for verification)
      broadcastToRoom(currentRoom, {
        type: 'sync',
        ...room.playbackState,
      }, ws);
    }

    function handlePlaybackControl(ws, message) {
      if (!currentRoom || !isHost) return;

      const room = rooms.get(currentRoom);
      if (!room) return;

      if (message.type === 'play') {
        room.playbackState.playing = true;
      } else if (message.type === 'pause') {
        room.playbackState.playing = false;
      } else if (message.type === 'seek') {
        room.playbackState.currentTime = message.currentTime;
      }

      room.playbackState.lastUpdate = Date.now();

      // Broadcast to all including host for confirmation
      broadcastToRoom(currentRoom, {
        type: message.type,
        currentTime: message.currentTime,
        playing: room.playbackState.playing,
      });
    }

    function handleLoadVideo(ws, message) {
      if (!currentRoom || !isHost) return;

      const room = rooms.get(currentRoom);
      if (!room) return;

      // Store all video metadata including episodeId for late joiner re-fetching
      room.currentVideo = {
        url: message.url,
        title: message.title,
        episode: message.episode,
        thumbnail: message.thumbnail,
        // Important: store these for late joiners to re-fetch streams
        episodeId: message.video?.episodeId || message.episodeId,
        provider: message.video?.provider || message.provider,
        isDub: message.video?.isDub || message.isDub,
        subtitle: message.video?.subtitle || message.subtitle,
      };

      // If message.video exists, use it directly (more complete data)
      if (message.video) {
        room.currentVideo = { ...message.video };
      }

      room.playbackState = {
        playing: false,
        currentTime: 0,
        lastUpdate: Date.now(),
      };

      // Broadcast video load to all viewers
      broadcastToRoom(currentRoom, {
        type: 'load-video',
        video: room.currentVideo,
        playbackState: room.playbackState,
      });
      saveRooms();
    }

    function handleChat(ws, message) {
      if (!currentRoom) return;

      // === Input validation ===
      const content = message.content;
      if (!content || typeof content !== 'string' || content.length > MAX_CHAT_LENGTH) {
        ws.send(JSON.stringify({ type: 'error', message: 'Message too long (max 500 characters)' }));
        return;
      }
      if (content.trim().length === 0) return; // Ignore empty messages

      // === Rate limiting for chat ===
      const clientIp = req.socket.remoteAddress || 'unknown';
      const now = Date.now();
      let rateData = rateLimits.get(clientIp);

      if (!rateData || now - rateData.lastReset > RATE_LIMIT_WINDOW) {
        rateData = { joins: 0, messages: 0, lastReset: now };
        rateLimits.set(clientIp, rateData);
      }

      rateData.messages++;
      if (rateData.messages > MAX_MESSAGES_PER_WINDOW) {
        // Block this IP for 10 minutes
        blockedIPs.set(clientIp, Date.now() + BLOCK_DURATION);
        console.warn(`IP ${clientIp} blocked for 10 minutes (exceeded chat rate limit)`);
        ws.close();
        return;
      }

      // Sanitize
      const safeContent = content.slice(0, MAX_CHAT_LENGTH).trim();
      const safeUsername = (message.username || 'Anonymous').slice(0, MAX_USERNAME_LENGTH);

      broadcastToRoom(currentRoom, {
        type: 'chat',
        odUserId,
        username: safeUsername,
        content: safeContent,
        timestamp: Date.now(),
      });
    }
  });
}

function leaveRoom(ws, channelId, odUserId) {
  const room = rooms.get(channelId);
  if (!room) return;

  if (room.hostId === odUserId) {
    // Host left - assign new host or close room
    if (room.viewers.size > 0) {
      const [[newHostId, newHostData]] = room.viewers.entries();
      room.hostId = newHostId;
      room.hostWs = newHostData.ws;
      room.viewers.delete(newHostId);

      // Notify new host
      newHostData.ws.send(JSON.stringify({
        type: 'role',
        isHost: true,
        hostId: newHostId,
        currentVideo: room.currentVideo,
        playbackState: room.playbackState,
        viewerCount: room.viewers.size + 1,
      }));

      // Notify others
      broadcastToRoom(channelId, {
        type: 'host-changed',
        newHostId,
        viewerCount: room.viewers.size + 1,
      });

      console.log(`Host left, new host: ${newHostId}`);
    } else {
      // No viewers, close room
      rooms.delete(channelId);
      console.log(`Room ${channelId} closed`);
    }
    saveRooms();
  } else {
    // Viewer left
    room.viewers.delete(odUserId);
    broadcastToRoom(channelId, {
      type: 'viewer-left',
      userId: odUserId,
      viewerCount: room.viewers.size + 1,
    });
    console.log(`Viewer ${odUserId} left channel ${channelId}`);
  }
}

function broadcastToRoom(channelId, message, excludeWs = null) {
  const room = rooms.get(channelId);
  if (!room) return;

  const data = JSON.stringify(message);

  // Send to host
  if (room.hostWs && room.hostWs !== excludeWs && room.hostWs.readyState === 1) {
    room.hostWs.send(data);
  }

  // Send to all viewers
  for (const [, viewer] of room.viewers) {
    if (viewer.ws !== excludeWs && viewer.ws.readyState === 1) {
      viewer.ws.send(data);
    }
  }
}


