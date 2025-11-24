const express = require("express");

const {
  checkRegistrationStatus,
  registerForEvent,
  createTestRegistration,
} = require("../controllers/registrationController");

const router = express.Router();

router.get("/status", checkRegistrationStatus);
router.post("/test", createTestRegistration);
router.post("/", registerForEvent);

module.exports = {
  router,
  registerForEvent,
  createTestRegistration,
};

