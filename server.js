// server.js
import express from 'express';
import fetch from 'node-fetch';
import cors from 'cors';

const app = express();
app.use(cors()); // allow cross-origin requests from your front-end

const PORT = process.env.PORT || 3000;

let flightsData = { ivao: [], vatsim: [] };
let trailsData = {}; // id -> array of points for trails
const TRAIL_MAX_POINTS = 120; // max points per aircraft

// --- Helpers to fetch IVAO ---
async function fetchIVAO() {
  try {
    const tokenRes = await fetch('https://ivao-token-server.onrender.com/token');
    const token = (await tokenRes.json()).token;
    const res = await fetch('https://api.ivao.aero/v2/tracker/whazzup', {
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' }
    });
    const js = await res.json();
    flightsData.ivao = js.clients.pilots.map(f => ({ ...f, network: 'IVAO' }));
  } catch (e) {
    console.error('IVAO fetch error:', e);
    flightsData.ivao = [];
  }
}

// --- Helpers to fetch VATSIM ---
async function fetchVATSIM() {
  try {
    const res = await fetch('https://data.vatsim.net/v3/vatsim-data.json');
    const js = await res.json();
    flightsData.vatsim = js.pilots.map(f => ({ ...f, network: 'VATSIM' }));
  } catch (e) {
    console.error('VATSIM fetch error:', e);
    flightsData.vatsim = [];
  }
}

// --- Update trails ---
function updateTrails(flights) {
  const now = Date.now();
  flights.forEach(f => {
    const id = f.network + ':' + (f.cid || f.userId || f.id || f.callsign || Math.random().toString(36).slice(2));
    const lat = f.latitude ?? f.lastTrack?.latitude;
    const lon = f.longitude ?? f.lastTrack?.longitude;
    const alt = f.altitude ?? f.lastTrack?.altitude;

    if (!lat || !lon) return;

    if (!trailsData[id]) trailsData[id] = [];
    trailsData[id].push({ lat, lon, alt, t: now });
    if (trailsData[id].length > TRAIL_MAX_POINTS) {
      trailsData[id].splice(0, trailsData[id].length - TRAIL_MAX_POINTS);
    }
  });
}

// --- Periodically fetch data ---
async function updateFlights() {
  await Promise.all([fetchIVAO(), fetchVATSIM()]);

  const allFlights = [...flightsData.ivao, ...flightsData.vatsim];
  updateTrails(allFlights);
}
setInterval(updateFlights, 15000); // every 15 seconds
updateFlights();

// --- API endpoints ---
app.get('/flights', (req, res) => {
  const allFlights = [...flightsData.ivao, ...flightsData.vatsim].map(f => {
    const id = f.network + ':' + (f.cid || f.userId || f.id || f.callsign || Math.random().toString(36).slice(2));
    return { ...f, trail: trailsData[id] || [] };
  });
  res.json(allFlights);
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
