const mongoose = require("mongoose");

const customFieldSchema = new mongoose.Schema(
  {
    fieldName: String,
    fieldType: {
      type: String,
      enum: ["text", "email", "number", "date", "select", "checkbox"],
      default: "text",
    },
    isRequired: { type: Boolean, default: false },
    options: [String],
    placeholder: String,
  },
  { _id: false }
);

const eventSchema = new mongoose.Schema({
  name: String,
  date: String,
  description: String,
  venue: String,
  seatLimit: Number,
  registeredUsers: { type: Number, default: 0 },
  isFree: { type: Boolean, default: true },
  fee: { type: Number, default: 0 },
  featured: { type: Boolean, default: false },
  upiId: String,
  phoneNumber: String,
  emailForNotifications: String,
  appPassword: String,
  oauth2RefreshToken: String,
  oauth2ClientId: String,
  oauth2ClientSecret: String,
  customFields: [customFieldSchema],
});

module.exports = mongoose.model("Event", eventSchema);

