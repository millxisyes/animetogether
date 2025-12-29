// Room management - keyed by Discord channel ID
import fs from 'fs';
const rooms = new Map();
const DATA_FILE = 'rooms.json';

function saveRooms() {
  try {
    const serializable = Array.from(rooms.entries()).map(([id, room]) => ({
      id,
      hostId: room.hostId,
      viewers: Array.from(room.viewers.entries()).map(([uid, v]) => [uid, { username: v.username, avatar: v.avatar }]),
      currentVideo: room.currentVideo,
      playbackState: room.playbackState
    }));
    fs.writeFileSync(DATA_FILE, JSON.stringify(serializable));
  } catch (e) {
    console.error('Failed to save rooms:', e);
  }
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
    console.log('New WebSocket connection from:', req.socket.remoteAddress);

    let currentRoom = null;
    let odUserId = null;
    let isHost = false;

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        console.log('Received message:', message.type, message);
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
      odUserId = odUserIdFromMsg;
      currentRoom = channelId;

      console.log(`User ${odUserId} (${username}) joining channel ${channelId}`);
      console.log(`Current rooms:`, Array.from(rooms.keys()));

      // Get or create room
      if (!rooms.has(channelId)) {
        // First person to join becomes the host
        rooms.set(channelId, {
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
        console.log(`✅ Room CREATED for channel ${channelId}, host: ${odUserId} (${username})`);
      } else {
        const room = rooms.get(channelId);
        // Clean up stale connections on restart
        if (room.hostId === odUserId && (!room.hostWs || room.hostWs.readyState !== 1)) {
          room.hostWs = ws;
          isHost = true;
          console.log(`Host ${odUserId} reconnected to channel ${channelId}`);
        } else if (room.hostId === odUserId) {
          // Host reconnected - update socket reference
          room.hostWs = ws;
          isHost = true;
          console.log(`Host ${odUserId} reconnected to channel ${channelId}`);
        } else {
          // Join as viewer
          room.viewers.set(odUserId, { ws, username, avatar });
          isHost = false;
          console.log(`User ${odUserId} joined channel ${channelId} as viewer`);
        }
      }

      saveRooms();

      const room = rooms.get(channelId);

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
      broadcastToRoom(channelId, {
        type: 'viewer-joined',
        odUserId,
        username,
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

      broadcastToRoom(currentRoom, {
        type: 'chat',
        odUserId,
        username: message.username,
        content: message.content,
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

// Export functions for admin panel
export function getRoomsInfo() {
  const roomsInfo = [];
  for (const [channelId, room] of rooms.entries()) {
    const viewers = Array.from(room.viewers.entries()).map(([userId, viewer]) => ({
      userId,
      username: viewer.username,
      avatar: viewer.avatar,
    }));

    roomsInfo.push({
      channelId,
      hostId: room.hostId,
      viewers,
      currentVideo: room.currentVideo,
      playbackState: room.playbackState,
      totalUsers: viewers.length + 1,
    });
  }
  return roomsInfo;
}

export function forceChangeHost(channelId, newHostId) {
  const room = rooms.get(channelId);
  if (!room) {
    return { success: false, error: 'Room not found' };
  }

  // Check if new host is in the room
  const isNewHostCurrentHost = room.hostId === newHostId;
  const isNewHostViewer = room.viewers.has(newHostId);

  if (!isNewHostCurrentHost && !isNewHostViewer) {
    return { success: false, error: 'User not in room' };
  }

  const oldHostId = room.hostId;

  if (newHostId === oldHostId) {
    return { success: false, error: 'User is already host' };
  }

  // Move old host to viewers
  if (room.hostWs && room.hostWs.readyState === 1) {
    room.hostWs.send(JSON.stringify({
      type: 'role',
      isHost: false,
      hostId: newHostId,
      currentVideo: room.currentVideo,
      playbackState: room.playbackState,
      viewerCount: room.viewers.size + 1,
    }));
  }
  room.viewers.set(oldHostId, {
    ws: room.hostWs,
    username: 'User ' + oldHostId.substring(0, 8),
    avatar: '',
  });

  // Move new host from viewers to host
  const newHostData = room.viewers.get(newHostId);
  if (newHostData) {
    room.viewers.delete(newHostId);
    room.hostWs = newHostData.ws;
  }

  room.hostId = newHostId;

  // Notify all users about host change
  broadcastToRoom(channelId, {
    type: 'host-changed',
    newHostId,
    viewerCount: room.viewers.size + 1,
  });

  console.log(`Host changed in room ${channelId}: ${oldHostId} → ${newHostId}`);
  saveRooms();

  return { success: true, oldHostId, newHostId };
}
