const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.static(path.join(__dirname, 'public')));

// ─── Game State ───────────────────────────────────────────────────────────────
const rooms = {}; // roomCode → room object

const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
const SUITS = ['♠','♥','♦','♣'];

function createDeck() {
  const deck = [];
  for (const rank of RANKS) {
    for (const suit of SUITS) {
      deck.push({ rank, suit, id: `${rank}${suit}` });
    }
  }
  return shuffle(deck);
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function dealCards(deck, playerCount) {
  const handSize = playerCount <= 3 ? 7 : 5;
  const hands = {};
  const players = [];
  // will be filled in after we know who's in the room
  return { handSize, deck };
}

function checkBooks(hand) {
  const books = [];
  const rankCounts = {};
  for (const card of hand) {
    rankCounts[card.rank] = (rankCounts[card.rank] || 0) + 1;
  }
  for (const [rank, count] of Object.entries(rankCounts)) {
    if (count === 4) books.push(rank);
  }
  const newHand = hand.filter(c => !books.includes(c.rank));
  return { newHand, books };
}

function createRoom(hostId, hostName) {
  // Generate a short memorable room code
  const code = Math.random().toString(36).substr(2, 5).toUpperCase();
  rooms[code] = {
    code,
    hostId,
    phase: 'lobby', // lobby | playing | ended
    players: [{ id: hostId, name: hostName, books: [], isHost: true }],
    hands: {},
    deck: [],
    currentTurn: 0,
    log: [],
    winner: null,
  };
  return rooms[code];
}

function startGame(room) {
  room.deck = createDeck();
  room.phase = 'playing';
  room.currentTurn = 0;
  room.log = [];
  room.winner = null;
  room.waitingForDraw = null;

  const handSize = room.players.length <= 3 ? 7 : 5;
  for (const p of room.players) {
    p.books = [];
    room.hands[p.id] = room.deck.splice(0, handSize);
  }

  // Check initial books
  for (const p of room.players) {
    const { newHand, books } = checkBooks(room.hands[p.id]);
    room.hands[p.id] = newHand;
    if (books.length) {
      p.books.push(...books);
      room.log.push(`🃏 ${p.name} started with a book of ${books.join(', ')}!`);
    }
  }

  addLog(room, `🐟 Game started! ${room.players[0].name} goes first.`);
}

function addLog(room, msg) {
  room.log.unshift(msg);
  if (room.log.length > 30) room.log.pop();
}

function getRoomState(room, viewingPlayerId) {
  return {
    code: room.code,
    phase: room.phase,
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      isHost: p.isHost,
      books: p.books,
      cardCount: (room.hands[p.id] || []).length,
      isCurrentTurn: room.players[room.currentTurn]?.id === p.id,
    })),
    myHand: room.hands[viewingPlayerId] || [],
    deckCount: room.deck.length,
    currentTurnPlayerId: room.players[room.currentTurn]?.id,
    log: room.log,
    winner: room.winner,
    waitingForDraw: room.waitingForDraw || null, // playerId who must pick from deck
  };
}

function broadcastState(room) {
  for (const player of room.players) {
    const socketId = player.socketId;
    if (socketId) {
      io.to(socketId).emit('gameState', getRoomState(room, player.id));
    }
  }
}

function findRoomByPlayerId(playerId) {
  return Object.values(rooms).find(r => r.players.some(p => p.id === playerId));
}

function checkGameOver(room) {
  // Game ends when all 13 books are claimed
  const totalBooks = room.players.reduce((sum, p) => sum + p.books.length, 0);
  if (totalBooks === 13) {
    room.phase = 'ended';
    const sorted = [...room.players].sort((a, b) => b.books.length - a.books.length);
    room.winner = sorted[0];
    addLog(room, `🏆 Game over! ${room.winner.name} wins with ${room.winner.books.length} books!`);
    return true;
  }

  // Also check: all players have no cards and deck empty
  const anyCards = room.players.some(p => (room.hands[p.id] || []).length > 0);
  if (!anyCards && room.deck.length === 0) {
    room.phase = 'ended';
    const sorted = [...room.players].sort((a, b) => b.books.length - a.books.length);
    room.winner = sorted[0];
    addLog(room, `🏆 Game over! ${room.winner.name} wins with ${room.winner.books.length} books!`);
    return true;
  }
  return false;
}

