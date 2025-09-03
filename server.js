import express from "express";
import fetch from "node-fetch";
import { WebSocketServer } from "ws";

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files (your HTML page)
app.use(express.static("public"));

// Store aircraft data in memory
// id -> { flightData, trail: [{lat, lon, alt, t}] }
const aircraftStore = new Map();

// Fetch intervals (15s)
const REFRESH_MS = 15000;
const TRAIL_MAX_POINTS = 120;
const TRAIL_PRUNE_MS = 60 * 60 * 1000; // 1 hour

// Helper: Generate unique ID
function idFor(f) {
  const cid = f.cid || f.userId || f.id;
  return `${f.network}:${cid || f.callsign || Math.random().toString(36).slice(2)}`;
}

// Fetch IVAO flights
async function getIVAOFlights() {
  try {
    const tokenRes = await fetch('https://ivao-token-server.onrender.com/token');
    const token = (await tokenRes.json()).token;
    const res = await fetch('https://api.ivao.aero/v2/tracker/whazzup', {
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' }
    });
    const js = await res.json();
    return js.clients.pilots.map(f => ({ ...f, network: 'IVAO' }));
  } catch (e) { console.error('IVAO fetch error:', e); return []; }
}

// Fetch VATSIM flights
async function getVATSIMFlights() {
  try {
    const res = await fetch('https://data.vatsim.net/v3/vatsim-data.json');
    const js = await res.json();
    return js.pilots.map(f => ({ ...f, network: 'VATSIM' }));
  } catch (e) { console.error('VATSIM fetch error:', e); return []; }
}

// Update stored aircraft
async function updateAircraftStore() {
  const [ivao, vatsim] = await Promise.all([getIVAOFlights(), getVATSIMFlights()]);
  const all = ivao.concat(vatsim);
  const now = Date.now();
  const seen = new Set();

  for (const f of all) {
    const id = idFor(f);
    seen.add(id);
    const pos = {
      lat: f.latitude ?? f.lastTrack?.latitude,
      lon: f.longitude ?? f.lastTrack?.longitude,
      alt: f.altitude ?? f.lastTrack?.altitude,
      t: now
    };

    if (!aircraftStore.has(id)) {
      aircraftStore.set(id, { flightData: f, trail: [pos] });
    } else {
      const entry = aircraftStore.get(id);
      entry.flightData = f;
      entry.trail.push(pos);
      if (entry.trail.length > TRAIL_MAX_POINTS) entry.trail.splice(0, entry.trail.length - TRAIL_MAX_POINTS);
      // prune old
      while (entry.trail.length && entry.trail[0].t < now - TRAIL_PRUNE_MS) entry.trail.shift();
    }
  }

  // Remove disconnected aircraft
  for (const id of aircraftStore.keys()) {
    if (!seen.has(id)) aircraftStore.delete(id);
  }

  // Broadcast updates
  broadcastAircraftData();
}

// --- WebSocket Server ---
const wss = new WebSocketServer({ noServer: true });
function broadcastAircraftData() {
  const data = Array.from(aircraftStore.values()).map(e => e.flightData);
  const payload = JSON.stringify({ flights: data });
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(payload);
  });
}

app.server = app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// Handle WebSocket upgrade
app.server.on('upgrade', (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});

// Start update loop
setInterval(updateAircraftStore, REFRESH_MS);
