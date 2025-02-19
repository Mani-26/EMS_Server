
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const nodemailer = require("nodemailer");
const QRCode = require("qrcode");
const bodyParser = require("body-parser");

const app = express();
app.use(cors());
app.use(express.json());
app.use(bodyParser.json());

// Connect to MongoDB
mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.log(err));

// Models
const Event = mongoose.model(
  "Event",
  new mongoose.Schema({
    name: String,
    date: String,
    description: String,
    seatLimit: Number, // New field for seat limit
    registeredUsers: { type: Number, default: 0 }, // Tracks how many users registered
  })
);

const Registration = mongoose.model(
  "Registration",
  new mongoose.Schema({
    name: String, // Added name field
    email: String,
    eventId: String,
    ticketId: Number,
    ticket: String, // QR Code
    attended: { type: Boolean, default: false },
  })
);

// Get all events
app.get("/api/events", async (req, res) => {
  const events = await Event.find();
  res.json(events);
});

// Create a new event (Admin Only)
app.post("/api/events", async (req, res) => {
  const { name, date, description, seatLimit } = req.body;

  if (!name || !date || !description || !seatLimit) {
    return res.status(400).json({ message: "All fields are required" });
  }

  try {
    const newEvent = new Event({
      name,
      date,
      description,
      seatLimit,
      registeredUsers: 0,
    });
    await newEvent.save();
    res
      .status(201)
      .json({ message: "Event created successfully!", event: newEvent });
  } catch (error) {
    res.status(500).json({ message: "Error creating event", error });
  }
});
app.get("/api/events/:eventId", async (req, res) => {
  try {
    const event = await Event.findById(req.params.eventId);
    if (!event) return res.status(404).json({ message: "Event not found" });
    res.json({
      name: event.name,
      date: event.date,
      description: event.description,
      seatLimit: event.seatLimit,
      registeredUsers: event.registeredUsers,
    });
  } catch (error) {
    res.status(500).json({ message: "Error fetching event", error });
  }
});

app.put("/api/events/:id", async (req, res) => {
  const { id } = req.params;
  const { name, date, description, seatLimit } = req.body;

  try {
    const event = await Event.findByIdAndUpdate(
      id,
      { name, date, description, seatLimit },
      { new: true }
    );
    if (!event) {
      return res.status(404).json({ message: "Event not found!" });
    }

    // Check if seatLimit has changed
    if (seatLimit !== event.seatLimit) {
      const seatDifference = seatLimit - event.seatLimit;
      event.remainingSeats += seatDifference;

      // Ensure remainingSeats is never negative
      if (event.remainingSeats < 0) {
        event.remainingSeats = 0;
      }
    }
    // Update event details
    event.name = name || event.name;
    event.date = date || event.date;
    event.description = description || event.description;
    event.seatLimit = seatLimit || event.seatLimit;

    await event.save();
    res.json({ message: "✅ Event updated successfully!", event });
  } catch (error) {
    res.status(500).json({ message: "❌ Server error while updating", error });
  }
});

// DELETE an event
app.delete("/api/events/:id", async (req, res) => {
  try {
    const event = await Event.findByIdAndDelete(req.params.id);
    if (!event) {
      return res.status(404).json({ message: "Event not found!" });
    }
    res.json({ message: "❌ Event deleted successfully!", event });
  } catch (error) {
    res.status(500).json({ message: "Server error while deleting", error });
  }
});

