const socket = io();
window.socket = socket; // Expose socket for chat.js
const ui = new UIManager();
let drawingCanvas = null;
let guessCanvas = null;
let currentGameState = null;
let timerInterval = null;
let categories = [];
let selectedCategory = null;

// Modal confirmation
let modalResolve = null;
function showModal(title, message) {
  return new Promise((resolve) => {
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalMessage').textContent = message;
    document.getElementById('confirmModal').classList.add('active');
    modalResolve = resolve;
  });
}

document.getElementById('modalConfirm').onclick = () => {
  document.getElementById('confirmModal').classList.remove('active');
  if (modalResolve) modalResolve(true);
};

document.getElementById('modalCancel').onclick = () => {
  document.getElementById('confirmModal').classList.remove('active');
  if (modalResolve) modalResolve(false);
};

// Reaction system
function sendReaction(emoji) {
  if (window.socket && window.socket.connected && ui.roomId) {
    window.socket.emit('reaction', { roomId: ui.roomId, emoji });
  }
}

function showReaction(emoji, playerId) {
  const display = document.getElementById('reactionDisplay');
  const chatBox = document.getElementById('chatBox');
  
  if (!chatBox) return;
  
  const rect = chatBox.getBoundingClientRect();
  const emojiEl = document.createElement('div');
  emojiEl.className = 'reaction-emoji pop-fade';
  
  // Use image for good reaction
  if (emoji === 'good') {
    const img = document.createElement('img');
    img.src = '/images/good.png';
    img.alt = 'Good';
    emojiEl.appendChild(img);
  } else {
    emojiEl.textContent = emoji;
  }
  
  // Position around chat box (random offset)
  // Chat is bottom-right mostly
  const randomX = Math.random() * 100 - 50; // +/- 50px
  const randomY = Math.random() * 100 - 150; // -50 to -150px (above chat)
  
  emojiEl.style.left = `${rect.left + rect.width / 2 + randomX}px`;
  emojiEl.style.top = `${rect.top + randomY}px`;
  
  display.appendChild(emojiEl);
  setTimeout(() => emojiEl.remove(), 2000);
}

if (window.socket) {
  window.socket.on('reaction', (data) => {
    showReaction(data.emoji, data.playerId);
  });

  // Drawing events
  window.socket.on('stroke-added', (stroke) => {
    // Spectators see drawing on guess canvas
    if (guessCanvas) {
      guessCanvas.addStroke(stroke);
    }
  });

  window.socket.on('canvas-cleared', () => {
    if (guessCanvas) {
      guessCanvas.clear();
    }
  });
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  initializeEventListeners();
  loadCategories();
  drawingCanvas = new DrawingCanvas('drawing-canvas');
  guessCanvas = new DrawingCanvas('guess-canvas');

  // Set up canvas stroke callback
  drawingCanvas.onStrokeComplete = (stroke) => {
    if (currentGameState && currentGameState.gameState === 'drawing') {
      socket.emit('add-stroke', {
        roomId: ui.roomId,
        stroke: stroke
      });
    }
  };

  // Disable guess canvas (read-only)
  guessCanvas.disable();
});

// Load categories from server
async function loadCategories() {
  try {
    const response = await fetch('/categories_jp.txt');
    const text = await response.text();
    categories = text.split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);
    console.log(`Loaded ${categories.length} categories`);
  } catch (err) {
    console.error('Failed to load categories:', err);
  }
}

// Populate category list
// Populate category list
function populateCategoryList(targetId = 'category-list', onSelect = selectCategoryForGuess) {
  const categoryList = document.getElementById(targetId);
  if (!categoryList) return;
  
  categoryList.innerHTML = '';

  let displayCategories = categories;

  // Filter if active indices exist in current room state
  if (currentGameState && currentGameState.activeCategoryIndices && currentGameState.activeCategoryIndices.length > 0) {
    const activeSet = new Set(currentGameState.activeCategoryIndices);
    // Create a map index->category since we loaded full list in order
    // We can just filter by index
    displayCategories = categories.filter((_, index) => activeSet.has(index));
  }

  displayCategories.forEach(category => {
    const item = document.createElement('div');
    item.className = 'category-item';
    item.textContent = category;
    item.dataset.category = category.toLowerCase();
    item.onclick = () => onSelect(category);
    categoryList.appendChild(item);
  });
}

