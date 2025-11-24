const express = require("express");

const {
  getEventRegistrations,
  downloadEventRegistrations,
  getEvents,
  createEvent,
  getEventById,
  updateEvent,
  deleteEvent,
} = require("../controllers/eventController");

const router = express.Router();

router.get("/", getEvents);
router.post("/", createEvent);
router.get("/:eventId/registrations", getEventRegistrations);
router.get("/:eventId/download", downloadEventRegistrations);
router.get("/:eventId", getEventById);
router.put("/:id", updateEvent);
router.delete("/:id", deleteEvent);

module.exports = router;

