// Chat functionality
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const chatSendBtn = document.getElementById('chatSendBtn');
const chatBox = document.getElementById('chatBox');
const chatToggle = document.getElementById('chatToggle');
const chatPreview = document.getElementById('chatPreview');

let lastMessage = '';

// Toggle chat visibility
chatToggle.addEventListener('click', () => {
  chatBox.classList.toggle('minimized');
  chatToggle.textContent = chatBox.classList.contains('minimized') ? '▲' : '▼';
});

// Click header to toggle
document.getElementById('chatHeader').addEventListener('click', (e) => {
  if (e.target !== chatToggle) {
    chatToggle.click();
  }
});

// Add a chat message to the UI
function addChatMessage(username, message, isCurrentUser = false) {
  const messageDiv = document.createElement('div');
  messageDiv.className = `chat-message ${isCurrentUser ? 'user' : 'other'}`;
  
  // Always show username
  const usernameSpan = document.createElement('div');
  usernameSpan.className = 'username';
  usernameSpan.textContent = username;
  messageDiv.appendChild(usernameSpan);
  
  const messageText = document.createElement('div');
  messageText.textContent = message;
  messageDiv.appendChild(messageText);
  
  chatMessages.appendChild(messageDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  
  // Update preview
  lastMessage = `${username}: ${message}`;
  chatPreview.textContent = lastMessage;
}

// Send a chat message
function sendChatMessage() {
  const message = chatInput.value.trim();
  if (message === '') return;
  
  // Send to server via socket
  if (window.socket && window.socket.connected) {
    window.socket.emit('chat-message', { message });
    chatInput.value = '';
  }
}

// Event listeners
chatSendBtn.addEventListener('click', sendChatMessage);
chatInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    sendChatMessage();
  }
});

// Listen for chat messages from server
if (window.socket) {
  window.socket.on('chat-message', (data) => {
    const isCurrentUser = data.playerId === window.socket.id;
    addChatMessage(data.playerName, data.message, isCurrentUser);
  });
}

// Welcome message
addChatMessage('システム', 'チャットへようこそ!', false);