// Filter categories based on search
// Filter categories based on search
function filterCategories(searchTerm, containerId = null) {
  let selector = '.category-item';
  if (containerId) {
    selector = `#${containerId} .category-item`;
  }
  
  const items = document.querySelectorAll(selector);
  const term = searchTerm.toLowerCase();

  items.forEach(item => {
    const category = item.dataset.category;
    if (category.includes(term)) {
      item.classList.remove('hidden');
    } else {
      item.classList.add('hidden');
    }
  });
}

// Select category for guess
function selectCategoryForGuess(category) {
  selectedCategory = category;

  // Update UI
  document.querySelectorAll('.category-item').forEach(item => {
    item.classList.remove('selected');
  });

  const selectedItem = Array.from(document.querySelectorAll('.category-item'))
    .find(item => item.textContent === category);
  if (selectedItem) {
    selectedItem.classList.add('selected');
  }

  document.getElementById('selected-category').classList.remove('hidden');
  document.getElementById('selected-category-name').textContent = category;
  document.getElementById('submit-guess-btn').disabled = false;
}

function initializeEventListeners() {
  // Lobby screen
  document.getElementById('create-room-btn').onclick = createRoom;
  document.getElementById('join-room-btn').onclick = () => {
    document.getElementById('join-room-input').classList.remove('hidden');
  };
  document.getElementById('join-confirm-btn').onclick = joinRoom;

  // Room screen
  document.getElementById('leave-room-btn').onclick = leaveRoom;
  document.getElementById('update-settings-btn').onclick = updateSettings;
  document.getElementById('start-game-btn').onclick = startGame;

  // Drawing screen
  document.getElementById('clear-canvas-btn').onclick = () => {
    drawingCanvas.clear();
    socket.emit('clear-canvas', ui.roomId);
  };
  document.getElementById('end-drawing-btn').onclick = endDrawing;

  // Guessing screen
  document.getElementById('submit-guess-btn').onclick = submitGuess;
  document.getElementById('category-search').oninput = (e) => {
    filterCategories(e.target.value, 'category-list');
  };
  
  document.getElementById('drawing-category-search').oninput = (e) => {
    filterCategories(e.target.value, 'drawing-category-list');
  };

  // Results screen
  document.getElementById('next-round-btn').onclick = nextRound;

  // Finished screen
  document.getElementById('return-lobby-btn').onclick = () => {
    // Request server to reset game to lobby
    socket.emit('return-to-lobby', ui.roomId);
  };

  // Reaction buttons
  document.querySelectorAll('.reaction-btn').forEach(btn => {
    btn.onclick = () => sendReaction(btn.dataset.emoji);
  });
  
  // Room ID copy functionality
  const roomIdValue = document.getElementById('room-id-display-value');
  if (roomIdValue) {
    roomIdValue.onclick = async () => {
      const text = roomIdValue.textContent;
      try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
        } else {
            // Fallback for HTTP
            const textArea = document.createElement("textarea");
            textArea.value = text;
            textArea.style.position = "fixed";
            textArea.style.left = "-9999px";
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            try {
                document.execCommand('copy');
            } catch (err) {
                console.error('Fallback copy failed', err);
            }
            document.body.removeChild(textArea);
        }
        ui.showSuccess('ルームIDをコピーしました');
      } catch (err) {
        console.error('Failed to copy id:', err);
      }
    };
  }
}

// Socket event handlers
socket.on('room-created', (data) => {
  ui.roomId = data.roomId;
  ui.playerId = socket.id;
  ui.setHostControls(true);

  document.getElementById('room-code-display').textContent = data.roomId;
  ui.showScreen('room-screen');

  // Update settings visibility
  updateSettingsVisibility(true);

  // Show room ID in top left
  const roomIdDisplay = document.getElementById('room-id-display-container');
  const roomIdValue = document.getElementById('room-id-display-value');
  if (roomIdDisplay && roomIdValue) {
    roomIdValue.textContent = data.roomId;
    roomIdDisplay.style.display = 'flex';
  }
});

