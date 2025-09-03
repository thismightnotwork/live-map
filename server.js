import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;

// --- MongoDB schema ---
const trailSchema = new mongoose.Schema({
  id: String,
  network: String,
  callsign: String,
  points: [
    {
      lat: Number,
      lon: Number,
      alt: Number,
      t: Number,
    },
  ],
});

const Trail = mongoose.model("Trail", trailSchema);

// --- Connect MongoDB ---
mongoose.connect(MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log("MongoDB connected"))
.catch(err => console.error(err));

// --- Fetch IVAO token ---
async function getIVAOToken() {
  const res = await axios.get("https://ivao-token-server.onrender.com/token");
  return res.data.token;
}

// --- Fetch IVAO flights ---
async function fetchIVAO() {
  try {
    const token = await getIVAOToken();
    const res = await axios.get("https://api.ivao.aero/v2/tracker/whazzup", {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    return res.data.clients.pilots.map(f => ({ ...f, network: "IVAO" }));
  } catch (err) {
    console.error("IVAO fetch error:", err);
    return [];
  }
}

// --- Fetch VATSIM flights ---
async function fetchVATSIM() {
  try {
    const res = await axios.get("https://data.vatsim.net/v3/vatsim-data.json");
    return res.data.pilots.map(f => ({ ...f, network: "VATSIM" }));
  } catch (err) {
    console.error("VATSIM fetch error:", err);
    return [];
  }
}

// --- Update MongoDB trails ---
async function updateTrails(flights) {
  const currentIds = new Set();

  for (const f of flights) {
    const id = `${f.network}:${f.cid || f.userId || f.callsign || Math.random().toString(36).slice(2)}`;
    currentIds.add(id);

    const lat = f.latitude || f.lastTrack?.latitude;
    const lon = f.longitude || f.lastTrack?.longitude;
    const alt = f.altitude || f.lastTrack?.altitude;

    if (!lat || !lon) continue;

    let trail = await Trail.findOne({ id });
    if (!trail) {
      trail = new Trail({ id, network: f.network, callsign: f.callsign, points: [] });
    }

    trail.points.push({ lat, lon, alt, t: Date.now() });

    // Keep last 120 points
    if (trail.points.length > 120) trail.points.splice(0, trail.points.length - 120);

    await trail.save();
  }

  // Remove trails for disconnected aircraft
  await Trail.deleteMany({ id: { $nin: Array.from(currentIds) } });
}

// --- Routes ---
app.get("/flights", async (req, res) => {
  try {
    const [ivao, vatsim] = await Promise.all([fetchIVAO(), fetchVATSIM()]);
    const flights = [...ivao, ...vatsim];

    await updateTrails(flights);

    const trails = await Trail.find({});
    res.json({ flights, trails });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch flights" });
  }
});

// --- Start server ---
app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));
