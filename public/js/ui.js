// UI Management
class UIManager {
  constructor() {
    this.currentScreen = 'lobby-screen';
    this.isHost = false;
    this.playerId = null;
    this.roomId = null;
  }

  showScreen(screenId) {
    // Hide all screens
    document.querySelectorAll('.screen').forEach(screen => {
      screen.classList.remove('active');
    });

    // Show target screen
    const screen = document.getElementById(screenId);
    if (screen) {
      screen.classList.add('active');
      this.currentScreen = screenId;
    }
  }

  updatePlayerList(players, currentDrawerId = null) {
    const lists = [
      document.getElementById('player-list'),
      document.getElementById('game-player-list')
    ];

    lists.forEach(list => {
      if (!list) return;

      list.innerHTML = '';

      players.forEach(player => {
        const item = document.createElement('div');
        item.className = 'player-item';

        const icon = document.createElement('div');
        icon.className = 'player-icon';
        icon.textContent = player.name.charAt(0).toUpperCase();

        const name = document.createElement('div');
        name.className = 'player-name';
        name.textContent = player.name;

        item.appendChild(icon);
        item.appendChild(name);

        if (player.isHost) {
          const badge = document.createElement('span');
          badge.className = 'host-badge';
          badge.textContent = 'ホスト';
          item.appendChild(badge);
        }

        if (player.id === currentDrawerId) {
          const badge = document.createElement('span');
          badge.className = 'host-badge';
          badge.style.background = '#4A90E2';
          badge.style.color = 'white';
          badge.textContent = '描画中';
          item.appendChild(badge);
        }

        list.appendChild(item);
      });
    });
  }

  updateScoreList(players) {
    const lists = [
      document.getElementById('score-list'),
      document.getElementById('results-score-list'),
      document.getElementById('final-score-list')
    ];

    lists.forEach(list => {
      if (!list) return;

      list.innerHTML = '';

      // Sort by score
      const sorted = [...players].sort((a, b) => b.score - a.score);

      sorted.forEach((player, index) => {
        const item = document.createElement('div');
        item.className = 'score-item';

        const nameDiv = document.createElement('div');
        nameDiv.className = 'score-name';
        nameDiv.textContent = `${index + 1}. ${player.name}`;

        const scoreDiv = document.createElement('div');
        scoreDiv.className = 'score-value';
        scoreDiv.textContent = `${player.score}点`;

        item.appendChild(nameDiv);
        item.appendChild(scoreDiv);
        list.appendChild(item);
      });
    });
  }

  update(state, myPlayerId) {
    this.roomId = state.roomId;

    // Players is already an array from server serialization
    const players = state.players;
    this.updatePlayerList(players, state.currentDrawer);
    this.updateScoreList(players);

    // Update host controls based on current state
    const me = players.find(p => p.id === myPlayerId);
    if (me) {
      this.setHostControls(me.isHost);
    }

    // Update timers and round info
    const roundSpan = document.getElementById('current-round');
    if (roundSpan) roundSpan.textContent = state.currentRound;
    const guessRoundSpan = document.getElementById('guess-round');
    if (guessRoundSpan) guessRoundSpan.textContent = state.currentRound;

    // Handle screen switching based on game state
    switch (state.gameState) {
      case 'lobby':
        this.showScreen('room-screen');
        break;
      case 'category-selection':
        this.showScreen('category-screen');
        if (state.currentDrawer === myPlayerId) {
          // I am drawer
          document.getElementById('category-choices').style.display = 'grid'; // or flex/block
          document.getElementById('waiting-category').classList.add('hidden');
          this.updateCategoryChoices(state.categoryChoices);
        } else {
          // I am waiter
          document.getElementById('category-choices').style.display = 'none';
          document.getElementById('waiting-category').classList.remove('hidden');
        }
        break;
      case 'drawing':
        if (state.currentDrawer === myPlayerId) {
          this.showScreen('drawing-screen');
          document.getElementById('spectator-message').classList.add('hidden');
        } else {
          this.showScreen('drawing-screen'); // Canvas is shared, but controls differ?
          // Actually client.js handles canvas interaction.
          // Spectator mode?
          document.getElementById('spectator-message').classList.remove('hidden');
          const drawerName = state.players.find(p => p.id === state.currentDrawer)?.name || 'Unknown';
          document.getElementById('drawer-name').textContent = drawerName;
        }
        // Update topic if available (usually visible to drawer, hidden for others?)
        // In Outdraw, usually drawer sees topic. Guessers see ???
        if (state.currentDrawer === myPlayerId) {
          document.getElementById('current-category').textContent = state.currentCategory;
        } else {
          document.getElementById('current-category').textContent = '???';
        }
        break;
      case 'guessing':
        this.showScreen('guessing-screen');
        // Update guess status?
        break;
      case 'results':
        this.showScreen('results-screen');
        this.showResults(state.results, state.results.correctAnswer, state.players);
        break;
      case 'finished':
        this.showScreen('finished-screen');
        break;
    }
  }

  updateCategoryChoices(choices) {
    const container = document.getElementById('category-choices');
    container.innerHTML = '';
    choices.forEach(choice => {
      const card = document.createElement('div');
      card.className = 'category-card';
      card.textContent = choice;
      card.onclick = () => {
        // Emit event via client.js? 
        // UI shouldn't emit directly usually, but callback? 
        // Or dispatch custom event?
        // `client.js` listens to clicks on `.category-item` in `populateCategoryList`?
        // No, this is `category-selection` phase (Drawer choosing 1 of 3).
        // Need a global handler or callback.
        // For now, let's assume `window.selectCategory(choice)` exists or dispatch event.
        // `client.js` needs to handle this.
        if (window.selectCategory) window.selectCategory(choice);
      };
      container.appendChild(card);
    });
  }


