# 🐟 Go Fish — Multiplayer Online

A real-time multiplayer Go Fish card game. Play with 2–6 friends online!

---

## 🚀 Quick Start (Local)

```bash
# 1. Install dependencies
npm install

# 2. Start the server
npm start

# 3. Open in browser
# http://localhost:3000

# Share your local IP with friends on the same WiFi:
# http://192.168.x.x:3000
```

---

## 🌐 Deploy Online (Free)

### Option A: Render.com (Recommended)

1. Push this folder to a **GitHub repo**
2. Go to [render.com](https://render.com) → New → Web Service
3. Connect your GitHub repo
4. Set these options:
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Environment:** Node
5. Deploy — you'll get a URL like `https://gofish-xyz.onrender.com`

### Option B: Railway.app

1. Push to GitHub
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Select your repo — it auto-detects Node.js
4. Railway gives you a live URL instantly

### Option C: Fly.io

```bash
npm install -g flyctl
fly auth login
fly launch
fly deploy
```

---

## 🎮 How to Play

1. **Create a Room** — Enter your name and click "Create Game"
2. **Share the Code** — Give the 5-letter room code to friends
3. **Friends Join** — They enter the code on the same URL
4. **Host Starts** — Once 2+ players are ready, host clicks "Start Game"

### Go Fish Rules
- Each player gets 7 cards (5 if 4+ players)
- On your turn: **select an opponent** → **pick a rank** → **Ask!**
- If they have that rank → you get those cards and go again!
- If they don't → **Go Fish!** Draw from the deck
- If you draw the rank you asked for → go again!
- Collect all 4 of a rank = **Book** 📚
- Most books when the deck runs out = **Winner!** 🏆

---

## 📁 Project Structure

```
gofish/
├── server.js        ← Node.js + Socket.IO backend
├── package.json     ← Dependencies
├── public/
│   └── index.html   ← Full frontend (HTML/CSS/JS)
└── README.md
```

---

## 🛠️ Tech Stack

- **Backend:** Node.js, Express, Socket.IO
- **Frontend:** Vanilla HTML/CSS/JavaScript
- **Real-time:** WebSockets via Socket.IO
- **Hosting:** Any Node.js host (Render, Railway, Fly.io)
