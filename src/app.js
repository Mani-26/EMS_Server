const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");

const adminRoutes = require("./routes/adminRoutes");
const eventRoutes = require("./routes/eventRoutes");
const paymentRoutes = require("./routes/paymentRoutes");
const {
  router: registrationRouter,
  registerForEvent,
  createTestRegistration,
} = require("./routes/registrationRoutes");

const app = express();

app.use(
  cors({
    origin: ["http://localhost:3000", "https://yellowmatics-events.vercel.app"],
    credentials: true,
  })
);
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(bodyParser.json({ limit: "50mb" }));

app.use("/api/admin", adminRoutes);
app.use("/api/events", eventRoutes);
app.use("/api/registration", registrationRouter);
app.post("/api/register", registerForEvent);
app.post("/api/test/create-pending-registration", createTestRegistration);
app.use("/api/upi", paymentRoutes);

module.exports = app;

