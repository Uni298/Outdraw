const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

class GameManager {
  constructor(aiBridge, categoriesFile = 'categories_jp.txt') {
    this.aiBridge = aiBridge;
    this.rooms = new Map();
    this.onStateChange = null; // Callback for state changes

    // Load categories
    this.categories = fs.readFileSync(categoriesFile, 'utf-8')
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);

    console.log(`[Game Manager] Loaded ${this.categories.length} categories`);
  }

  setStateChangeCallback(callback) {
    this.onStateChange = callback;
  }

  createRoom(hostSocketId, hostName) {
    const roomId = uuidv4().substring(0, 6).toUpperCase();

    const room = {
      id: roomId,
      host: hostSocketId,
      players: new Map([[hostSocketId, {
        id: hostSocketId,
        name: hostName,
        score: 0,
        isHost: true
      }]]),
      settings: {
        drawingTimeSeconds: 90,
        guessingTimeSeconds: 30,
        aiTopN: 3,
        maxRounds: 6,
        activeCategoryCount: 10 // Default limit representing random 3 choices will come from this pool
      },
      gameState: 'lobby', // lobby, category-selection, drawing, guessing, results, finished
      currentRound: 0,
      currentDrawer: null,
      currentCategory: null,
      categoryChoices: [],
      currentDrawing: [],
      guesses: new Map(),
      aiPredictions: [],
      roundStartTime: null,
      timer: null,
      activeCategoryIndices: [] // Subset of categories active for this game
    };

    this.rooms.set(roomId, room);
    console.log(`[Game Manager] Room ${roomId} created by ${hostName}`);

    return room;
  }

  joinRoom(roomId, socketId, playerName) {
    const room = this.rooms.get(roomId);

    if (!room) {
      return { success: false, error: '部屋が見つかりません' };
    }

    if (room.players.size >= 6) {
      return { success: false, error: '部屋が満員です' };
    }

    if (room.gameState !== 'lobby') {
      return { success: false, error: 'ゲームが既に開始されています' };
    }

    room.players.set(socketId, {
      id: socketId,
      name: playerName,
      score: 0,
      isHost: false
    });

    console.log(`[Game Manager] ${playerName} joined room ${roomId}`);

    return { success: true, room };
  }

  leaveRoom(roomId, socketId) {
    const room = this.rooms.get(roomId);
    if (!room) return;

    room.players.delete(socketId);

    // If host left, assign new host
    if (room.host === socketId && room.players.size > 0) {
      const newHost = Array.from(room.players.keys())[0];
      room.host = newHost;
      room.players.get(newHost).isHost = true;
      console.log(`[Game Manager] New host assigned in room ${roomId}`);
    }

    // Delete room if empty
    if (room.players.size === 0) {
      if (room.timer) clearTimeout(room.timer);
      this.rooms.delete(roomId);
      console.log(`[Game Manager] Room ${roomId} deleted (empty)`);
    } else {
      // If drawer left during drawing or category selection, force end phase
      if (room.currentDrawer === socketId) {
        if (room.gameState === 'drawing' || room.gameState === 'category-selection') {
          console.log(`[Game Manager] Drawer left room ${roomId}. Ending phase early.`);
          if (room.timer) clearTimeout(room.timer);
          // Proceed to guessing (even if drawing empty)
          this.endDrawingPhase(roomId);
        }
      }
    }
  }

  updateSettings(roomId, settings) {
    const room = this.rooms.get(roomId);
    if (!room) return false;

    // Validate activeCategoryCount
    // Must be at least 3 to offer choices
    if (settings.activeCategoryCount !== undefined) {
      const count = Math.min(Math.max(parseInt(settings.activeCategoryCount), 3), this.categories.length);
      settings.activeCategoryCount = count;
    }

    room.settings = { ...room.settings, ...settings };
    return true;
  }

  startGame(roomId) {
    const room = this.rooms.get(roomId);
    if (!room || room.gameState !== 'lobby') return false;

    room.currentRound = 1;
    room.gameState = 'category-selection';

    // Select Active Categories
    const n = room.settings.activeCategoryCount || 10;
    const indices = Array.from({ length: this.categories.length }, (_, i) => i);

    // Durstenfeld shuffle
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    room.activeCategoryIndices = indices.slice(0, n);

    console.log(`[Game Manager] Game started in room ${roomId}. Active categories subset size: ${n}`);

    // Set first drawer
    const playerIds = Array.from(room.players.keys());
    room.currentDrawer = playerIds[0];

    // Generate 3 random categories
    room.categoryChoices = this.getRandomCategories(room, 3);

    return true;
  }

  selectCategory(roomId, category) {
    const room = this.rooms.get(roomId);
    if (!room || room.gameState !== 'category-selection') return false;

    room.currentCategory = category;
    room.gameState = 'drawing';
    room.currentDrawing = [];
    room.roundStartTime = Date.now();

    // Set timer for drawing phase
    room.timer = setTimeout(async () => {
      await this.endDrawingPhase(roomId);
      if (this.onStateChange) {
        this.onStateChange(roomId);
      }
    }, room.settings.drawingTimeSeconds * 1000);

    console.log(`[Game Manager] Category selected in room ${roomId}: ${category}`);
    return true;
  }

  addStroke(roomId, stroke) {
    const room = this.rooms.get(roomId);
    if (!room || room.gameState !== 'drawing') return false;

    room.currentDrawing.push(stroke);
    return true;
  }

  clearDrawing(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    room.currentDrawing = []; // Reset strokes
    return true;
  }

  async endDrawingPhase(roomId) {
    const room = this.rooms.get(roomId);
    if (!room || room.gameState !== 'drawing') return false;

    if (room.timer) {
      clearTimeout(room.timer);
      room.timer = null;
    }

    room.gameState = 'guessing';
    room.guesses.clear();
    room.roundStartTime = Date.now();

    // Get AI predictions
    try {
      if (room.currentDrawing.length > 0) {
        // AI Bridge returns distance-based ranking for ALL 345 categories
        // We need to filter to room.activeCategoryIndices
        // Request Top 345 (all) to ensure we get rankings for ALL active categories, 
        // even if they are poor matches globally.
        const result = await this.aiBridge.predictStrokes(room.currentDrawing, { topN: 345 });
        const activeSet = new Set(room.activeCategoryIndices);

        // Filter topN to only active categories
        const filteredTopN = result.topN.filter(item => activeSet.has(item.index));

        // Take top N from filtered results
        const topCandidates = filteredTopN.slice(0, room.settings.aiTopN);

        room.aiPredictions = topCandidates.map(c => ({
          name: this.categories[c.index],
          distance: c.distance
        }));

        // Store confidence info for debugging
        room.aiConfidence = result.confidence;
        room.aiInputDebug = result.input; // 32x32 float array

        // AI is correct if top prediction matches the correct answer
        // Note: We no longer require confidence threshold - judge all drawings
        const topPrediction = filteredTopN.length > 0 ? filteredTopN[0] : null;
        // Fixed bug: compare category name via index

        room.aiCorrectThisRound = result.topN.some(
          item => this.categories[item.index] === room.currentCategory
        );

        [topPrediction.index] === room.currentCategory;

      } else {
        room.aiPredictions = [];
        room.aiCorrectThisRound = false;
      }
    } catch (err) {
      console.error('[Game Manager] AI prediction failed:', err);
      room.aiPredictions = [];
      room.aiCorrectThisRound = false;
    }

    // Set timer for guessing phase
    room.timer = setTimeout(() => {
      this.endGuessingPhase(roomId);
      if (this.onStateChange) {
        this.onStateChange(roomId);
      }
    }, room.settings.guessingTimeSeconds * 1000);

    console.log(`[Game Manager] Drawing phase ended in room ${roomId}`);
    return true;
  }

  submitGuess(roomId, socketId, guess) {
    const room = this.rooms.get(roomId);
    if (!room || room.gameState !== 'guessing') return false;
    if (socketId === room.currentDrawer) return false; // Drawer can't guess

    room.guesses.set(socketId, guess.trim().toLowerCase());

    // Check if ALL guessers have guessed
    const guessersCount = room.players.size - 1; // All players minus drawer
    if (room.guesses.size >= guessersCount) {
      console.log(`[Game Manager] All players have guessed. Ending round early.`);
      // End immediately
      this.endGuessingPhase(roomId);
      if (this.onStateChange) {
        this.onStateChange(roomId);
      }
    }

    return true;
  }

  endGuessingPhase(roomId) {
    const room = this.rooms.get(roomId);
    // Warning: might be called multiple times if timer and early-end race?
    // Check state to be safe
    if (!room || room.gameState !== 'guessing') return false;

    if (room.timer) {
      clearTimeout(room.timer);
      room.timer = null;
    }

    room.gameState = 'results';

    // Evaluate results
    const correctAnswer = room.currentCategory;
    const humanCorrect = [];

    // AI check
    // Use the pre-calculated flag from endDrawingPhase
    const aiCorrect = room.aiCorrectThisRound || false;

    for (const [playerId, guess] of room.guesses) {
      // Simple string match
      if (guess === correctAnswer) {
        humanCorrect.push(playerId);
      }
    }

    // Update scores
    /* Updated winning logic: AI wins if it predicts correctly, regardless of human guesses. Humans win only if they guess correctly and AI is wrong. */
    let winner = 'draw';

    // AI が正解なら無条件で AI 勝利
    if (aiCorrect) {
      winner = 'ai';
    }

    // AI が不正解で、人間が正解なら人間勝利
    else if (humanCorrect.length > 0) {
      winner = 'humans';
      humanCorrect.forEach(pid => room.players.get(pid).score += 10);
      room.players.get(room.currentDrawer).score += 5;
    }

    // AI も人間も不正解なら draw のまま


    room.roundResults = {
      winner,
      correctAnswer,
      humanCorrect,
      aiCorrect,
      aiPredictions: room.aiPredictions,
      allGuesses: Array.from(room.guesses.entries()).map(([id, guess]) => ({
        playerId: id,
        playerName: room.players.get(id).name,
        guess
      }))
    };

    console.log(`[Game Manager] Guessing phase ended in room ${roomId}, winner: ${winner}`);
    return true;
  }

  nextRound(roomId) {
    const room = this.rooms.get(roomId);
    if (!room || room.gameState !== 'results') return false;

    room.currentRound++;

    // Check if game is finished
    if (room.currentRound > room.settings.maxRounds) {
      room.gameState = 'finished';
      console.log(`[Game Manager] Game finished in room ${roomId}`);
      return true;
    }

    // Move to next drawer
    const playerIds = Array.from(room.players.keys());
    const currentIndex = playerIds.indexOf(room.currentDrawer);
    room.currentDrawer = playerIds[(currentIndex + 1) % playerIds.length];

    // Generate new categories
    room.categoryChoices = this.getRandomCategories(room, 3);
    room.gameState = 'category-selection';

    console.log(`[Game Manager] Round ${room.currentRound} started in room ${roomId}`);
    return true;
  }

  getRandomCategories(room, count) {
    // Pick from active indices
    const shuffled = [...room.activeCategoryIndices].sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, count);
    return selected.map(i => this.categories[i]);
  }

  getRoom(roomId) {
    return this.rooms.get(roomId);
  }

  getRoomBySocket(socketId) {
    for (const room of this.rooms.values()) {
      if (room.players.has(socketId)) {
        return room;
      }
    }
    return null;
  }
}

module.exports = GameManager;