socket.on('room-joined', (data) => {
  ui.roomId = data.roomId;
  ui.playerId = socket.id;
  ui.setHostControls(data.player.isHost);

  ui.showScreen('room-screen');
  ui.update(data);
  
  // Update settings in UI
  document.getElementById('drawing-time').value = data.settings.drawingTimeSeconds;
  document.getElementById('guessing-time').value = data.settings.guessingTimeSeconds;
  document.getElementById('ai-top-n').value = data.settings.aiTopN;
  document.getElementById('max-rounds').value = data.settings.maxRounds;
  document.getElementById('active-category-count').value = data.settings.activeCategoryCount;
  document.getElementById('max-players').value = data.settings.maxPlayers || 8;
  document.getElementById('allow-clear-canvas').checked = data.settings.allowClearCanvas;

  // Show room code
  document.getElementById('room-code-display').textContent = data.roomId;
  
  // Show room ID in top left
  const roomIdDisplay = document.getElementById('room-id-display-container');
  const roomIdValue = document.getElementById('room-id-display-value');
  if (roomIdDisplay && roomIdValue) {
    roomIdValue.textContent = data.roomId;
    if (data.player.isHost) {
      roomIdDisplay.style.display = 'flex';
    } else {
      roomIdDisplay.style.display = 'none';
    }
  }
  
  // Hide error
  ui.hideError();

  // If game is already running, switch to game screen immediately
  if (data.gameState !== 'lobby') {
    ui.setHostControls(data.player.isHost); // Ensure controls are set
    ui.update(data);
  }
});

socket.on('settings-updated', (settings) => {
  document.getElementById('drawing-time').value = settings.drawingTimeSeconds;
  document.getElementById('guessing-time').value = settings.guessingTimeSeconds;
  document.getElementById('ai-top-n').value = settings.aiTopN;
  document.getElementById('max-rounds').value = settings.maxRounds;
  document.getElementById('active-category-count').value = settings.activeCategoryCount;
  document.getElementById('max-players').value = settings.maxPlayers || 8;
  document.getElementById('allow-clear-canvas').checked = settings.allowClearCanvas;
  
  ui.showSuccess('設定が更新されました');
});

socket.on('game-state', (state) => {
  currentGameState = state;
  handleGameState(state);

  // Refresh category list because active indices might have changed
  populateCategoryList();
});

socket.on('stroke-added', (stroke) => {
  if (currentGameState && currentGameState.gameState === 'drawing') {
    drawingCanvas.addStroke(stroke);
  }
});

socket.on('canvas-cleared', () => {
  if (currentGameState && currentGameState.gameState === 'drawing') {
    drawingCanvas.clear();
  }
});

socket.on('player-guessed', (data) => {
  // Update guessed players list
  if (currentGameState && currentGameState.guessedPlayers) {
    const player = currentGameState.players.find(p => p.id === data.playerId);
    if (player) {
      updateGuessedPlayersList(currentGameState.guessedPlayers, currentGameState.players);
    }
  }
});

socket.on('guess-submitted', () => {
  document.getElementById('guess-status').className = 'guess-status submitted';
  document.getElementById('guess-status').textContent = '✓ 回答を送信しました!';
  document.getElementById('submit-guess-btn').disabled = true;
  document.getElementById('category-search').disabled = true;
});

socket.on('error', (data) => {
  ui.showError(data.message);
});

