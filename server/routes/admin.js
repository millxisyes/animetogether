import express from 'express';
import { getRoomsInfo, forceChangeHost } from '../websocket.js';

const router = express.Router();

// Middleware to check admin access (basic validation)
const adminMiddleware = (req, res, next) => {
  // You can replace this with actual authentication later
  // For now, we'll just allow access - consider adding IP whitelist or token check
  next();
};

// Apply admin middleware to all routes
router.use(adminMiddleware);

// Get all active rooms and their information
router.get('/api/admin/rooms', (req, res) => {
  try {
    const roomsInfo = getRoomsInfo();
    res.json({
      success: true,
      rooms: roomsInfo,
      totalRooms: roomsInfo.length,
      totalUsers: roomsInfo.reduce((sum, room) => sum + room.totalUsers, 0),
    });
  } catch (error) {
    console.error('Error fetching rooms:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch rooms' });
  }
});

// Change host in a room
router.post('/api/admin/rooms/:channelId/change-host', (req, res) => {
  try {
    const { channelId } = req.params;
    const { newHostId } = req.body;

    if (!newHostId) {
      return res.status(400).json({ success: false, error: 'newHostId is required' });
    }

    const result = forceChangeHost(channelId, newHostId);

    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('Error changing host:', error);
    res.status(500).json({ success: false, error: 'Failed to change host' });
  }
});

export default router;