function replenishHand(room, playerId) {
  const hand = room.hands[playerId];
  if (hand.length === 0 && room.deck.length > 0) {
    const drawn = room.deck.splice(0, 1);
    hand.push(...drawn);
    const player = room.players.find(p => p.id === playerId);
    addLog(room, `♻️ ${player.name}'s hand was empty — drew a card from the deck.`);
    // check books
    const { newHand, books } = checkBooks(hand);
    room.hands[playerId] = newHand;
    if (books.length) {
      player.books.push(...books);
      addLog(room, `📚 ${player.name} completed a book of ${books.join(', ')}!`);
    }
  }
}

// ─── Socket Events ─────────────────────────────────────────────────────────────
io.on('connection', (socket) => {

  socket.on('createRoom', ({ name }) => {
    const playerId = uuidv4();
    const room = createRoom(playerId, name);
    room.players[0].socketId = socket.id;
    room.players[0].playerId = playerId;
    socket.join(room.code);
    socket.emit('roomCreated', { roomCode: room.code, playerId });
    broadcastState(room);
  });

  socket.on('joinRoom', ({ name, roomCode }) => {
    const code = roomCode.toUpperCase().trim();
    const room = rooms[code];
    if (!room) {
      socket.emit('error', { message: 'Room not found. Check the code and try again.' });
      return;
    }
    if (room.phase !== 'lobby') {
      socket.emit('error', { message: 'Game already in progress!' });
      return;
    }
    if (room.players.length >= 6) {
      socket.emit('error', { message: 'Room is full (max 6 players).' });
      return;
    }

    const playerId = uuidv4();
    room.players.push({ id: playerId, name, books: [], isHost: false, socketId: socket.id });
    socket.join(code);
    socket.emit('roomJoined', { roomCode: code, playerId });

    addLog(room, `👋 ${name} joined the room!`);
    broadcastState(room);
  });

  socket.on('rejoinRoom', ({ roomCode, playerId }) => {
    const room = rooms[roomCode];
    if (!room) return;
    const player = room.players.find(p => p.id === playerId);
    if (!player) return;
    player.socketId = socket.id;
    socket.join(roomCode);
    socket.emit('gameState', getRoomState(room, playerId));
  });

  socket.on('startGame', ({ roomCode, playerId }) => {
    const room = rooms[roomCode];
    if (!room) return;
    const player = room.players.find(p => p.id === playerId);
    if (!player?.isHost) return;
    if (room.players.length < 2) {
      socket.emit('error', { message: 'Need at least 2 players to start!' });
      return;
    }
    startGame(room);
    broadcastState(room);
  });

  socket.on('askCard', ({ roomCode, playerId, targetId, rank }) => {
    const room = rooms[roomCode];
    if (!room || room.phase !== 'playing') return;

    const currentPlayer = room.players[room.currentTurn];
    if (currentPlayer.id !== playerId) return; // not your turn

    const asker = room.players.find(p => p.id === playerId);
    const target = room.players.find(p => p.id === targetId);
    if (!asker || !target) return;

    // Validate asker has at least one card of that rank
    const askerHand = room.hands[playerId];
    if (!askerHand.some(c => c.rank === rank)) {
      socket.emit('error', { message: `You must have at least one ${rank} to ask for it!` });
      return;
    }

    const targetHand = room.hands[targetId];
    const matching = targetHand.filter(c => c.rank === rank);

    if (matching.length > 0) {
      // Transfer cards
      room.hands[targetId] = targetHand.filter(c => c.rank !== rank);
      room.hands[playerId].push(...matching);

      addLog(room, `🎯 ${asker.name} asked ${target.name} for ${rank}s — got ${matching.length} card${matching.length > 1 ? 's' : ''}!`);

      // Check books for asker
      const { newHand, books } = checkBooks(room.hands[playerId]);
      room.hands[playerId] = newHand;
      if (books.length) {
        asker.books.push(...books);
        addLog(room, `📚 ${asker.name} completed a book of ${books.join(', ')}!`);
      }

      // Replenish target if empty
      replenishHand(room, targetId);

      if (!checkGameOver(room)) {
        // Asker gets another turn (lucky!)
        addLog(room, `✨ ${asker.name} goes again!`);
      }
    } else {
      // Go Fish! — player must pick a card from the deck themselves
      addLog(room, `🐟 ${asker.name} asked ${target.name} for ${rank}s — Go Fish!`);
      if (room.deck.length > 0) {
        // Set a pending state: this player must pick from the deck
        room.waitingForDraw = { playerId, askedRank: rank, targetId };
        addLog(room, `🎴 ${asker.name}, pick a card from the deck!`);
      } else {
        addLog(room, `🎣 No cards left in the deck!`);
        if (!checkGameOver(room)) {
          room.currentTurn = (room.currentTurn + 1) % room.players.length;
          addLog(room, `⏭️ ${room.players[room.currentTurn].name}'s turn.`);
        }
      }
    }

    broadcastState(room);
  });

  // Player picks a card from the scattered deck
  socket.on('drawCard', ({ roomCode, playerId }) => {
    const room = rooms[roomCode];
    if (!room || room.phase !== 'playing') return;
    if (!room.waitingForDraw || room.waitingForDraw.playerId !== playerId) return;
    if (room.deck.length === 0) return;

    const asker = room.players.find(p => p.id === playerId);
    const askedRank = room.waitingForDraw.askedRank;
    room.waitingForDraw = null;

    // Draw a random card from the deck (player "picks" any card — same result, fun UX)
    const randomIdx = Math.floor(Math.random() * room.deck.length);
    const drawn = room.deck.splice(randomIdx, 1);
    room.hands[playerId].push(...drawn);

    const drawnCard = drawn[0];
    addLog(room, `🃏 ${asker.name} drew the ${drawnCard.rank}${drawnCard.suit} from the deck.`);

    // Check books
    const { newHand, books } = checkBooks(room.hands[playerId]);
    room.hands[playerId] = newHand;
    if (books.length) {
      asker.books.push(...books);
      addLog(room, `📚 ${asker.name} completed a book of ${books.join(', ')}!`);
    }

    if (!checkGameOver(room)) {
      if (drawnCard.rank === askedRank) {
        addLog(room, `🍀 Lucky! ${asker.name} drew a ${askedRank} — goes again!`);
        // same player's turn
      } else {
        // Move to next turn
        room.currentTurn = (room.currentTurn + 1) % room.players.length;
        let tries = 0;
        while (
          room.deck.length === 0 &&
          (room.hands[room.players[room.currentTurn].id] || []).length === 0 &&
          tries < room.players.length
        ) {
          room.currentTurn = (room.currentTurn + 1) % room.players.length;
          tries++;
        }
        addLog(room, `⏭️ ${room.players[room.currentTurn].name}'s turn.`);
      }
    }

    broadcastState(room);
  });

  socket.on('sendChat', ({ roomCode, playerId, message }) => {
    const room = rooms[roomCode];
    if (!room) return;
    const player = room.players.find(p => p.id === playerId);
    if (!player) return;
    const trimmed = message.trim().slice(0, 200);
    if (!trimmed) return;
    addLog(room, `💬 ${player.name}: ${trimmed}`);
    broadcastState(room);
  });

  socket.on('playAgain', ({ roomCode, playerId }) => {
    const room = rooms[roomCode];
    if (!room) return;
    const player = room.players.find(p => p.id === playerId);
    if (!player?.isHost) return;
    room.phase = 'lobby';
    room.hands = {};
    room.deck = [];
    room.log = [];
    room.winner = null;
    room.waitingForDraw = null;
    for (const p of room.players) p.books = [];
    addLog(room, `🔄 ${player.name} reset the room. Ready to play again!`);
    broadcastState(room);
  });

  socket.on('disconnect', () => {
    // Mark player as disconnected but keep them in room
    for (const room of Object.values(rooms)) {
      const player = room.players.find(p => p.socketId === socket.id);
      if (player) {
        player.socketId = null;
        addLog(room, `⚡ ${player.name} disconnected.`);
        broadcastState(room);
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🐟 Go Fish server running on http://localhost:${PORT}\n`);
});