  updateTimer(elementId, seconds) {
    const timer = document.getElementById(elementId);
    if (!timer) return;

    timer.textContent = seconds;

    // Change color based on time
    timer.classList.remove('warning', 'danger');
    if (seconds <= 10) {
      timer.classList.add('danger');
    } else if (seconds <= 30) {
      timer.classList.add('warning');
    }
  }

  showCategoryChoices(categories, onSelect) {
    const container = document.getElementById('category-choices');
    container.innerHTML = '';

    categories.forEach(category => {
      const card = document.createElement('div');
      card.className = 'category-card';
      card.textContent = category;
      card.onclick = () => onSelect(category);
      container.appendChild(card);
    });
  }

  showWaitingForCategory() {
    document.getElementById('category-choices').classList.add('hidden');
    document.getElementById('waiting-category').classList.remove('hidden');
  }

  updateGuessedPlayers(players) {
    const list = document.getElementById('guessed-players');
    if (!list) return;

    list.innerHTML = '';

    players.forEach(player => {
      const item = document.createElement('div');
      item.className = 'guessed-player';
      item.textContent = `✓ ${player.name}`;
      list.appendChild(item);
    });
  }

  showResults(results, correctAnswer, players) {
    const winnerBanner = document.getElementById('winner-banner');
    const winnerText = document.getElementById('winner-text');

    // Update winner banner
    winnerBanner.className = 'winner-banner';
    if (results.winner === 'humans') {
      winnerText.textContent = '🎉 人間チームの勝利!';
    } else if (results.winner === 'ai') {
      winnerText.textContent = '🤖 AIの勝利...';
      winnerBanner.classList.add('ai-win');
    } else {
      winnerText.textContent = '引き分け';
      winnerBanner.classList.add('draw');
    }

    // Show correct answer
    document.getElementById('correct-answer').textContent = correctAnswer;

    // Show human guesses
    const humanGuesses = document.getElementById('human-guesses');
    humanGuesses.innerHTML = '';

    if (results.allGuesses.length === 0) {
      humanGuesses.innerHTML = '<p style="color: #7F8C8D;">回答なし</p>';
    } else {
      results.allGuesses.forEach(guess => {
        const item = document.createElement('div');
        item.className = 'guess-result-item';

        if (guess.guess.toLowerCase() === correctAnswer.toLowerCase()) {
          item.classList.add('correct');
        } else {
          item.classList.add('incorrect');
        }

        item.innerHTML = `
          <span>${guess.playerName}</span>
          <span>${guess.guess}</span>
        `;

        humanGuesses.appendChild(item);
      });
    }

    // Show AI predictions
    const aiPredictions = document.getElementById('ai-predictions');
    aiPredictions.innerHTML = '';

    results.aiPredictions.forEach((pred, index) => {
      const item = document.createElement('div');
      item.className = 'ai-prediction';

      if (pred.name.toLowerCase() === correctAnswer.toLowerCase()) {
        item.classList.add('match');
      }

      item.innerHTML = `
        <span><span class="ai-rank">${index + 1}位:</span> ${pred.name}</span>
        <span style="font-size: 0.85rem; color: #7F8C8D;">距離: ${pred.distance.toFixed(2)}</span>
      `;

      aiPredictions.appendChild(item);
    });

    // Visualize AI Input Debug
    if (results.aiInputDebug && results.aiInputDebug.length === 1024) {
      let debugContainer = document.getElementById('ai-debug-container');
      if (!debugContainer) {
        debugContainer = document.createElement('div');
        debugContainer.id = 'ai-debug-container';
        debugContainer.style.marginTop = '10px';
        debugContainer.innerHTML = '<h4>AIが見た画像 (32x32)</h4><canvas id="ai-debug-canvas" width="64" height="64" style="border:1px solid #ccc; image-rendering: pixelated;"></canvas>';
        document.getElementById('ai-predictions').parentNode.appendChild(debugContainer);
      }

      const canvas = document.getElementById('ai-debug-canvas');
      if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, 64, 64);
        // Draw 32x32 data scaled to 64x64
        const data = results.aiInputDebug;
        for (let y = 0; y < 32; y++) {
          for (let x = 0; x < 32; x++) {
            const val = data[y * 32 + x]; // 0.0-1.0 (Blackness)
            // Invert back to grayscale color (0=Black, 1=White for display? No, 1.0 is Blackness. So 0 is White.)
            // val=1.0 -> Black (0). val=0.0 -> White (255).
            const color = Math.floor((1.0 - val) * 255);
            ctx.fillStyle = `rgb(${color},${color},${color})`;
            ctx.fillRect(x * 2, y * 2, 2, 2);
          }
        }
      }
    }
  }

  setHostControls(isHost) {
    this.isHost = isHost;

    const settingsCard = document.getElementById('settings-card');
    const startBtn = document.getElementById('start-game-btn');
    const nextRoundBtn = document.getElementById('next-round-btn');
    const waitingNext = document.getElementById('waiting-next');

    if (isHost) {
      if (settingsCard) settingsCard.style.display = 'block';
      if (startBtn) startBtn.style.display = 'block';
      if (nextRoundBtn) nextRoundBtn.style.display = 'block';
      if (waitingNext) waitingNext.classList.add('hidden');
    } else {
      if (settingsCard) settingsCard.style.display = 'none';
      if (startBtn) startBtn.style.display = 'none';
      if (nextRoundBtn) nextRoundBtn.style.display = 'none';
      if (waitingNext) waitingNext.classList.remove('hidden');
    }
  }

  showError(message) {
    alert(message);
  }

  showSuccess(message) {
    // Could implement a toast notification here
    console.log('Success:', message);
  }
}

window.UIManager = UIManager;
