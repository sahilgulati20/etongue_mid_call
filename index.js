const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();

// ✅ Middleware
app.use(express.json());
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"],
  })
);

const port = process.env.PORT || 3000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Render's free tier puts an idle service to sleep; the request that wakes it
// back up can bounce off as a timeout, 404 (route not registered yet), or 429
// (Too Many Requests while it's still booting). Retry through those instead
// of surfacing them straight to the caller.
const RETRYABLE_STATUSES = new Set([404, 429, 502, 503, 504]);

async function postToCallBotWithRetry(to, { attempts = 4, timeoutMs = 20000, delaysMs = [3000, 6000, 12000] } = {}) {
  let lastError = null;
  let lastResponse = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await axios.post(
        "https://e-tongue-call-bot.onrender.com/make-outbound-call",
        { to },
        {
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          timeout: timeoutMs,
          validateStatus: () => true,
        }
      );

      if (response.status < 300 || !RETRYABLE_STATUSES.has(response.status)) {
        return response;
      }

      console.warn(`⚠️ Attempt ${attempt}/${attempts} got retryable status ${response.status}, will retry...`);
      lastResponse = response;
    } catch (error) {
      console.warn(`⚠️ Attempt ${attempt}/${attempts} failed: ${error.message}, will retry...`);
      lastError = error;
    }

    if (attempt < attempts) {
      await sleep(delaysMs[Math.min(attempt - 1, delaysMs.length - 1)]);
    }
  }

  if (lastResponse) return lastResponse;
  throw lastError;
}

// ✅ Health check route
app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

// ✅ Direct connectivity test
app.get("/test", async (req, res) => {
  try {
    const r = await axios.get("https://e-tongue-call-bot.onrender.com/", {
      timeout: 10000,
    });
    res.json({
      ok: true,
      status: r.status,
      data: r.data,
      message: "Connected to deployed Render server ✅",
    });
  } catch (e) {
    console.error("❌ Connectivity test failed:", e.message);
    res.json({
      ok: false,
      error: e.message,
      hint:
        "If this fails, your local server cannot reach the Render API (check your network or proxy).",
    });
  }
});

// ✅ Outbound call proxy route
app.post("/call", async (req, res) => {
  const { to } = req.body;
  if (!to) {
    return res.status(400).json({ message: "Missing 'to' field in request body" });
  }

  console.log("☎️ Forwarding call to:", to);

  try {
    console.log("📡 Sending request to remote API...");
    const response = await postToCallBotWithRetry(to);

    console.log("✅ Remote response:", response.status, response.data);

    if (response.status >= 200 && response.status < 300) {
      res.json(response.data);
    } else {
      res.status(response.status).json({
        message: "Remote API returned an error",
        status: response.status,
        data: response.data,
      });
    }
  } catch (error) {
    if (error.response) {
      console.error("❌ API error:", error.response.status, error.response.data);
      res.status(error.response.status).json({
        message: "Upstream API error",
        status: error.response.status,
        data: error.response.data,
      });
    } else {
      console.error("❌ Network error:", error.message);
      res.status(500).json({
        message: "Network or CORS issue contacting remote API",
        error: error.message,
      });
    }
  }
});

app.listen(port, () => {
  console.log(`🚀 Middleware server running on port ${port}`);
});
