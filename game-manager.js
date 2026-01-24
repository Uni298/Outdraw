const fs = require("fs");

const { v4: uuidv4 } = require("uuid");



class GameManager {

  constructor(aiBridge, categoriesFile = "categories_jp.txt") {

    this.aiBridge = aiBridge;

    this.rooms = new Map();

    this.onStateChange = null; // Callback for state changes



    // Load categories

    this.categories = fs

      .readFileSync(categoriesFile, "utf-8")

      .split("\n")

      .map((line) => line.trim())

      .filter((line) => line.length > 0);



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

      players: new Map([

        [

          hostSocketId,

          {

            id: hostSocketId,

            name: hostName,

            score: 0,

            isHost: true,

          },

        ],

      ]),

      settings: {

        drawingTimeSeconds: 90,

        guessingTimeSeconds: 30,

        aiTopN: 3,

        maxRounds: 6,

        activeCategoryCount: 10, // Default limit representing random 3 choices will come from this pool

        allowClearCanvas: true, // Default: Clear button allowed

        maxPlayers: 8, // Maximum number of players allowed

        topicChoiceCount: 3, // Number of topic choices for drawer

        canvasWidth: 800, // Canvas width

        canvasHeight: 600, // Canvas height

        penThickness: 10 // Pen thickness

      },

      aiScore: 0,

      gameState: "lobby", // lobby, category-selection, drawing, guessing, results, finished

      currentRound: 0,

      currentDrawer: null,

      currentCategory: null,

      categoryChoices: [],

      currentDrawing: [],

      guesses: new Map(),

      aiPredictions: [],

      roundStartTime: null,

      timer: null,

      activeCategoryIndices: [], // Subset of categories active for this game

    };



    this.rooms.set(roomId, room);

    console.log(`[Game Manager] Room ${roomId} created by ${hostName}`);



