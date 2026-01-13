const socket = io();
const ui = new UIManager();
let drawingCanvas = null;
let guessCanvas = null;
let currentGameState = null;
let timerInterval = null;
let categories = [];
let selectedCategory = null;

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
function populateCategoryList() {
  const categoryList = document.getElementById('category-list');
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
    item.onclick = () => selectCategoryForGuess(category);
    categoryList.appendChild(item);
  });
}

// Filter categories based on search
function filterCategories(searchTerm) {
  const items = document.querySelectorAll('.category-item');
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
    filterCategories(e.target.value);
  };

  // Results screen
  document.getElementById('next-round-btn').onclick = nextRound;

  // Finished screen
  document.getElementById('new-game-btn').onclick = () => {
    location.reload();
  };
}

// Socket event handlers
socket.on('room-created', (data) => {
  ui.roomId = data.roomId;
  ui.playerId = socket.id;
  ui.setHostControls(true);

  document.getElementById('room-code-display').textContent = data.roomId;
  ui.showScreen('room-screen');
});

socket.on('room-joined', (data) => {
  ui.roomId = data.roomId;
  ui.playerId = socket.id;
  ui.setHostControls(data.player.isHost);

  document.getElementById('room-code-display').textContent = data.roomId;

  // Update settings display
  document.getElementById('drawing-time').value = data.settings.drawingTimeSeconds;
  document.getElementById('guessing-time').value = data.settings.guessingTimeSeconds;
  document.getElementById('ai-top-n').value = data.settings.aiTopN;
  document.getElementById('max-rounds').value = data.settings.maxRounds;
  if (data.settings.activeCategoryCount) {
    document.getElementById('active-category-count').value = data.settings.activeCategoryCount;
  }

  ui.showScreen('room-screen');
});

socket.on('settings-updated', (settings) => {
  document.getElementById('drawing-time').value = settings.drawingTimeSeconds;
  document.getElementById('guessing-time').value = settings.guessingTimeSeconds;
  document.getElementById('ai-top-n').value = settings.aiTopN;
  document.getElementById('max-rounds').value = settings.maxRounds;
  if (settings.activeCategoryCount) {
    document.getElementById('active-category-count').value = settings.activeCategoryCount;
  }
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
  ui.update(state, ui.playerId);

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

  if (state.currentDrawer === ui.playerId) {
    // This player is drawing
    document.getElementById('current-category').textContent = state.currentCategory;
    document.getElementById('spectator-message').classList.add('hidden');
    document.getElementById('drawing-canvas').parentElement.style.display = 'block';
    drawingCanvas.enable();
  } else {
    // Spectating
    const drawer = state.players.find(p => p.id === state.currentDrawer);
    document.getElementById('drawer-name').textContent = drawer ? drawer.name : 'プレイヤー';
    document.getElementById('current-category').textContent = '???';
    document.getElementById('spectator-message').classList.remove('hidden');
    document.getElementById('drawing-canvas').parentElement.style.display = 'block';
    drawingCanvas.disable();
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
}

function handleResults(state) {
  // UI update handled by ui.update()
  stopTimer();
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
    ui.updateTimer(elementId, seconds);

    if (seconds === 0) {
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

function leaveRoom() {
  if (confirm('本当に退出しますか?')) {
    location.reload();
  }
}

function updateSettings() {
  const settings = {
    drawingTimeSeconds: parseInt(document.getElementById('drawing-time').value),
    guessingTimeSeconds: parseInt(document.getElementById('guessing-time').value),
    aiTopN: parseInt(document.getElementById('ai-top-n').value),
    maxRounds: parseInt(document.getElementById('max-rounds').value),
    activeCategoryCount: parseInt(document.getElementById('active-category-count').value)
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

function endDrawing() {
  if (confirm('描画を終了しますか?')) {
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
