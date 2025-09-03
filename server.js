import express from "express";
import mongoose from "mongoose";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(cors());

// ===== MongoDB Setup =====
const mongoUri = process.env.MONGO_URI;
await mongoose.connect(mongoUri, { useNewUrlParser: true, useUnifiedTopology: true });

const trailSchema = new mongoose.Schema({
  flightId: String,
  points: [
    {
      lat: Number,
      lon: Number,
      timestamp: Date
    }
  ]
});

const Trail = mongoose.model("Trail", trailSchema);

// ===== Helpers =====
function makeId(f) {
  return `${f.network}:${f.cid || f.callsign || Math.random().toString(36).slice(2)}`;
}

function normalize(f, network) {
  return {
    id: makeId(f),
    network,
    cid: f.cid || null,
    callsign: f.callsign || f.flight_id || "N/A",
    latitude: f.latitude,
    longitude: f.longitude,
    altitude: f.altitude || 0,
    groundspeed: f.groundspeed || 0,
    heading: f.heading || 0,
    timestamp: new Date()
  };
}

// ===== Live flights memory cache =====
let liveFlights = [];

// ===== Update flights every 5s =====
async function updateFlights() {
  try {
    const [ivaoRes, vatsimRes] = await Promise.all([
      fetch("https://api.ivao.aero/v2/tracker/whazzup"),
      fetch("https://data.vatsim.net/v3/vatsim-data.json")
    ]);
    const ivao = await ivaoRes.json();
    const vatsim = await vatsimRes.json();

    const flights = [];

    // IVAO
    if (ivao.clients) {
      for (const f of ivao.clients.pilots || []) {
        if (f.latitude && f.longitude) {
          flights.push(normalize(f, "IVAO"));
        }
      }
    }

    // VATSIM
    if (vatsim.pilots) {
      for (const f of vatsim.pilots) {
        if (f.latitude && f.longitude) {
          flights.push(normalize(f, "VATSIM"));
        }
      }
    }

    liveFlights = flights;

    // Save trails to MongoDB
    for (const f of flights) {
      const { id, latitude, longitude } = f;
      if (!latitude || !longitude) continue;

      await Trail.findOneAndUpdate(
        { flightId: id },
        { $push: { points: { lat: latitude, lon: longitude, timestamp: new Date() } } },
        { upsert: true }
      );

      // prune: keep last 200 points
      await Trail.updateOne(
        { flightId: id },
        { $push: { points: { $each: [], $slice: -200 } } }
      );
    }

    console.log(`[update] stored ${flights.length} flights`);
  } catch (err) {
    console.error("Error updating flights:", err);
  }
}

setInterval(updateFlights, 5000);
updateFlights();

// ===== Routes =====
app.get("/flights", (req, res) => {
  res.json(liveFlights);
});

app.get("/trails/:id", async (req, res) => {
  try {
    const t = await Trail.findOne({ flightId: req.params.id });
    res.json(t ? t.points : []);
  } catch (err) {
    res.status(500).json({ error: "db error" });
  }
});

// ===== Start =====
const port = process.env.PORT || 10000;
app.listen(port, () => console.log(`Server running on port ${port}`));
