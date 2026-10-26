# 5 Cards 🃏

Multiplayer card game for 2–5 players with bots, room codes, avatars, voice chat and statistics.
One Node server serves the page and runs every room over WebSockets. Made for a Render **Web Service**.

All files live at the top level of the repo (no folders).

## Files

| File | Purpose |
|---|---|
| `server.js` | Web server, WebSocket game server, voice-chat relay config |
| `package.json` | Dependencies and start command |
| `render.yaml` | Optional Render Blueprint (auto-fills the settings) |
| `index.html`, `style.css` | The page |
| `ui.js`, `net.js`, `audio.js`, `voice.js`, `stats.js`, `config.js` | Browser code |
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

## Voice chat

Tap the mic button (top bar) to join voice chat in the lobby or during a game. Tap it again to mute. Open ☰ → *Leave voice chat* to leave.
Audio goes directly between players (WebRTC); the server only relays the connection setup. A green ring shows who is talking.

- Needs `https` (Render provides it) and microphone permission.
- Works between most networks with the built-in STUN servers. Some mobile carriers, offices and strict routers block direct connections. For voice that works **between any two networks**, add a free TURN relay:

### Add a TURN relay (recommended)

**Option A: Cloudflare (free tier, credentials are minted automatically)**

1. In the Cloudflare dashboard open **Realtime → TURN Server** and create a TURN key.
2. Copy the **Key ID** and the **API Token** (shown once).
3. In Render open your service → **Environment** → add:
   - `CLOUDFLARE_TURN_KEY_ID` = the Key ID
   - `CLOUDFLARE_TURN_API_TOKEN` = the API token
4. Save. Render redeploys. New rooms now use the relay.

**Option B: any TURN server you already have**

| Variable | Value |
|---|---|
| `TURN_URLS` | e.g. `turn:turn.example.com:3478,turns:turn.example.com:443` |
| `TURN_USERNAME` and `TURN_CREDENTIAL` | the login for that server |
| *or* `TURN_SECRET` | the shared secret of a coturn server (`use-auth-secret`) |

The tokens stay on the server. Players only receive short-lived credentials.

## Statistics

The home page has a **Statistics** button. Every finished game (practice or online) is saved on your device:
games played, wins, losses, win/loss ratio, a win-rate donut and a win-rate trend line.
A win means you finished with the lowest score. Statistics are stored in your browser, so they do not follow you to another device or survive clearing site data.

## Free plan notes

- Sleeps after 15 minutes without traffic; the first visit afterwards can take about a minute.
- Open games ping the server every 20 seconds, so it stays awake during play.
- Rooms live in memory, so a restart ends games in progress.

## Rules

1. 52 cards + 2 jokers, 5 cards each. One card face up as the open card. Random starter, clockwise play.
2. Points: Joker 0, Ace 1, 2–9 face value, 10/J/Q/K = 10.
3. On your turn play one card, or several of the same rank, then take one card from the deck or the open card.
4. Instead of playing, call **SHOOK** if you think your hand is the lowest.
   - Everyone else always scores their hand total.
   - You are strictly lowest: you score **0**.
   - Someone has less than you: you score **50**.
   - Best other hand is exactly equal to yours (nobody lower): you score **your own hand total**.
5. The game ends when someone reaches 100. Lowest total wins.

## Hidden hands

Opponents' cards are never sent to your device. You only ever receive your own hand, the open pile, and counts of how many cards others hold. Hands are revealed only when someone calls SHOOK.

## Run locally

```
npm install
npm start     # http://localhost:10000
```
