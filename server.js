const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const AIBridge = require('./ai-bridge');
const GameManager = require('./game-manager');

// Load config
const config = JSON.parse(fs.readFileSync('config.json', 'utf-8'));

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files
app.use(express.static('public'));

// Initialize AI Bridge
const aiBridge = new AIBridge(config.modelDir);
const gameManager = new GameManager(aiBridge, config.categoriesFile);

// Set up state change callback for timer expirations
gameManager.setStateChangeCallback((roomId) => {
  emitRoomState(roomId);
});

// Helper function to emit room state (defined here so it can be used in callback)
function emitRoomState(roomId) {
  const room = gameManager.getRoom(roomId);
  if (!room) return;

  const state = {
    gameState: room.gameState,
    roomId: room.id, // Explicitly provide roomId for client compatibility
    currentRound: room.currentRound,
    maxRounds: room.settings.maxRounds,
    players: Array.from(room.players.values()),
    aiScore: room.aiScore,
    currentDrawer: room.currentDrawer,
    activeCategoryIndices: room.activeCategoryIndices,
    settings: room.settings
  };

  // Add state-specific data
  if (room.gameState === 'category-selection') {
    state.categoryChoices = room.categoryChoices;
  } else if (room.gameState === 'drawing') {
    state.currentCategory = room.currentCategory;
    state.timeRemaining = Math.max(0,
      room.settings.drawingTimeSeconds - Math.floor((Date.now() - room.roundStartTime) / 1000)
    );
  } else if (room.gameState === 'guessing') {
    state.timeRemaining = Math.max(0,
      room.settings.guessingTimeSeconds - Math.floor((Date.now() - room.roundStartTime) / 1000)
    );
    state.guessedPlayers = Array.from(room.guesses.keys());
  } else if (room.gameState === 'results') {
    state.results = room.roundResults;
    // Ensure AI debug input is passed if available
    if (room.aiInputDebug) {
      state.results.aiInputDebug = room.aiInputDebug;
    }
  }

  io.to(roomId).emit('game-state', state);
}

