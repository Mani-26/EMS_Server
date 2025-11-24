const express = require("express");

const {
  registerAdmin,
  loginAdmin,
  verifyToken,
  verifyPayment,
} = require("../controllers/adminController");

const router = express.Router();

router.post("/register", registerAdmin);
router.post("/login", loginAdmin);
router.get("/verify-token", verifyToken);
router.post("/verify-payment", verifyPayment);

module.exports = router;

