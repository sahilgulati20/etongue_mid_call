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
const callApiUrl =
  process.env.CALL_API_URL ||
  "https://e-tongue-call-bot.onrender.com/make-outbound-call";

// ✅ Health check route
app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

app.get("/call", (req, res) => {
  res.status(405).json({
    message: "The /call endpoint requires a POST request with a JSON body containing 'to'.",
  });
});

// ✅ Direct connectivity test
app.get("/test", async (req, res) => {
  try {
    const r = await axios.get("https://e-tongue-call-bot.onrender.com/health", {
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
  const to = typeof req.body?.to === "string" ? req.body.to.trim() : "";
  if (!to) {
    return res.status(400).json({ message: "Missing 'to' field in request body" });
  }

  if (!/^\+[1-9]\d{7,14}$/.test(to)) {
    return res.status(400).json({
      message: "'to' must be a valid international phone number, for example +14155552671",
    });
  }

  console.log("☎️ Forwarding call to:", to);

  try {
    console.log("📡 Sending request to remote API...");
    const response = await axios.post(
      callApiUrl,
      { to },
      {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        timeout: 15000,
        validateStatus: () => true,
      }
    );

    console.log("✅ Remote response:", response.status, response.data);

    if (response.status >= 200 && response.status < 300) {
      res.json(response.data);
    } else if (response.status >= 500) {
      res.status(502).json({
        message: "The upstream call service failed to initiate the call",
        upstreamStatus: response.status,
      });
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
      res.status(error.response.status >= 500 ? 502 : error.response.status).json({
        message:
          error.response.status >= 500
            ? "The upstream call service failed to initiate the call"
            : "Upstream API error",
        status: error.response.status,
        data: error.response.data,
      });
    } else {
      console.error("❌ Network error:", error.message);
      res.status(502).json({
        message: "Unable to reach the upstream call service",
        error: error.message,
      });
    }
  }
});

app.listen(port, () => {
  console.log(`🚀 Middleware server running on port ${port}`);
});