// Start AI Bridge
aiBridge.start()
  .then(() => {
    console.log('[Server] AI Bridge initialized successfully');
  })
  .catch(err => {
    console.error('[Server] Failed to initialize AI Bridge:', err);
    process.exit(1);
  });

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log(`[Server] Client connected: ${socket.id}`);

  // Create room
  socket.on('create-room', (playerName) => {
    const room = gameManager.createRoom(socket.id, playerName);
    socket.join(room.id);

    socket.emit('room-created', {
      roomId: room.id,
      player: room.players.get(socket.id),
      settings: room.settings
    });

    emitRoomState(room.id);
  });

  // Join room
  socket.on('join-room', ({ roomId, playerName }) => {
    const result = gameManager.joinRoom(roomId, socket.id, playerName);

    if (result.success) {
      socket.join(roomId);
      socket.emit('room-joined', {
        roomId: roomId,
        player: result.room.players.get(socket.id),
        settings: result.room.settings
      });

      emitRoomState(roomId);
    } else {
      socket.emit('error', { message: result.error });
    }
  });

  // Update settings (host only)
  socket.on('update-settings', ({ roomId, settings }) => {
    const room = gameManager.getRoom(roomId);
    if (!room || room.host !== socket.id) {
      socket.emit('error', { message: '設定を変更する権限がありません' });
      return;
    }

    gameManager.updateSettings(roomId, settings);
    io.to(roomId).emit('settings-updated', room.settings);
  });

  // Start game (host only)
  socket.on('start-game', (roomId) => {
    console.log(`[Server] Received start-game request for room ${roomId} from ${socket.id}`);
    const room = gameManager.getRoom(roomId);

    if (!room) {
      console.error(`[Server] Room ${roomId} not found!`);
      socket.emit('error', { message: '部屋が見つかりません' });
      return;
    }

    console.log(`[Server] Room host: ${room.host}, Request from: ${socket.id}`);

    if (room.host !== socket.id) {
      console.error(`[Server] Permission denied. Host: ${room.host}, Socket: ${socket.id}`);
      socket.emit('error', { message: 'ゲームを開始する権限がありません' });
      return;
    }

    if (gameManager.startGame(roomId)) {
      emitRoomState(roomId);
    }
  });

  // Select category (drawer only)
  socket.on('select-category', ({ roomId, category }) => {
    const room = gameManager.getRoom(roomId);
    if (!room || room.currentDrawer !== socket.id) {
      socket.emit('error', { message: 'カテゴリを選択する権限がありません' });
      return;
    }

    if (gameManager.selectCategory(roomId, category)) {
      emitRoomState(roomId);
    }
  });

  // Add stroke (drawer only)
  socket.on('add-stroke', ({ roomId, stroke }) => {
    const room = gameManager.getRoom(roomId);
    if (!room || room.currentDrawer !== socket.id) return;

    if (gameManager.addStroke(roomId, stroke)) {
      // Broadcast stroke to all players in room
      socket.to(roomId).emit('stroke-added', stroke);
    }
  });

  // Clear canvas (drawer only)
  socket.on('clear-canvas', (roomId) => {
    const room = gameManager.getRoom(roomId);
    if (!room || room.currentDrawer !== socket.id) return;

    if (gameManager.clearDrawing(roomId)) {
      // Broadcast clear to all players in room
      io.to(roomId).emit('canvas-cleared');
    }
  });

  // End drawing phase early (drawer only)
  socket.on('end-drawing', async (roomId) => {
    const room = gameManager.getRoom(roomId);
    if (!room || room.currentDrawer !== socket.id) return;

    const success = await gameManager.endDrawingPhase(roomId);
    if (success) {
      emitRoomState(roomId);
    }
  });

  // Submit guess
  socket.on('submit-guess', ({ roomId, guess }) => {
    if (gameManager.submitGuess(roomId, socket.id, guess)) {
      socket.emit('guess-submitted');

      // Notify room that player has guessed
      const room = gameManager.getRoom(roomId);
      const player = room.players.get(socket.id);
      io.to(roomId).emit('player-guessed', {
        playerId: socket.id,
        playerName: player.name
      });

      // Update room state to show who has guessed
      emitRoomState(roomId);
    }
  });

  // Next round (host only)
  socket.on('next-round', (roomId) => {
    const room = gameManager.getRoom(roomId);
    if (!room || room.host !== socket.id) {
      socket.emit('error', { message: '次のラウンドを開始する権限がありません' });
      return;
    }

    if (gameManager.nextRound(roomId)) {
      emitRoomState(roomId);
    }
  });

  // Chat message
  socket.on('chat-message', ({ message }) => {
    const room = gameManager.getRoomBySocket(socket.id);
    if (!room) return;

    const player = room.players.get(socket.id);
    if (!player) return;

    // Broadcast chat message to all players in the room
    io.to(room.id).emit('chat-message', {
      playerId: socket.id,
      playerName: player.name,
      message: message
    });
  });

  // Reaction
  socket.on('reaction', ({ roomId, emoji }) => {
    const room = gameManager.getRoom(roomId);
    if (!room) return;

    // Broadcast reaction to all players in the room with sender's ID
    io.to(roomId).emit('reaction', { 
      emoji,
      playerId: socket.id
    });
  });

  // Disconnect
  socket.on('disconnect', () => {
    console.log(`[Server] Client disconnected: ${socket.id}`);

    const room = gameManager.getRoomBySocket(socket.id);
    if (room) {
      gameManager.leaveRoom(room.id, socket.id);
      emitRoomState(room.id);
    }
  });
});

// Start server
const PORT = config.port || 3000;
server.listen(PORT, () => {
  console.log(`[Server] Running on http://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[Server] Shutting down...');
  aiBridge.stop();
  server.close(() => {
    console.log('[Server] Server closed');
    process.exit(0);
  });
});
