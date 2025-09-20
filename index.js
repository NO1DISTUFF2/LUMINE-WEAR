/*
BEYOND US — Prototype + Design

This single-file React app contains:
1) A concise Design Doc (below) describing gameplay, assets, UI, and networking plan.
2) A working client-only prototype (React) with local lobby, role assignment, basic map UI,
   task mini-games, voting/capture flow, and simple AI bots so you can test multiplayer logic
   without a server.
3) A small Node WebSocket server sketch (at the end) you can use later to convert to
   real-time multiplayer.

HOW TO RUN (client-only prototype)
- Create a new React app (Vite or CRA). Example with Vite: `npm create vite@latest beyond-us -- --template react`
- Replace `src/App.jsx` with the contents of this file (remove this big comment at top).
- Install dependencies (Tailwind optional). The UI uses Tailwind classnames; if you don't want to set Tailwind,
  the UI still works but styles will be basic. To keep things simple you may remove Tailwind classes.
- Start dev server: `npm install` then `npm run dev` (Vite) or `npm start` (CRA).

--- DESIGN DOC (short)
Title: BEYOND US (online social-deduction + survival)
Player counts: 3-8 (1 Alien, 1 Timmy Take-Me, rest CIA Agents)
Core loop:
  - Players move around town, complete tasks (Alien builds ship parts; CIA runs investigations),
  - Periodically players convene to discuss and vote to capture.
  - Timmy acts as a false-positive, planting fake clues.
Win conditions:
  - Alien: collect X ship parts AND escape, OR CIA captures Timmy.
  - CIA: capture Alien before escape.
  - Timmy: be captured (he wins automatically, but typically that helps Alien).
Key systems:
  - Roles & secrecy: assigned at game start, private info UI.
  - Tasks: small mini-games (wire matching, pattern memory, code-hacking) implemented here as simple puzzles.
  - Investigations: evidence tokens, surveillance camera checks, sample tests.
  - Voting/capture: discussion then vote phase; majority capture attempt.
  - AI Bots: used for testing; can behave suspiciously/randomly.
Networking plan (next steps):
  - Use a simple Node WebSocket server to relay player actions and sync game state.
  - Use authoritative server for role assignment and win checks.
  - TURN/ICE + WebRTC could be used for voice chat, or integrate WebRTC peer connections.

Assets & UI:
  - Simple 2D icons, avatars; use avatars + color-coded outlines.
  - Map: small town with labeled zones (Crash Site, Lab, Suburbs, Warehouse, CIA HQ).
  - HUD: role card, tasks list, evidence board, vote UI.

Accessibility & Moderation:
  - Toggle text chat-only for players who can't use voice.
  - Auto-mute reporting & simple profanity filter (later).


---------
Below is the React code for an interactive prototype. It's intentionally single-file with components.
Remove the surrounding comment when pasting into App.jsx.
*/

import React, { useEffect, useMemo, useState } from "react";

// Small helper utilities
const rand = (n) => Math.floor(Math.random() * n);

const ROLES = {
  ALIEN: "Alien",
  TIMMY: "Timmy",
  CIA: "CIA",
};

const ZONES = ["Crash Site", "Lab", "Suburbs", "Warehouse", "CIA HQ"];

// Simple AI behavior for bots
function useBots(botCount, onAction) {
  useEffect(() => {
    if (botCount <= 0) return;
    const intervals = [];
    for (let i = 0; i < botCount; i++) {
      const id = setInterval(() => {
        const act = rand(3);
        if (act === 0) onAction({ type: "move", bot: i, zone: ZONES[rand(ZONES.length)] });
        if (act === 1) onAction({ type: "task", bot: i });
        if (act === 2) onAction({ type: "investigate", bot: i });
      }, 2500 + rand(4000));
      intervals.push(id);
    }
    return () => intervals.forEach(clearInterval);
  }, [botCount, onAction]);
}

