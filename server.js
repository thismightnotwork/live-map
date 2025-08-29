import express from 'express';
import fetch from 'node-fetch';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// --- Config ---
const REFRESH_MS = 15000; // fetch interval
const TRAIL_MAX_POINTS = 120;
const TRAIL_PRUNE_MS = 60 * 60 * 1000; // 1 hour

let flightsData = new Map(); // id -> { flight, trail: [{lat, lon, alt, t}] }

// --- Utils ---
function idFor(f) {
  const cid = f.cid || f.userId || f.id;
  return `${f.network}:${cid || f.callsign || Math.random().toString(36).slice(2)}`;
}

function getPos(f) {
  const lat = f.lastTrack?.latitude ?? f.latitude;
  const lon = f.lastTrack?.longitude ?? f.longitude;
  const alt = f.lastTrack?.altitude ?? f.altitude;
  return { lat, lon, alt };
}

// --- Fetch flights ---
async function fetchIVAO() {
  try {
    const tokenRes = await fetch('https://ivao-token-server.onrender.com/token');
    const token = (await tokenRes.json()).token;
    const res = await fetch('https://api.ivao.aero/v2/tracker/whazzup', {
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' }
    });
    const js = await res.json();
    return js.clients.pilots.map(f => ({ ...f, network: 'IVAO' }));
  } catch(e){ console.error('IVAO fetch error', e); return []; }
}

async function fetchVATSIM() {
  try {
    const res = await fetch('https://data.vatsim.net/v3/vatsim-data.json');
    const js = await res.json();
    return js.pilots.map(f => ({ ...f, network: 'VATSIM' }));
  } catch(e){ console.error('VATSIM fetch error', e); return []; }
}

// --- Update flights & trails ---
async function updateFlights() {
  const [ivao, vatsim] = await Promise.all([fetchIVAO(), fetchVATSIM()]);
  const all = ivao.concat(vatsim);
  const now = Date.now();

  const seen = new Set();

  all.forEach(f => {
    const id = idFor(f);
    seen.add(id);
    const pos = getPos(f);

    let entry = flightsData.get(id);
    if (!entry) {
      entry = { flight: f, trail: [] };
      flightsData.set(id, entry);
    } else {
      entry.flight = f;
    }

    if (pos.lat && pos.lon) {
      entry.trail.push({ lat: pos.lat, lon: pos.lon, alt: pos.alt, t: now });
      if (entry.trail.length > TRAIL_MAX_POINTS) entry.trail.splice(0, entry.trail.length - TRAIL_MAX_POINTS);

      // prune old
      entry.trail = entry.trail.filter(p => p.t > now - TRAIL_PRUNE_MS);
    }
  });

  // remove stale flights
  Array.from(flightsData.keys()).forEach(id => { if (!seen.has(id)) flightsData.delete(id); });
}

// start periodic update
setInterval(updateFlights, REFRESH_MS);
updateFlights();

// --- Endpoint ---
app.get('/flights', (req, res) => {
  const result = Array.from(flightsData.values()).map(v => ({
    flight: v.flight,
    trail: v.trail
  }));
  res.json(result);
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