    return room;

  }



  joinRoom(roomId, socketId, playerName) {

    const room = this.rooms.get(roomId);



    if (!room) {

      return { success: false, error: "部屋が見つかりません" };

    }



    if (room.players.size >= (room.settings.maxPlayers || 8)) {

      return { success: false, error: "部屋が満員です" };

    }



    // Allow mid-game join

    // if (room.gameState !== "lobby") {

    //   return { success: false, error: "ゲームが既に開始されています" };

    // }



    room.players.set(socketId, {

      id: socketId,

      name: playerName,

      score: 0,

      isHost: false,

    });



    console.log(`[Game Manager] ${playerName} joined room ${roomId}`);



    return { success: true, room };

  }



  pauseGame(roomId) {
    const room = this.rooms.get(roomId);
    if (!room || room.isPaused) return false;
    
    room.isPaused = true;
    
    // Cache remaining time
    if (room.timer) {
        clearTimeout(room.timer);
        room.timer = null;
        
        const now = Date.now();
        const elapsed = (now - room.roundStartTime) / 1000;
        
        // Calculate original duration based on state
        let duration = 0;
        if (room.gameState === 'drawing') duration = room.settings.drawingTimeSeconds;
        else if (room.gameState === 'guessing') duration = room.settings.guessingTimeSeconds;
        else if (room.gameState === 'category-selection') duration = 15; // default implicit?
        
        room.remainingTime = Math.max(0, duration - elapsed);
    }
    
    console.log(`[Game Manager] Room ${roomId} paused. Remaining time: ${room.remainingTime.toFixed(1)}s`);
    return true;
  }

  resumeGame(roomId) {
    const room = this.rooms.get(roomId);
    if (!room || !room.isPaused) return false;
    
    room.isPaused = false;
    room.roundStartTime = Date.now() - ((room.settings[room.gameState === 'drawing' ? 'drawingTimeSeconds' : 'guessingTimeSeconds'] || 0) - room.remainingTime) * 1000;
    // Actually, simpler logic:
    // We want to fire the callback after room.remainingTime seconds.
    // And we need to fake `roundStartTime` so that `emitRoomState` calculates correct remaining time.
    // `emitRoomState` does: duration - (now - start)
    // So: additional_elapsed = duration - remaining
    // now - start = additional_elapsed
    // start = now - additional_elapsed
    
    const duration = room.gameState === 'drawing' ? room.settings.drawingTimeSeconds : 
                     (room.gameState === 'guessing' ? room.settings.guessingTimeSeconds : 15);
                     
    // Reset start time so that calculated remaining time matches the stored remainingTime                 
    room.roundStartTime = Date.now() - (duration - room.remainingTime) * 1000;

    // Restart timer
    if (room.remainingTime > 0) {
        const callback = () => {
             if (room.gameState === 'drawing') {
                 this.endDrawingPhase(roomId).then(() => { if (this.onStateChange) this.onStateChange(roomId); });
             } else if (room.gameState === 'guessing') {
                 this.endGuessingPhase(roomId);
                 if (this.onStateChange) this.onStateChange(roomId);
             }
        };
        room.timer = setTimeout(callback, room.remainingTime * 1000);
    } else {
        // Immediate finish if time was up
         if (room.gameState === 'drawing') {
             this.endDrawingPhase(roomId).then(() => { if (this.onStateChange) this.onStateChange(roomId); });
         } else if (room.gameState === 'guessing') {
             this.endGuessingPhase(roomId);
             if (this.onStateChange) this.onStateChange(roomId);
         }
    }

    console.log(`[Game Manager] Room ${roomId} resumed`);
    return true;
  }

  abortGame(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    
    // Clear any active timers
    if (room.timer) {
      clearTimeout(room.timer);
      room.timer = null;
    }
    
    // Reset game state to lobby
    room.gameState = 'lobby';
    room.currentRound = 0;
    room.currentDrawer = null;
    room.currentCategory = null;
    room.categoryChoices = [];
    room.currentDrawing = [];
    room.guesses.clear();
    room.aiPredictions = [];
    room.isPaused = false;
    room.remainingTime = 0;
    room.drawersHistory = [];
    
    console.log(`[Game Manager] Game aborted in room ${roomId}`);
    return true;
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

        if (

          room.gameState === "drawing" ||

          room.gameState === "category-selection"

        ) {

          console.log(

            `[Game Manager] Drawer left room ${roomId}. Ending phase early.`,

          );

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

      const count = Math.min(

        Math.max(parseInt(settings.activeCategoryCount), 3),

        this.categories.length,

      );

      settings.activeCategoryCount = count;

    }



    room.settings = { ...room.settings, ...settings };

    return true;

  }



  startGame(roomId) {

    const room = this.rooms.get(roomId);

    if (!room || room.gameState !== "lobby") return false;



    room.currentRound = 1;

    room.gameState = "category-selection";



    // Select Active Categories

    const n = room.settings.activeCategoryCount || 10;

    const indices = Array.from({ length: this.categories.length }, (_, i) => i);



    // Durstenfeld shuffle

    for (let i = indices.length - 1; i > 0; i--) {

      const j = Math.floor(Math.random() * (i + 1));

      [indices[i], indices[j]] = [indices[j], indices[i]];

    }

    room.activeCategoryIndices = indices.slice(0, n);



    console.log(

      `[Game Manager] Game started in room ${roomId}. Active categories subset size: ${n}`,

    );



    // Initialize drawer tracking

    room.drawersHistory = room.drawersHistory || [];

    

    // Set first drawer randomly

    const playerIds = Array.from(room.players.keys());

    const availableDrawers = playerIds.filter(id => !room.drawersHistory.includes(id));

    

    if (availableDrawers.length === 0) {

      // Everyone has drawn, reset history

      room.drawersHistory = [];

      room.currentDrawer = playerIds[Math.floor(Math.random() * playerIds.length)];

    } else {

      room.currentDrawer = availableDrawers[Math.floor(Math.random() * availableDrawers.length)];

    }

    

    room.drawersHistory.push(room.currentDrawer);



    // Generate random categories based on setting

    const choiceCount = room.settings.topicChoiceCount || 3;
    room.categoryChoices = this.getRandomCategories(room, choiceCount);



    return true;

  }



  selectCategory(roomId, category) {

    const room = this.rooms.get(roomId);

    if (!room || room.gameState !== "category-selection") return false;



    room.currentCategory = category;



    // Ensure the selected category index is in activeCategoryIndices

    const categoryIndex = this.categories.indexOf(category);

    if (

      categoryIndex !== -1 &&

      !room.activeCategoryIndices.includes(categoryIndex)

    ) {

      room.activeCategoryIndices.push(categoryIndex);

      console.log(

        `[Game Manager] Added selected category index ${categoryIndex} to active list`,

      );

    }



    room.gameState = "drawing";

    room.currentDrawing = [];

    room.roundStartTime = Date.now();



    // Set timer for drawing phase

    room.timer = setTimeout(async () => {

      await this.endDrawingPhase(roomId);

      if (this.onStateChange) {

        this.onStateChange(roomId);

      }

    }, room.settings.drawingTimeSeconds * 1000);



    console.log(

      `[Game Manager] Category selected in room ${roomId}: ${category}`,

    );

    return true;

  }



  addStroke(roomId, stroke) {

    const room = this.rooms.get(roomId);

    if (!room || room.gameState !== "drawing") return false;



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

    if (!room || room.gameState !== "drawing") return false;



    if (room.timer) {

      clearTimeout(room.timer);

      room.timer = null;

    }



    console.log(

      `[Game Manager] End drawing phase. Drawing has ${room.currentDrawing.length} strokes`,

    );



    room.gameState = "guessing";

    room.guesses.clear();

    room.roundStartTime = Date.now();



    // Get AI predictions

    try {

      if (room.currentDrawing.length > 0) {

        // AI Bridge returns distance-based ranking for ALL 345 categories

        // We need to filter to room.activeCategoryIndices

        

        let allowedCategories = null;

        if (room.activeCategoryIndices && room.activeCategoryIndices.length > 0) {

            // Convert indices to names

            allowedCategories = room.activeCategoryIndices.map(idx => this.categories[idx]);

        }

        

        // Request Top 345 (all) to ensure we get rankings for ALL active categories,

        // even if they are poor matches globally.

        // Get AI predictions

        const aiResult = await this.aiBridge.predictStrokes(room.currentDrawing, {

          topN: room.settings.aiTopN || 3,

          allowedCategories: allowedCategories

        });



        console.log(`[Game Manager] AI prediction:`, aiResult.className);

        console.log(`[Game Manager] AI top ${room.settings.aiTopN}:`, aiResult.topN.map(p => p.name));

        console.log(`[Game Manager] AI confidence:`, aiResult.confidence);



        // Store AI predictions with confidence

        room.aiPredictions = aiResult.topN.map((pred) => ({

          name: pred.name,

          distance: pred.distance,

          score: pred.score

        }));

        

        // Store confidence percentage from the result

        // The confidence object has isConfident, absoluteDistance, relativeGap

        // We'll use the top prediction's probability as confidence

        room.aiConfidence = aiResult.confidencePercent || 0;

        // AI is correct if any of the top N predictions match the correct answer

        // AI is correct if any of the top N predictions match the correct answer

        const normalizedCategory = room.currentCategory.trim().normalize('NFC');

        room.aiCorrectThisRound = room.aiPredictions.some(

          (pred) => {

            const normalizedPred = pred.name.trim().normalize('NFC');

            const isMatch = normalizedPred === normalizedCategory;

            // Debug log just to be sure if we see weird behavior

            if (!isMatch && (pred.name.includes(room.currentCategory) || room.currentCategory.includes(pred.name))) {

                 console.log(`[GameManager] Mismatch found but similar: '${pred.name}' vs '${room.currentCategory}'`);

                 console.log(`[GameManager] Codes: `, 

                    Array.from(pred.name).map(c => c.charCodeAt(0)), 

                    ' vs ', 

                    Array.from(room.currentCategory).map(c => c.charCodeAt(0))

                 );

            }

            return isMatch;

          }

        );



        console.log(

          `[Game Manager] AI predictions: ${room.aiPredictions.map((p) => p.name).join(", ")}`,

        );

        console.log(`[Game Manager] Correct answer: ${room.currentCategory}`);

        console.log(`[Game Manager] AI correct: ${room.aiCorrectThisRound}`);

      } else {

        room.aiPredictions = [];

        room.aiCorrectThisRound = false;

      }

    } catch (err) {

      console.error("[Game Manager] AI prediction failed:", err);

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

    if (!room || room.gameState !== "guessing") return false;

    if (socketId === room.currentDrawer) return false; // Drawer can't guess



    room.guesses.set(socketId, guess.trim().toLowerCase());



    // Check if ALL guessers have guessed

    const guessersCount = room.players.size - 1; // All players minus drawer

    if (room.guesses.size >= guessersCount) {

      console.log(

        `[Game Manager] All players have guessed. Ending round early.`,

      );

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

    if (!room || room.gameState !== "guessing") return false;



    if (room.timer) {

      clearTimeout(room.timer);

      room.timer = null;

    }



    room.gameState = "results";



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

    let winner = "draw";



    // AI が正解なら無条件で AI 勝利（チーム全体で1点）

    if (aiCorrect) {

      winner = "ai";

      room.aiScore += 1;

    }



    // AI が不正解で、人間が正解なら人間勝利（チーム全体で1点、描画者に加算）

    else if (humanCorrect.length > 0) {

      winner = "humans";

      // 描画者に1点のみ加算（チーム代表として）

      room.players.get(room.currentDrawer).score += 1;

    }



    // AI も人間も不正解なら draw のまま



    room.roundResults = {

      winner,

      correctAnswer,

      humanCorrect,

      aiCorrect,

      aiPredictions: room.aiPredictions,

      guesses: Array.from(room.guesses.entries()).map(([pid, guess]) => ({

        playerId: pid,

        playerName: room.players.get(pid).name,

        guess: guess,

      })),

      drawing: JSON.parse(JSON.stringify(room.currentDrawing)), // Deep copy

      aiConfidence: room.aiConfidence || 0 // Include confidence percentage

    };



    console.log(

      `[Game Manager] Round results created. Drawing has ${room.roundResults.drawing.length} strokes`,

    );

    console.log(

      `[Game Manager] Guessing phase ended in room ${roomId}, winner: ${winner}`,

    );

    return true;

  }







  endGame(roomId, socketId) {

    const room = this.rooms.get(roomId);

    if (!room) return;



    // Verify host

    if (room.hostId !== socketId) {

        console.warn(`[Game Manager] Non-host ${socketId} tried to end game in ${roomId}`);

        return;

    }



    console.log(`[Game Manager] Host ${socketId} ended game in room ${roomId}`);



    // Clear any active timers

    if (room.timer) {

      clearTimeout(room.timer);

      room.timer = null;

    }

    

    // Reset game state to lobby-compatible state

    room.gameState = 'lobby';

    room.currentRound = 0;

    room.roundResults = null;

    room.drawersHistory = [];

    room.guesses.clear();

    room.aiScore = 0;

    room.players.forEach(p => p.score = 0); // Reset scores

    

    this.broadcastRoomState(roomId);

  }



  nextRound(roomId) {

    const room = this.rooms.get(roomId);

    if (!room || room.gameState !== "results") return false;



    room.currentRound++;



    // Check if game is finished

    if (room.currentRound > room.settings.maxRounds) {

      room.gameState = "finished";

      console.log(`[Game Manager] Game finished in room ${roomId}`);

      return true;

    }



    // Select next drawer (rotate, avoiding repeats)

    const playerIds = Array.from(room.players.keys());

    const availableDrawers = playerIds.filter(id => !room.drawersHistory.includes(id));

    

    if (availableDrawers.length === 0) {

      // Everyone has drawn, reset history

      room.drawersHistory = [];

      room.currentDrawer = playerIds[Math.floor(Math.random() * playerIds.length)];

    } else {

      room.currentDrawer = availableDrawers[Math.floor(Math.random() * availableDrawers.length)];

    }

    

    room.drawersHistory.push(room.currentDrawer);



    // Generate new categories

    room.categoryChoices = this.getRandomCategories(room, 3);

    room.gameState = 'category-selection';



    console.log(

      `[Game Manager] Round ${room.currentRound} started in room ${roomId}`,

    );

    return true;

  }



  getRandomCategories(room, count) {

    // Pick from active indices

    const shuffled = [...room.activeCategoryIndices].sort(

      () => Math.random() - 0.5,

    );

    const selected = shuffled.slice(0, count);

    return selected.map((i) => this.categories[i]);

  }



  getRoom(roomId) {

    return this.rooms.get(roomId);

  }



  returnToLobby(roomId) {

    const room = this.rooms.get(roomId);

    if (!room) return false;



    // Reset game state but keep players and settings

    room.gameState = "lobby";

    room.currentRound = 0;

    room.currentDrawer = null;

    room.currentCategory = null;

    room.currentDrawing = [];

    room.categoryChoices = [];

    room.guesses.clear();

    room.roundResults = null;

    room.aiPredictions = [];

    room.activeCategoryIndices = [];



    // Reset all player scores

    room.players.forEach((player) => {

      player.score = 0;

    });

    room.aiScore = 0;



    console.log(`[Game Manager] Room ${roomId} returned to lobby`);

    return true;

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