// Game state handler
function handleGameState(state) {
  // Centralized UI update (screens, lists, controls)
  // For 'results', we delay update to handleResults to prevent screen flash before transition
  if (state.gameState !== 'results') {
    ui.update(state, ui.playerId);
  }

  // Update specific elements not covered by ui.update or needing specific logic
  document.getElementById('player-count').textContent = state.players.length;
  document.getElementById('max-rounds-display').textContent = state.maxRounds;
  document.getElementById('guess-max-rounds').textContent = state.maxRounds;

  // Handle state-specific logic (timers, canvas, etc.)
  switch (state.gameState) {
    case 'category-selection':
      handleCategorySelection(state);
      break;
    case 'drawing':
      handleDrawing(state);
      break;
    case 'guessing':
      handleGuessing(state);
      break;
    case 'results':
      handleResults(state);
      break;
    case 'finished':
      handleFinished(state);
      break;
  }

  // Ensure reaction bar is hidden by default unless in spectator drawing mode
  if (state.gameState !== 'drawing') {
    const reactionBar = document.getElementById('floating-reaction-bar');
    if (reactionBar) reactionBar.style.display = 'none';
  }
}

function handleCategorySelection(state) {
  // UI update is handled by ui.update()
  // Logic for selection is handled via window.selectCategory
}

function handleDrawing(state) {
  ui.showScreen('drawing-screen');

  // Clear previous drawing
  drawingCanvas.clear();

  // Start timer
  startTimer('drawing-timer', state.timeRemaining);

  const drawingTools = document.getElementById('drawing-tools');
  // const reactionCard = document.getElementById('reaction-card'); // Removed

  // Enable/Disable drawing
  if (state.currentDrawer === ui.playerId) {
    // This player is drawing
    document.getElementById('current-category').textContent = state.currentCategory;
    document.getElementById('spectator-message').classList.add('hidden');
    document.getElementById('drawing-canvas').parentElement.style.display = 'block';
    drawingCanvas.enable();
    drawingTools.style.display = 'flex';
    document.getElementById('end-drawing-btn').style.display = 'block';
    
    // Check clear button setting
    const allowClear = state.settings && state.settings.allowClearCanvas !== false;
    document.getElementById('clear-canvas-btn').style.display = allowClear ? 'block' : 'none';
    
    // Clear guess canvas
    guessCanvas.clear();
    // reactionCard.style.display = 'none'; // Removed
    document.getElementById('floating-reaction-bar').style.display = 'none';
    document.getElementById('spectator-category-card').style.display = 'none';
  } else {
    // Spectating - show reactions
    const drawer = state.players.find(p => p.id === state.currentDrawer);
    document.getElementById('drawer-name').textContent = drawer ? drawer.name : 'プレイヤー';
    document.getElementById('current-category').textContent = '???';
    document.getElementById('spectator-message').classList.remove('hidden');
    document.getElementById('drawing-canvas').parentElement.style.display = 'block';
    drawingCanvas.disable();
    drawingTools.style.display = 'none';
    // reactionCard.style.display = 'block'; // Removed
    document.getElementById('floating-reaction-bar').style.display = 'flex';
    
    // Show spectator category list
    document.getElementById('spectator-category-card').style.display = 'block';
    document.getElementById('drawing-category-search').value = '';
    
    // Populate list with simple highlight-only handler
    populateCategoryList('drawing-category-list', (category) => {
      // Just highlight locally, don't submit or anything
      const list = document.getElementById('drawing-category-list');
      list.querySelectorAll('.category-item').forEach(i => i.classList.remove('selected'));
      const active = Array.from(list.querySelectorAll('.category-item')).find(i => i.textContent === category);
      if (active) active.classList.add('selected');
    });
  }
}

