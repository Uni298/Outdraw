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

    // Stop physics animation if leaving category-screen (or generally anytime we switch)
    // We only want it running while actively waiting in category-screen
    // Safest to stop it whenever switching screens, unless it's to the same screen?
    // But showScreen is usually called when switching.
    // However, if we are staying in category selection, we might want to keep it?
    // For simplicity, let's stop it here, and the specific logic in update() will restart it if needed.
    if (window.stopPhysicsAnimation) {
        window.stopPhysicsAnimation();
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

      if (!players) return; // Add check for players
      
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

    lists.forEach(list => {
      if (!list) return;

      list.innerHTML = '';

      // Calculate team scores
      let humanScore = 0;
      state.players.forEach(player => {
        humanScore += player.score;
      });
      const aiScore = state.aiScore || 0;

      // Human team score
      const humanItem = document.createElement('div');
      humanItem.className = 'score-item';
      humanItem.style.background = '#FF9446';
      humanItem.style.color = 'white';

      const humanName = document.createElement('div');
      humanName.className = 'score-name';
      humanName.textContent = '人間チーム';

      const humanValue = document.createElement('div');
      humanValue.className = 'score-value';
      humanValue.textContent = `${humanScore}点`;

      humanItem.appendChild(humanName);
      humanItem.appendChild(humanValue);
      list.appendChild(humanItem);

      // AI team score
      const aiItem = document.createElement('div');
      aiItem.className = 'score-item';
      aiItem.style.background = '#330634';
      aiItem.style.color = 'white';

      const aiName = document.createElement('div');
      aiName.className = 'score-name';
      aiName.textContent = 'AI';

      const aiValue = document.createElement('div');
      aiValue.className = 'score-value';
      aiValue.textContent = `${aiScore}点`;

      aiItem.appendChild(aiName);
      aiItem.appendChild(aiValue);
      list.appendChild(aiItem);
    });
    
    // Also update Header Scores in Results Screen
    const humanHeadEl = document.getElementById('result-head-human');
    const aiHeadEl = document.getElementById('result-head-ai');
    
    if (humanHeadEl) {
      let humanScore = 0;
      state.players.forEach(player => {
        humanScore += player.score;
      });
      humanHeadEl.querySelector('.score-num').textContent = `${humanScore}点`;
    }
    if (aiHeadEl) {
      aiHeadEl.querySelector('.score-num').textContent = `${state.aiScore || 0}点`;
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

    // Handle Canvas Size
    if (state.settings && state.settings.canvasWidth && state.settings.canvasHeight) {
        this.resizeCanvases(state.settings.canvasWidth, state.settings.canvasHeight);
    }
    
    // Handle Pause
    this.handlePauseState(state.isPaused);

    // Handle screen switching based on game state
    switch (state.gameState) {
      case 'lobby':
        document.getElementById('results-screen').classList.remove('visible'); // Reset visibility
        this.showScreen('room-screen');
        break;
      case 'category-selection':
        this.showScreen('category-screen');
        if (state.currentDrawer === myPlayerId) {
          // I am drawer
          document.getElementById('category-choices').style.display = 'grid'; // or flex/block
          document.getElementById('waiting-category').classList.add('hidden');
          this.updateCategoryChoices(state.categoryChoices);
          if (window.stopPhysicsAnimation) window.stopPhysicsAnimation();
        } else {
          // I am waiter
          document.getElementById('category-choices').style.display = 'none';
          document.getElementById('waiting-category').classList.remove('hidden');
          if (window.startPhysicsAnimation) window.startPhysicsAnimation();
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
        // Do NOT immediately show 'results-screen' here to prevent flash.
        // client.js handleResults (via handleGameState or event) will trigger the transition.
        // However, if we reload the page, we might be stuck in limbo if we don't show it.
        // Check if overlay is covering. If NOT covering, we should show it (e.g. refresh).
        // If overlay IS covering or melting, we leave it alone.
        const overlay = document.getElementById('transition-overlay');
        const overlayActive = overlay && (overlay.classList.contains('active') || overlay.classList.contains('melting'));
        
        // Always populate data
        this.showResults(state.results, state.results.correctAnswer, state.players);
        
        if (!overlayActive) {
           // If no transition happening, just show it (e.g. reload)
           this.showScreen('results-screen');
        }
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
    // Translate if available
    const translatedCorrect = window.translateCategory ? window.translateCategory(correctAnswer) : correctAnswer;
    document.getElementById('correct-answer').textContent = `正解: ${translatedCorrect}`;

    // Show human guesses
    const humanGuesses = document.getElementById('human-guesses');
    humanGuesses.innerHTML = '';

    if (!results.guesses || results.guesses.length === 0) {
      humanGuesses.innerHTML = '<p style="color: #7F8C8D;">回答なし</p>';
    } else {
      results.guesses.forEach(guess => {
        const item = document.createElement('div');
        item.className = 'guess-result-item';

        if (guess.guess.toLowerCase() === correctAnswer.toLowerCase()) {
          item.classList.add('correct');
        } else {
          item.classList.add('incorrect');
        }

        item.innerHTML = `
          <span>${guess.playerName} : ${guess.guess}</span>
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

      const translatedName = window.translateCategory ? window.translateCategory(pred.name) : pred.name;

      item.innerHTML = `
        <span><span class="ai-rank">${index + 1}位:</span> ${translatedName}</span>
      `;

      aiPredictions.appendChild(item);
    });

    // Render drawing
    const drawingContainer = document.getElementById('result-drawing-container');
    if (results.drawing && results.drawing.length > 0) {
      console.log('[UI] Rendering drawing with', results.drawing.length, 'strokes');
      
      // Use 800x600 temp canvas to match source coordinate system
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = 800;
      tempCanvas.height = 600;
      const ctx = tempCanvas.getContext('2d');
      
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 10; 
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      
      // No scaling needed since we use 800x600
      
      // Draw all strokes
      results.drawing.forEach((stroke, index) => {
        let xs, ys;
        // Handle both [[x...], [y...]] and { points: [[x...], [y...]] } formats
        if (Array.isArray(stroke) && stroke.length === 2 && Array.isArray(stroke[0])) {
            xs = stroke[0];
            ys = stroke[1];
        } else if (stroke && stroke.points && Array.isArray(stroke.points) && stroke.points.length === 2) {
            xs = stroke.points[0];
            ys = stroke.points[1];
        } else {
            return;
        }

        if (xs.length > 0) {
          ctx.beginPath();
          ctx.moveTo(xs[0], ys[0]);
          for (let i = 1; i < xs.length; i++) {
            ctx.lineTo(xs[i], ys[i]);
          }
          ctx.stroke();
        }
      });
      
      // Convert to PNG and display
      const img = document.createElement('img');
      img.src = tempCanvas.toDataURL('image/png');
      img.style.maxWidth = '100%';
      img.style.objectFit = 'contain';
      img.style.border = '1px solid #eee'; // Temporary border to see if container exists
      
      drawingContainer.innerHTML = '';
      drawingContainer.appendChild(img);
    } else {
      console.log('[UI] No drawing data found in results');
      drawingContainer.innerHTML = '<p style="color: #888;">描画データがありません</p>';
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

  populateRowFilters(containerId, onSelect) {
      const container = document.getElementById(containerId);
      if (!container) return;
      
      container.innerHTML = '';
      
      const rows = ['あ', 'か', 'さ', 'た', 'な', 'は', 'ま', 'や', 'ら', 'わ', '全て'];
      
      rows.forEach(row => {
         const btn = document.createElement('div');
         btn.className = 'row-filter-btn';
         btn.textContent = row;
         btn.onclick = () => {
             // Toggle active class
             container.querySelectorAll('.row-filter-btn').forEach(b => b.classList.remove('active'));
             btn.classList.add('active');
             
             onSelect(row === '全て' ? null : row);
         };
         
         if (row === '全て') btn.classList.add('active');
         
         container.appendChild(btn);
      });
  }
  
  handlePauseState(isPaused) {
      const overlayId = 'pause-overlay';
      let overlay = document.getElementById(overlayId);
      
      if (isPaused) {
          if (!overlay) {
              overlay = document.createElement('div');
              overlay.id = overlayId;
              overlay.style.position = 'fixed';
              overlay.style.top = '0';
              overlay.style.left = '0';
              overlay.style.width = '100%';
              overlay.style.height = '100%';
              overlay.style.background = 'rgba(0,0,0,0.5)';
              overlay.style.color = 'white';
              overlay.style.display = 'flex';
              overlay.style.justifyContent = 'center';
              overlay.style.alignItems = 'center';
              overlay.style.fontSize = '48px';
              overlay.style.fontWeight = 'bold';
              overlay.style.zIndex = '3000';
              overlay.textContent = 'PAUSED';
              document.body.appendChild(overlay);
          }
          overlay.style.display = 'flex';
          
          // Update button text
           ['drawing', 'guessing'].forEach(phase => {
              const btn = document.getElementById(`end-game-btn-${phase}`);
              if (btn) btn.textContent = '再開';
           });
          
      } else {
          if (overlay) overlay.style.display = 'none';
          
          // Update button text
           ['drawing', 'guessing'].forEach(phase => {
              const btn = document.getElementById(`end-game-btn-${phase}`);
              if (btn) btn.textContent = '中断';
           });
      }
  }
  
  resizeCanvases(width, height) {
      if (!width || !height) return;
      ['drawing-canvas', 'guess-canvas'].forEach(id => {
          const canvas = document.getElementById(id);
          if (canvas) {
              if (canvas.width !== width || canvas.height !== height) {
                  canvas.width = width;
                  canvas.height = height;
              }
          }
      });
  }
}

window.UIManager = UIManager;
