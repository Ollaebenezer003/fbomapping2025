import express from "express";
import axios from "axios";
import cors from "cors";
import { mapRecordChoices } from "./utils/choiceMapper.js";

const app = express();

app.use(
  cors({
    origin: "https://fbomapping2025.vercel.app",
    methods: ["GET"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

app.use(express.json());

const KOBO_URL =
  "https://kf.kobotoolbox.org/api/v2/assets/axiToevLp9NRbpQvzMBKV3/data/?format=json";

// follow the next pagination link until it becomes null
async function fetchAllKoboData() {
  let url = KOBO_URL;
  let allRecords = [];

  while (url) {
    const response = await axios.get(url, {
      headers: {
        Authorization: `Token ${process.env.KOBO_TOKEN}`,
      },
      timeout: 10000,
    });

    const data = response.data;

    if (data?.results) {
      allRecords = allRecords.concat(data.results);
      url = data.next; // go to next page
    } else if (data?.data) {
      allRecords = allRecords.concat(data.data);
      url = null;
    } else {
      url = null;
    }
  }

  return allRecords;
}

// GET FACILITIES
app.get("/facilities", async (req, res) => {
  try {
    console.log("KOBO TOKEN:", process.env.KOBO_TOKEN ? "Loaded" : "Missing");
    // const response = await axios.get(KOBO_URL, {
    //   headers: {
    //     Authorization: `Token ${process.env.KOBO_TOKEN}`,
    //   },
    //   timeout: 10000,
    // });

    // const raw = response.data?.results || response.data?.data || [];

    const raw = await fetchAllKoboData();

    const cleaned = raw.map((rec) => {
      try {
        return mapRecordChoices(rec);
      } catch (err) {
        console.error("Error mapping record:", err);
        return rec;
      }
    });

    res.setHeader(
      "Cache-Control",
      "public, max-age=0, s-maxage=300, stale-while-revalidate=300",
    );

    return res.json(cleaned ?? []);
  } catch (err) {
    console.error("Error fetching Kobo data:", err.response?.data || err);

    return res.status(500).json({
      error: "Failed to fetch data from Kobo",
    });
  }
});

// MEDIA PROXY

app.get("/media", async (req, res) => {
  try {
    const fileUrl = req.query.url;

    if (!fileUrl) {
      return res.status(400).json({ error: "Missing url parameter" });
    }

    const response = await axios.get(fileUrl, {
      headers: {
        Authorization: `Token ${process.env.KOBO_TOKEN}`,
      },
      responseType: "arraybuffer",
      timeout: 10000,
    });

    res.setHeader("Content-Type", response.headers["content-type"]);
    res.setHeader("Cache-Control", "public, max-age=86400");

    return res.send(response.data);
  } catch (err) {
    console.error(
      "Media fetch error:",
      err.response?.status,
      err.response?.data,
    );

    return res.status(500).json({
      error: "Failed to load image",
    });
  }
});

export default function handler(req, res) {
  return app(req, res);
}
