import express from "express";
import axios from "axios";
import cors from "cors";
import dotenv from "dotenv";
import { mapRecordChoices } from "../utils/choiceMapper.js";
import { getCache, setCache } from "../utils/cache.js";

dotenv.config();

const app = express();

app.use(
  cors({
    origin: "*",
    methods: ["GET"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

app.use(express.json());

const KOBO_URL =
  "https://kf.kobotoolbox.org/api/v2/assets/axiToevLp9NRbpQvzMBKV3/data/?format=json&attachments=true";

const CACHE_KEY = "facilities";
const CACHE_TTL = 300; // 5 minutes

// GET FACILITIES
// Supports pagination
// facilities?page=1&limit=100
app.get("/facilities", async (req, res) => {
  try {
    // const page = Number(req.query.page) || 1;
    // const limit = Number(req.query.limit) || 500;
    // const format = req.query.format || "json";

    // const cached = getCache(CACHE_KEY);

    // if (cached) {
    //   return sendFormattedResponse(res, cached, page, limit, format);
    // }

    const response = await axios.get(KOBO_URL, {
      headers: {
        Authorization: `Token ${process.env.KOBO_TOKEN}`,
      },
      timeout: 8000,
    });

    const raw = response.data?.results || response.data?.data || [];

    const cleaned = raw.map((rec) => {
      try {
        return mapRecordChoices(rec);
      } catch (err) {
        console.error("Mapping error:", err);
        return rec;
      }
    });

    setCache(CACHE_KEY, cleaned, CACHE_TTL);

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate");

    // return sendFormattedResponse(res, cleaned, page, limit, format);
  } catch (err) {
    console.error("Kobo fetch error:", err.response?.data || err);

    return res.status(500).json({
      error: "Failed to fetch facilities",
    });
  }
});

// function sendFormattedResponse(res, data, page, limit, format) {
//   const paginated = paginate(data, page, limit);

//   if (format === "geojson") {
//     const geojson = {
//       type: "FeatureCollection",
//       features: paginated.data.map((rec) => ({
//         type: "Feature",
//         geometry: {
//           type: "Point",
//           coordinates: [rec.lng, rec.lat],
//         },
//         properties: {
//           ...rec,
//         },
//       })),
//     };

//     return res.json(geojson);
//   }

//   return res.json(paginated);
// }

// MEDIA PROXY
app.get("/media", async (req, res) => {
  try {
    const fileUrl = req.query.url;

    if (!fileUrl) {
      return res.status(400).json({
        error: "Missing media URL",
      });
    }

    const response = await axios.get(fileUrl, {
      headers: {
        Authorization: `Token ${process.env.KOBO_TOKEN}`,
      },
      responseType: "arraybuffer",
      timeout: 8000,
    });

    res.setHeader("Content-Type", response.headers["content-type"]);
    res.setHeader("Cache-Control", "public, max-age=86400");

    return res.send(response.data);
  } catch (err) {
    console.error("Media fetch error:", err.response?.data || err);

    return res.status(500).json({
      error: "Failed to fetch media",
    });
  }
});

// PAGINATION
// function paginate(data, page, limit) {
//   const start = (page - 1) * limit;
//   const end = page * limit;

//   return {
//     page,
//     limit,
//     total: data.length,
//     totalPages: Math.ceil(data.length / limit),
//     data: data.slice(start, end),
//   };
// }

export default app;
