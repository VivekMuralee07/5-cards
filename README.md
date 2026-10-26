# 5 Cards 🃏

Multiplayer card game for 2–5 players with bots, room codes and avatars.
One Node server serves the page and runs every room over WebSockets. Made for a Render **Web Service**.

All files live at the top level of the repo (no folders).

## Files

| File | Purpose |
|---|---|
| `server.js` | Web server and WebSocket game server |
| `package.json` | Dependencies and start command |
| `render.yaml` | Optional Render Blueprint (auto-fills the settings) |
| `index.html`, `style.css` | The page |
| `ui.js`, `net.js`, `audio.js`, `config.js` | Browser code |
| `engine.js`, `bot.js`, `room.js` | Rules, bots, rooms (used by both server and browser) |
| `.gitignore` | Optional |

## Deploy on Render

New → Web Service → connect this repo, then:

| Setting | Value |
|---|---|
| Runtime | Node |
| Build command | `npm install` |
| Start command | `npm start` |
| Health check path | `/healthz` |
| Instance type | Free (or Starter to stop sleeping) |

Or use New → Blueprint and let `render.yaml` fill these in.

## Free plan notes

- Sleeps after 15 minutes without traffic; the first visit afterwards can take about a minute.
- Open games ping the server every 20 seconds, so it stays awake during play.
- Rooms live in memory, so a restart ends games in progress.

## Rules

1. 52 cards + 2 jokers, 5 cards each. One card face up as the open card. Random starter, clockwise play.
2. Points: Joker 0, Ace 1, 2–9 face value, 10/J/Q/K = 10.
3. On your turn play one card, or several of the same rank, then take one card from the deck or the open card.
4. Instead of playing, call **SHOOK** if you think your hand is the lowest.
   - Strictly lowest: you score 0, others score their hand total.
   - Anyone has the same or less: you score 50, others score their hand total.
5. The game ends when someone reaches 100. Lowest total wins.

## Run locally

```
npm install
npm start     # http://localhost:10000
```