// Mini tasks
function WireMatch({ onComplete }) {
  const [left] = useState(["red", "green", "blue"].sort(() => Math.random() - 0.5));
  const [right] = useState(["red", "green", "blue"].sort(() => Math.random() - 0.5));
  const [pairs, setPairs] = useState({});

  const tryComplete = () => {
    if (Object.keys(pairs).length === 3) onComplete(true);
  };

  return (
    <div className="p-4">
      <div>Connect matching wires (click left then right)</div>
      <div className="flex gap-4 mt-3">
        <div>
          {left.map((c, i) => (
            <button
              key={i}
              onClick={() => setPairs((p) => ({ ...p, left: c }))}
              className="m-1 px-3 py-1 border rounded"
            >
              {c}
            </button>
          ))}
        </div>
        <div>
          {right.map((c, i) => (
            <button
              key={i}
              onClick={() => setPairs((p) => ({ ...p, right: c }))}
              className="m-1 px-3 py-1 border rounded"
            >
              {c}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-3">
        <button
          onClick={tryComplete}
          className="px-3 py-1 bg-blue-600 text-white rounded"
        >
          Attempt Complete
        </button>
      </div>
    </div>
  );
}

function MemoryPattern({ onComplete }) {
  const [sequence] = useState([rand(4) + 1, rand(4) + 1, rand(4) + 1]);
  const [pos, setPos] = useState(0);

  return (
    <div>
      <div>Repeat the short pattern.</div>
      <div className="flex gap-2 mt-3">
        {[1, 2, 3, 4].map((n) => (
          <button
            key={n}
            onClick={() => setPos((p) => p + 1) || (pos + 1 >= sequence.length && onComplete(true))}
            className="px-4 py-2 border rounded"
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

// Main App
export default function App() {
  const [players, setPlayers] = useState([]); // {id, name, role, isBot, zone}
  const [localName, setLocalName] = useState("Player");
  const [botCount, setBotCount] = useState(2);
  const [game, setGame] = useState(null); // game state object
  const [log, setLog] = useState([]);
  const [uiModal, setUiModal] = useState(null);

  useEffect(() => {
    // seed local players (host + bots) for quick testing
    const initial = [{ id: 0, name: "You", isBot: false }];
    for (let i = 0; i < botCount; i++) initial.push({ id: i + 1, name: `Bot ${i + 1}`, isBot: true });
    setPlayers(initial);
  }, [botCount]);

  const appendLog = (t) => setLog((l) => [t, ...l].slice(0, 100));

  // assign roles
  const assignRoles = () => {
    const shuffled = [...players].sort(() => Math.random() - 0.5);
    const roles = [];
    roles.push(ROLES.ALIEN);
    roles.push(ROLES.TIMMY);
    while (roles.length < players.length) roles.push(ROLES.CIA);
    const assigned = shuffled.map((p, i) => ({ ...p, role: roles[i], zone: ZONES[rand(ZONES.length)], shipParts: 0 }));
    setPlayers(assigned);
    setGame({ phase: "playing", shipPartsRequired: 5, shipPartsPlaced: 0, round: 1, votes: {} });
    appendLog("Roles assigned. Game started.");
  };

  // handle actions (from UI or bots)
  const handleAction = (playerId, action) => {
    if (!game) return;
    const player = players.find((p) => p.id === playerId);
    if (!player) return;

    if (action.type === "move") {
      setPlayers((ps) => ps.map((p) => (p.id === playerId ? { ...p, zone: action.zone } : p)));
      appendLog(`${player.name} moved to ${action.zone}`);
    }

    if (action.type === "startTask") {
      // open a simple task modal for the player
      setUiModal({ type: "task", player: playerId });
      appendLog(`${player.name} started a task.`);
    }

    if (action.type === "completeTask") {
      // if alien in a task-eligible zone, grant ship part
      if (player.role === ROLES.ALIEN && ["Crash Site", "Warehouse"].includes(player.zone)) {
        setGame((g) => ({ ...g, shipPartsPlaced: g.shipPartsPlaced + 1 }));
        appendLog(`${player.name} repaired a ship part! (${game.shipPartsPlaced + 1}/${game.shipPartsRequired})`);
      } else {
        appendLog(`${player.name} completed a neutral task.`);
      }
      setUiModal(null);
    }

    if (action.type === "investigate") {
      // simple investigation gives a hint: probability that target is alien
      const target = players[rand(players.length)];
      const hint = Math.random() < (target.role === ROLES.ALIEN ? 0.7 : 0.2);
      appendLog(`${player.name} investigated and found ${hint ? "suspicious evidence" : "nothing"} on ${target.name}`);
    }

    if (action.type === "vote") {
      setGame((g) => ({ ...g, votes: { ...g.votes, [playerId]: action.target } }));
      appendLog(`${player.name} voted to capture ${players.find((p) => p.id === action.target)?.name}`);
      // quick resolution if all voted
      const votesNow = { ...game.votes, [playerId]: action.target };
      if (Object.keys(votesNow).length === players.length) {
        resolveVotes(votesNow);
      }
    }
  };

  const resolveVotes = (votes) => {
    // find most-voted target
    const counts = {};
    Object.values(votes).forEach((t) => (counts[t] = (counts[t] || 0) + 1));
    let max = -1,
      chosen = null;
    Object.entries(counts).forEach(([k, v]) => {
      if (v > max) {
        max = v;
        chosen = Number(k);
      }
    });
    const target = players.find((p) => p.id === chosen);
    appendLog(`Vote result: ${target.name} was captured.`);
    // check role
    if (target.role === ROLES.ALIEN) {
      appendLog("Alien captured — CIA wins!");
      setGame((g) => ({ ...g, phase: "ended", winner: "CIA" }));
    } else if (target.role === ROLES.TIMMY) {
      appendLog("Timmy captured — Alien WINS instantly!");
      setGame((g) => ({ ...g, phase: "ended", winner: "Alien (via Timmy)" }));
    } else {
      appendLog("Captured a CIA agent. Game continues.");
      // remove captured CIA from players list
      setPlayers((ps) => ps.filter((p) => p.id !== chosen));
      setGame((g) => ({ ...g, votes: {}, round: g.round + 1 }));
    }
  };

  // bots
  useBots(players.filter((p) => p.isBot).length, (action) => {
    // map bot indexes to player id
    const botPlayers = players.filter((p) => p.isBot);
    if (botPlayers.length === 0) return;
    const bot = botPlayers[rand(botPlayers.length)];
    if (!bot) return;
    if (action.type === "move") handleAction(bot.id, { type: "move", zone: action.zone });
    if (action.type === "task") handleAction(bot.id, { type: "startTask" });
    if (action.type === "investigate") handleAction(bot.id, { type: "investigate" });
  });

  // UI helpers
  const joinAsLocal = () => {
    setPlayers((ps) => {
      if (ps.some((p) => p.name === localName)) return ps;
      return [{ id: Math.max(...ps.map((p) => p.id)) + 1, name: localName, isBot: false }, ...ps];
    });
  };

  // check win by shipParts
  useEffect(() => {
    if (!game) return;
    if (game.shipPartsPlaced >= game.shipPartsRequired && game.phase === "playing") {
      setGame((g) => ({ ...g, phase: "ended", winner: "Alien (escaped)" }));
      appendLog("Ship rebuilt — Alien escaped! Alien wins.");
    }
  }, [game?.shipPartsPlaced]);

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6">
      <div className="max-w-6xl mx-auto">
        <header className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold">BEYOND US — Prototype</h1>
          <div className="flex gap-2 items-center">
            <input value={localName} onChange={(e) => setLocalName(e.target.value)} className="px-2 py-1 rounded text-black" />
            <button onClick={joinAsLocal} className="px-3 py-1 bg-blue-600 rounded">Join</button>
            <label className="ml-2">Bots:</label>
            <input type="number" min={0} max={5} value={botCount} onChange={(e) => setBotCount(Number(e.target.value))} className="w-16 text-black px-1 py-1 rounded" />
            <button onClick={assignRoles} className="ml-2 px-3 py-1 bg-green-600 rounded">Start Game</button>
          </div>
        </header>

        <main className="grid grid-cols-3 gap-4">
          <section className="col-span-2 bg-gray-800 p-4 rounded">
            <h2 className="font-semibold">Map & Players</h2>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="p-2 bg-gray-700 rounded">
                <h3>Zones</h3>
                <div className="flex gap-2 mt-2">
                  {ZONES.map((z) => (
                    <div key={z} className="p-2 bg-gray-600 rounded w-28 text-center">
                      <div className="text-sm">{z}</div>
                      <div className="text-xs mt-2">
                        {players.filter((p) => p.zone === z).map((p) => (
                          <div key={p.id} className="text-left">{p.name} {p.isBot ? '(bot)' : ''}</div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="p-2 bg-gray-700 rounded">
                <h3>Players</h3>
                <div className="mt-2 space-y-1">
                  {players.map((p) => (
                    <div key={p.id} className="flex justify-between items-center p-1 bg-gray-600 rounded">
                      <div>{p.name} {p.isBot ? '(bot)' : ''}</div>
                      <div className="flex gap-1">
                        <button onClick={() => handleAction(p.id, { type: 'move', zone: ZONES[rand(ZONES.length)] })} className="px-2 py-0.5 rounded bg-indigo-600 text-sm">Move</button>
                        <button onClick={() => handleAction(p.id, { type: 'startTask' })} className="px-2 py-0.5 rounded bg-yellow-600 text-sm">Task</button>
                        <button onClick={() => handleAction(p.id, { type: 'investigate' })} className="px-2 py-0.5 rounded bg-red-600 text-sm">Investigate</button>
                        <button onClick={() => handleAction(p.id, { type: 'vote', target: players.find(pt=>pt.id!==p.id)?.id ?? p.id })} className="px-2 py-0.5 rounded bg-pink-600 text-sm">Vote</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="p-2 bg-gray-700 rounded col-span-2">
                <h3>Game State</h3>
                <div className="mt-2">Phase: {game?.phase ?? 'lobby'} | Round: {game?.round ?? '-'}</div>
                <div>Ship parts: {game?.shipPartsPlaced ?? 0}/{game?.shipPartsRequired ?? '-'}</div>
                <div>Winner: {game?.winner ?? '-'}</div>
              </div>
            </div>
          </section>

          <aside className="bg-gray-800 p-4 rounded">
            <h3 className="font-semibold">Log</h3>
            <div className="mt-2 h-64 overflow-auto space-y-2">
              {log.map((l, i) => (
                <div key={i} className="text-sm opacity-90">{l}</div>
              ))}
            </div>
          </aside>
        </main>

        <footer className="mt-4">
          <div className="flex gap-2">
            <button onClick={() => { setLog([]); setGame(null); setPlayers([]); appendLog('Reset.'); }} className="px-3 py-1 bg-gray-600 rounded">Reset</button>
            <button onClick={() => setUiModal({ type: 'rules' })} className="px-3 py-1 bg-gray-600 rounded">Rules / Design Doc</button>
          </div>
        </footer>

        {/* Modal area */}
        {uiModal && (
          <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center">
            <div className="bg-gray-800 p-4 rounded w-2/3">
              <button onClick={() => setUiModal(null)} className="float-right">Close</button>
              {uiModal.type === 'task' && (
                <div>
                  <h3>Task Mini-Game</h3>
                  <div className="mt-2">
                    {/* Randomly choose a task */}
                    <WireMatch onComplete={() => handleAction(uiModal.player, { type: 'completeTask' })} />
                  </div>
                </div>
              )}

              {uiModal.type === 'rules' && (
                <div className="prose text-gray-200">
                  <h2>Rules & Design Notes</h2>
                  <p>Roles: Alien (hidden), Timmy Take-Me (decoy), CIA Agents (seek to capture the alien).</p>
                  <p>Gameplay: Move, perform tasks, investigate, and vote periodically. Alien completes tasks near crash site/warehouse to get ship parts.</p>
                  <p>Victory: Ship fully repaired and launched = Alien win. If CIA captures Alien = CIA win. If CIA captures Timmy = Alien win.</p>
                </div>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

/*
--- Node WebSocket Server Sketch (for later conversion to real multiplayer)

// server.js (Node)
const http = require('http');
const WebSocket = require('ws');
const server = http.createServer();
const wss = new WebSocket.Server({ server });
let clients = [];

wss.on('connection', (ws) => {
  clients.push(ws);
  ws.on('message', (msg) => {
    // msg is JSON describing actions: join, move, task, vote
    // server validates and broadcasts to other clients
    const data = JSON.parse(msg);
    // naive broadcast
    clients.forEach(c=>{ if(c!==ws && c.readyState===WebSocket.OPEN) c.send(msg); })
  });
  ws.on('close', ()=>{ clients = clients.filter(c=>c!==ws); });
});

server.listen(8080);

Notes: Implement authoritative game state on server, handle reconnection, role secrecy by sending private messages for roles.
*/