function handleGuessing(state) {
  ui.showScreen('guessing-screen');

  // Copy drawing to guess canvas
  guessCanvas.setStrokes(drawingCanvas.getStrokes());

  // Start timer
  startTimer('guessing-timer', state.timeRemaining);

  // Reset category selection
  selectedCategory = null;
  populateCategoryList();
  document.getElementById('category-search').value = '';
  document.getElementById('submit-guess-btn').disabled = true;
  document.getElementById('guess-status').className = 'guess-status';
  document.getElementById('guess-status').textContent = '';
  document.getElementById('selected-category').classList.add('hidden');

  // Update guessed players
  updateGuessedPlayersList(state.guessedPlayers || [], state.players);

  // Disable guessing for drawer
  if (state.currentDrawer === ui.playerId) {
    document.getElementById('category-search').disabled = true;
    document.getElementById('submit-guess-btn').disabled = true;
    document.getElementById('guess-status').className = 'guess-status';
    document.getElementById('guess-status').textContent = 'あなたは描いた人なので回答できません';
    document.getElementById('category-list').style.display = 'none';
  } else {
    document.getElementById('category-search').disabled = false;
    document.getElementById('category-list').style.display = 'block';
  }
  
  // Check if all non-drawer players have answered
  const nonDrawerCount = state.players.filter(p => p.id !== state.currentDrawer).length;
  const guessedCount = (state.guessedPlayers || []).length;
  
  if (nonDrawerCount > 0 && guessedCount === nonDrawerCount) {
    // All answered - fade out
    const screen = document.getElementById('guessing-screen');
    screen.style.transition = 'opacity 0.5s ease';
    screen.style.opacity = '0';
  }
}

function handleResults(state) {
  stopTimer();

  // Ensuring it's hidden instantly
  const resScreen = document.getElementById('results-screen');
  if (resScreen) resScreen.classList.remove('visible');
  
  // 1. Show orange overlay immediately
  const overlay = document.getElementById('transition-overlay');
  overlay.classList.remove('no-transition'); // Ensure transition is enabled
  overlay.className = 'transition-overlay'; // Reset classes
  
  // Get AI confidence from results
  // Use aiConfidence from roundResults which we added in game-manager
  const aiConfidence = (state.roundResults && state.roundResults.aiConfidence) || 0;
  
  const confidenceNumber = document.getElementById('confidence-number');
  
  // Reset confidence display
  if (confidenceNumber) {
    confidenceNumber.textContent = '0';
  }
  
  // Force overlay reset (remove melting, set to top)
  overlay.classList.remove('melting');
  overlay.className = 'transition-overlay'; // Reset to base class to be safe
  
  // Force Reflow
  void overlay.offsetWidth;
  
  // Activate Overlay (Slide Down)
  overlay.classList.add('active'); 
  
  // 2. Start count-up animation (1 second)
  // Wait for slide down (0.8s) to almost finish before counting? Or start immediately?
  // Let's wait 0.5s so it's visible
  setTimeout(() => {
    if (confidenceNumber) {
      const duration = 1000; // 1 second
      const startTime = Date.now();
      const startValue = 0;
      const endValue = aiConfidence;
      
      const animate = () => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        // Ease out quart
        const ease = 1 - Math.pow(1 - progress, 4);
        const currentValue = Math.floor(startValue + (endValue - startValue) * ease);
        confidenceNumber.textContent = currentValue;
        
        if (progress < 1) {
          requestAnimationFrame(animate);
        } else {
          // Animation done (1s elapsed)
          // 3. Wait 1 second after count-up, then reveal results and melt
          setTimeout(() => {
            // Reveal results screen content behind curtain
            // Reveal results screen content behind curtain
            const resultsScreen = document.getElementById('results-screen');
            if (resultsScreen) {
              ui.showScreen('results-screen'); // Ensure it is 'display: block' / active
              ui.update(state); // Ensure data is updated 
              
              // Small delay to ensure display:block applies before opacity transition if wanted,
              // but mostly we just need it visible behind the curtain
              requestAnimationFrame(() => {
                  resultsScreen.classList.add('visible');
              });
            }

            // Start melt (Slide down further)
            overlay.classList.add('melting'); 
            
            // 4. Reveal winner after melt starts
            setTimeout(() => {
              const banner = document.getElementById('winner-banner');
              if (banner) {
                banner.style.opacity = '1';
                banner.classList.add('reveal');
              }
              
              // Reset overlay after animation completes (1.5s usually)
              setTimeout(() => {
                // Disable transition for silent reset
                overlay.classList.add('no-transition');
                overlay.classList.remove('active', 'melting');
                
                // Force reflow
                void overlay.offsetWidth;
                
                // Re-enable transition
                overlay.classList.remove('no-transition');
              }, 1600);
            }, 500); // Small delay for melt to start revealing
          }, 1000);
        }
      };
      
      animate();
    }
  }, 800); // Wait for initial slide down
}

