const io = require('socket.io-client');

const socket = io('http://localhost:3000');

socket.on('connect', () => {
    console.log('Connected with ID:', socket.id);
    socket.emit('create-room', 'HostUser');
});

socket.on('room-created', (data) => {
    console.log('Room created:', data);
    setTimeout(() => {
        console.log('Starting game...');
        socket.emit('start-game', data.roomId);
    }, 1000);
});

socket.on('game-state', (state) => {
    console.log('Game State:', state.gameState);
    if (state.gameState === 'drawing') {
        console.log('Drawing phase. Clearing canvas check needed (manual).');
    }
});
