// backend/server.js
const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 4000;


// ======== ROUTES =========
const leadRoutes = require("./routes/leadRoutes");
const pdfRoutes = require("./routes/pdfRoutes");
const quoteRecalcRoutes = require("./routes/quoteRecalcRoutes");
const quoteRoutes = require("./routes/quoteRoutes");


// ====== EXPRESS SETUP ======
app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.use("/api/lead", leadRoutes);
app.use("/api/quote", pdfRoutes);
app.use("/api/quote", quoteRecalcRoutes);
app.use("/api/quote", quoteRoutes);


// ====== ROUTES ======
app.get("/", (req, res) => {
  res.send("Solar quote API is running");
});


app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
});