function handleFinished(state) {
  ui.showScreen('finished-screen');
  stopTimer();

  ui.updateScoreList(state.players);
}

function updateGuessedPlayersList(guessedPlayerIds, players) {
  const guessedPlayers = guessedPlayerIds
    .map(id => players.find(p => p.id === id))
    .filter(p => p);

  ui.updateGuessedPlayers(guessedPlayers);
}

// Timer management
function startTimer(elementId, initialSeconds) {
  stopTimer();

  let seconds = initialSeconds;
  ui.updateTimer(elementId, seconds);

  timerInterval = setInterval(() => {
    seconds--;
    if (seconds < 0) seconds = 0;
    
    // Update timer display
    ui.updateTimer(elementId, seconds);

    // Auto-submit guess if time is running out (1 second left)
    if (elementId === 'guessing-timer' && seconds <= 1 && selectedCategory) {
      const submitBtn = document.getElementById('submit-guess-btn');
      if (submitBtn && !submitBtn.disabled) {
        submitGuess();
      }
    }

    if (seconds <= 0) {
      stopTimer();
    }
  }, 1000);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

// Action functions
function createRoom() {
  const playerName = document.getElementById('player-name').value.trim();

  if (!playerName) {
    ui.showError('プレイヤー名を入力してください');
    return;
  }

  socket.emit('create-room', playerName);
}

function joinRoom() {
  const playerName = document.getElementById('player-name').value.trim();
  const roomCode = document.getElementById('room-code').value.trim().toUpperCase();

  if (!playerName) {
    ui.showError('プレイヤー名を入力してください');
    return;
  }

  if (!roomCode || roomCode.length !== 6) {
    ui.showError('6桁の部屋コードを入力してください');
    return;
  }

  socket.emit('join-room', {
    roomId: roomCode,
    playerName: playerName
  });
}

async function leaveRoom() {
  const confirmed = await showModal('退出確認', '本当に退出しますか?');
  if (confirmed) {
    location.reload();
  }
}

function updateSettings() {
  const settings = {
    drawingTimeSeconds: parseInt(document.getElementById('drawing-time').value),
    guessingTimeSeconds: parseInt(document.getElementById('guessing-time').value),
    aiTopN: parseInt(document.getElementById('ai-top-n').value),
    maxRounds: parseInt(document.getElementById('max-rounds').value),
    activeCategoryCount: parseInt(document.getElementById('active-category-count').value),
    maxPlayers: parseInt(document.getElementById('max-players').value),
    allowClearCanvas: document.getElementById('allow-clear-canvas').checked
  };

  socket.emit('update-settings', {
    roomId: ui.roomId,
    settings: settings
  });

  ui.showSuccess('設定を更新しました');
}

function startGame() {
  socket.emit('start-game', ui.roomId);
}

async function endDrawing() {
  const confirmed = await showModal('描画終了', '描画を終了しますか?');
  if (confirmed) {
    socket.emit('end-drawing', ui.roomId);
  }
}

function submitGuess() {
  if (!selectedCategory) {
    ui.showError('カテゴリを選択してください');
    return;
  }

  socket.emit('submit-guess', {
    roomId: ui.roomId,
    guess: selectedCategory
  });
}

function selectCategory(category) {
  socket.emit('select-category', {
    roomId: ui.roomId,
    category: category
  });
}

window.selectCategory = selectCategory;

function nextRound() {
  socket.emit('next-round', ui.roomId);
}

// Settings visibility
function updateSettingsVisibility(isHost) {
  const inputs = document.querySelectorAll('#settings-card input, #settings-card select');
  const updateBtn = document.getElementById('update-settings-btn');
  const hostBadge = document.getElementById('host-only-badge');
  
  inputs.forEach(input => {
    input.disabled = !isHost;
  });
  
  if (isHost) {
    updateBtn.style.display = 'block';
    hostBadge.classList.remove('hidden');
  } else {
    updateBtn.style.display = 'none';
    hostBadge.classList.add('hidden');
  }
}
