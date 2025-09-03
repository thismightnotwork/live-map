import express from "express";
import cors from "cors";
import axios from "axios";
import { MongoClient } from "mongodb";

const app = express();
app.use(cors());
app.use(express.json());

// --- MongoDB ---
const uri = process.env.MONGO_URI;
const client = new MongoClient(uri);
const dbName = "skyreachDB";
let flightsCollection;

async function connectDB() {
  await client.connect();
  console.log("Connected to MongoDB");
  const db = client.db(dbName);
  flightsCollection = db.collection("flights");
}
connectDB();

// --- Fetch flights ---
async function getIVAOFlights() {
  try {
    const tokenRes = await axios.get('https://ivao-token-server.onrender.com/token');
    const token = tokenRes.data.token;
    const res = await axios.get('https://api.ivao.aero/v2/tracker/whazzup', {
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' }
    });
    return res.data.clients.pilots.map(f => ({ ...f, network: 'IVAO' }));
  } catch (e) {
    console.error("IVAO fetch error:", e.message);
    return [];
  }
}

async function getVATSIMFlights() {
  try {
    const res = await axios.get('https://data.vatsim.net/v3/vatsim-data.json');
    return res.data.pilots.map(f => ({ ...f, network: 'VATSIM' }));
  } catch (e) {
    console.error("VATSIM fetch error:", e.message);
    return [];
  }
}

// --- Update MongoDB ---
async function updateFlights() {
  const [ivao, vatsim] = await Promise.all([getIVAOFlights(), getVATSIMFlights()]);
  const allFlights = [...ivao, ...vatsim];
  const now = Date.now();

  for (let f of allFlights) {
    const id = `${f.network}:${f.cid || f.userId || f.callsign || Math.random().toString(36).slice(2)}`;
    const pos = {
      lat: f.latitude ?? f.lastTrack?.latitude,
      lon: f.longitude ?? f.lastTrack?.longitude,
      alt: f.altitude ?? f.lastTrack?.altitude,
      gs: f.groundspeed ?? f.lastTrack?.groundSpeed,
      hdg: f.heading ?? f.lastTrack?.heading,
      t: now
    };
    await flightsCollection.updateOne(
      { _id: id },
      { $push: { trail: pos }, $set: { callsign: f.callsign, network: f.network, lastSeen: now } },
      { upsert: true }
    );
  }

  await flightsCollection.deleteMany({ lastSeen: { $lt: now - 5 * 60 * 1000 } });
}

setInterval(updateFlights, 15000);

// --- API ---
app.get("/api/flights", async (req, res) => {
  const flights = await flightsCollection.find({}).toArray();
  res.json(flights);
});

app.get("/api/flights/:id", async (req, res) => {
  const flight = await flightsCollection.findOne({ _id: req.params.id });
  res.json(flight || null);
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
