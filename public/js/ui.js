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

  updateScoreList(state) {
    const lists = [
      document.getElementById('score-list'),
      document.getElementById('results-score-list'),
      document.getElementById('final-score-list')
    ];
    
    // Calculate Human Team Score
    const players = state.players || [];
    const humanScore = players.reduce((sum, p) => sum + p.score, 0);
    const aiScore = state.aiScore || 0;

    lists.forEach(list => {
      if (!list) return;

      list.innerHTML = '';

      // Human Team Item
      const humanItem = document.createElement('div');
      humanItem.className = 'score-item';
      humanItem.style.background = '#FF9446'; // Orange
      humanItem.style.color = 'white';
      
      const humanName = document.createElement('div');
      humanName.className = 'score-name';
      humanName.textContent = '人間チーム';
      
      const humanValue = document.createElement('div');
      humanValue.className = 'score-value';
      humanValue.style.color = 'white';
      humanValue.textContent = `${humanScore}点`;
      
      humanItem.appendChild(humanName);
      humanItem.appendChild(humanValue);
      list.appendChild(humanItem);
      
      // AI Team Item
      const aiItem = document.createElement('div');
      aiItem.className = 'score-item';
      aiItem.style.background = '#330634'; // Dark Purple
      aiItem.style.color = 'white';
      
      const aiName = document.createElement('div');
      aiName.className = 'score-name';
      aiName.textContent = 'AI';
      
      const aiValue = document.createElement('div');
      aiValue.className = 'score-value';
      aiValue.style.color = 'white';
      aiValue.textContent = `${aiScore}点`;
      
      aiItem.appendChild(aiName);
      aiItem.appendChild(aiValue);
      list.appendChild(aiItem);
    });
    
    // Also update Header Scores in Results Screen
    const humanHeadEl = document.getElementById('result-head-human');
    const aiHeadEl = document.getElementById('result-head-ai');
    
    if (humanHeadEl) {
      humanHeadEl.querySelector('.score-num').textContent = `${humanScore}点`;
    }
    if (aiHeadEl) {
      aiHeadEl.querySelector('.score-num').textContent = `${aiScore}点`;
    }
  }

  update(state, myPlayerId) {
    this.roomId = state.roomId;

    // Players is already an array from server serialization
    const players = state.players;
    this.updatePlayerList(players, state.currentDrawer);
    this.updateScoreList(state);

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
      `;

      aiPredictions.appendChild(item);
    });

    // Show drawing
    const drawingContainer = document.getElementById('result-drawing-container');
    if (drawingContainer && results.drawing) {
      drawingContainer.innerHTML = '';
      const canvas = document.createElement('canvas');
      canvas.width = 800;
      canvas.height = 600;
      
      // Calculate bounds to center and scale
      let minX = 800, maxX = 0, minY = 600, maxY = 0;
      let hasPoints = false;
      
      if (results.drawing && results.drawing.length > 0) {
        results.drawing.forEach(stroke => {
          if (stroke.points && stroke.points.length > 0) {
            stroke.points.forEach(p => {
              if (p.x < minX) minX = p.x;
              if (p.x > maxX) maxX = p.x;
              if (p.y < minY) minY = p.y;
              if (p.y > maxY) maxY = p.y;
              hasPoints = true;
            });
          }
        });
      }
      
      const ctx = canvas.getContext('2d');
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 5;
      ctx.strokeStyle = '#000';
      
      if (hasPoints) {
        const width = maxX - minX;
        const height = maxY - minY;
        const centerX = minX + width / 2;
        const centerY = minY + height / 2;
        
        // Add padding
        const paddedWidth = Math.max(width * 1.2, 100);
        const paddedHeight = Math.max(height * 1.2, 100);
        
        // Calculate scale to fit 800x600, then reduce by 10%
        const scaleX = 800 / paddedWidth;
        const scaleY = 600 / paddedHeight;
        const scale = Math.min(scaleX, scaleY, 3) * 0.9; // Scale down by 10%
        
        ctx.save();
        ctx.translate(400, 300);
        ctx.scale(scale, scale);
        ctx.translate(-centerX, -centerY);
        
        results.drawing.forEach(stroke => {
          if (!stroke.points || stroke.points.length < 2) return;
          ctx.beginPath();
          ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
          for (let i = 1; i < stroke.points.length; i++) {
            ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
          }
          ctx.stroke();
        });
        
        ctx.restore();
      } else {
        // No drawing data
        ctx.fillStyle = '#ccc';
        ctx.font = '30px BestTen';
        ctx.textAlign = 'center';
        ctx.fillText('描画なし', 400, 300);
      }
      
      drawingContainer.appendChild(canvas);
    }
  }

  setHostControls(isHost) {
    this.isHost = isHost;

    const settingsCard = document.getElementById('settings-card');
    const startBtn = document.getElementById('start-game-btn');
    const nextRoundBtn = document.getElementById('next-round-btn');
    const waitingNext = document.getElementById('waiting-next');

    if (isHost) {
      if (startBtn) startBtn.style.display = 'block';
      if (nextRoundBtn) nextRoundBtn.style.display = 'block';
      if (waitingNext) waitingNext.classList.add('hidden');
    } else {
      if (startBtn) startBtn.style.display = 'none';
      if (nextRoundBtn) nextRoundBtn.style.display = 'none';
      if (waitingNext) waitingNext.classList.remove('hidden');
    }
    
    // Always show settings card (inputs disabled in client.js for non-hosts)
    if (settingsCard) settingsCard.style.display = 'block';
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
