const mongoose = require("mongoose");

const registrationSchema = new mongoose.Schema({
  name: String,
  email: String,
  phone: String,
  eventId: { type: mongoose.Schema.Types.ObjectId, ref: "Event" },
  paymentStatus: { type: String, default: "pending" },
  paymentId: String,
  paymentMethod: String,
  paymentScreenshot: String,
  ticketId: { type: Number, default: 0 },
  ticket: String,
  isPaidEvent: { type: Boolean, default: false },
  paymentVerified: { type: Boolean, default: false },
  verificationDate: Date,
  verifiedBy: String,
  registrationDate: { type: Date, default: Date.now },
  customFieldValues: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    default: () => new Map(),
  },
});

module.exports = mongoose.model("Registration", registrationSchema);