app.post("/api/register", async (req, res) => {
  const { name, email, eventId } = req.body;

  try {
    let event = await Event.findById(eventId);
    if (!event) return res.status(404).json({ message: "Event not found" });
    let remainingSeats=event.seatLimit-event.registeredUsers;
    // Check seat availability
    if (remainingSeats <= 0) {
      return res.status(400).json({ message: "❌ Event is fully booked!" });
    }

    // Check if the user is already registered
    const existingRegistration = await Registration.findOne({ email, eventId });
    if (existingRegistration) {
      return res
        .status(400)
        .json({ message: "⚠️ You are already registered!" });
    }

    // **Find last issued ticketId and increment**
    const lastTicket = await Registration.findOne({ eventId })
      .sort({ ticketId: -1 })
      .select("ticketId");
    const newTicketId = lastTicket ? lastTicket.ticketId + 1 : 1;

    // Generate QR Code
    const ticketCode = `${email}-${eventId}-${newTicketId}`;
    const qrImage = await QRCode.toDataURL(ticketCode);

    // **Save Registration with ticketId**
    const registration = new Registration({
      name,
      email,
      eventId,
      ticketId: newTicketId,
      ticket: qrImage,
    });
    await registration.save();

    // Reduce remaining seats and update DB
    event.registeredUsers += 1;
    await event.save();

    // **Re-fetch the event after updating**
    event = await Event.findById(eventId);

    // **Debugging Step: Log ticketId to check if it's correctly assigned**
    console.log(`🎫 New Ticket Assigned: ${newTicketId} for ${email}`);

    // **Send Email with Ticket ID**
    let transporter = nodemailer.createTransport({
      service: "Gmail",
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    });

    let emailContent = `
        <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: auto;">
          <h2 style="text-align: center; color: #007bff;">🎉 Congratulations, ${name}! You're Registered! 🎟</h2>
          <p>Dear <strong>${name}</strong>,</p>
          <p>We’re thrilled to confirm your registration for <strong>${event.name}</strong>! Get ready for an amazing experience.</p>
  
          <h3>📅 Event Details:</h3>
          <ul>
            <li><strong>🎫 Ticket ID:</strong> #${newTicketId}</li>
            <li><strong>📌 Event Name:</strong> ${event.name}</li>
            <li><strong>📅 Date:</strong> ${event.date}</li>
            <li><strong>📝 Description:</strong> ${event.description}</li>
            <li><strong>📍 Location:</strong> <a href="https://maps.google.com">Click here</a></li>
          </ul>
  
          <p>Attached below is your unique event ticket (QR Code). Please bring it with you for entry.</p>
  
          <h3>📌 Stay Connected:</h3>
          <p>Follow us for updates and behind-the-scenes content:</p>
          <p>
            🔗 <a href="https://www.linkedin.com/company/yourcompany" target="_blank">LinkedIn</a> | 
            📸 <a href="https://www.instagram.com/yourcompany" target="_blank">Instagram</a> | 
            💬 <a href="https://wa.me/yourwhatsappnumber" target="_blank">WhatsApp</a>
          </p>
  
          <p>If you have any questions, feel free to reply to this email. We can't wait to see you at the event! 🎊</p>
  
          <p style="text-align: center; font-weight: bold;">🚀 See you soon! 🚀</p>
        </div>
      `;

    let mailOptions = {
      from: "Yellowmatics.ai <events@yellowmatics.ai>",
      to: email,
      subject: `🎟 Your Ticket for ${event.name} - ID #${newTicketId}`,
      html: emailContent,
      attachments: [
        {
          filename: "ticket.png",
          content: qrImage.split(";base64,").pop(),
          encoding: "base64",
        },
      ],
    };

    await transporter.sendMail(mailOptions);
    res.json({
      message: `🎉 Registration successful! Ticket ID: #${newTicketId}. Check your email.`,
    });
  } catch (error) {
    console.error("❌ Error during registration:", error);
    res.status(500).json({ message: "Registration failed", error });
  }
});

// Get all registrations for a specific event
app.get("/api/events/:eventId/registrations", async (req, res) => {
  try {
    const { eventId } = req.params;
    const registrations = await Registration.find({ eventId }).select("name email");

    if (!registrations.length) {
      return res.status(404).json({ message: "No users registered for this event." });
    }

    res.json(registrations);
  } catch (error) {
    console.error("Error fetching registrations:", error);
    res.status(500).json({ message: "Server error", error });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
