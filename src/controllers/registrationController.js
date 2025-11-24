const QRCode = require("qrcode");

const Event = require("../models/Event");
const Registration = require("../models/Registration");
const { sendEmail } = require("../services/emailService");
const { buildFromAddress } = require("../utils/email");

const checkRegistrationStatus = async (req, res) => {
  try {
    const { ticketId, email } = req.query;

    if (!ticketId || !email) {
      return res.status(400).json({ message: "Ticket ID and email are required" });
    }

    const registration = await Registration.findOne({
      ticketId: parseInt(ticketId, 10),
      email: email.trim().toLowerCase(),
    });

    if (!registration) {
      return res
        .status(404)
        .json({ message: "Registration not found. Please check your ticket ID and email." });
    }

    const event = await Event.findById(registration.eventId);
    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    res.json({
      ...registration.toObject(),
      eventName: event.name,
      eventDate: event.date,
      eventVenue: event.venue,
    });
  } catch (error) {
    console.error("Error checking registration status:", error);
    res.status(500).json({ message: "Failed to check registration status" });
  }
};

const registerForEvent = async (req, res) => {
  const { name, email, phone, eventId, customFieldValues } = req.body;

  try {
    let event = await Event.findById(eventId);
    if (!event) return res.status(404).json({ message: "Event not found" });

    if (!event.isFree) {
      return res.json({
        message: "This is a paid event. Please complete payment to register.",
        isPaid: true,
        fee: event.fee,
        eventName: event.name,
      });
    }

    const remainingSeats = event.seatLimit - event.registeredUsers;
    if (remainingSeats <= 0) {
      return res.status(400).json({ message: "❌ Event is fully booked!" });
    }

    const existingRegistration = await Registration.findOne({ email, eventId });
    if (existingRegistration) {
      return res.status(400).json({ message: "⚠️ You are already registered!" });
    }

    const lastTicket = await Registration.findOne({ eventId })
      .sort({ ticketId: -1 })
      .select("ticketId");
    const newTicketId = lastTicket ? lastTicket.ticketId + 1 : 1;

    const ticketData = {
      name,
      ticketId: newTicketId,
      email,
      phone: phone || "Not provided",
      eventId,
      eventName: event.name,
      venue: event.venue,
      date: event.date,
      fee: event.fee,
      paymentStatus: "Verified",
      registrationDate: new Date(),
    };

    const qrImage = await QRCode.toDataURL(JSON.stringify(ticketData), {
      errorCorrectionLevel: "H",
      margin: 1,
      width: 300,
      color: {
        dark: "#000000",
        light: "#FFFFFF",
      },
    });

    const registration = new Registration({
      name,
      email,
      phone,
      eventId,
      ticketId: newTicketId,
      ticket: qrImage,
      paymentStatus: "completed",
    });

    if (customFieldValues) {
      let processedCustomFields = customFieldValues;

      if (typeof customFieldValues === "string") {
        try {
          processedCustomFields = JSON.parse(customFieldValues);
        } catch (e) {
          console.error("Error parsing customFieldValues JSON string:", e);
          processedCustomFields = {};
        }
      }

      const customFieldMap = new Map();
      if (typeof processedCustomFields === "object" && !Array.isArray(processedCustomFields)) {
        Object.entries(processedCustomFields).forEach(([key, value]) => {
          if (value !== null && value !== undefined) {
            customFieldMap.set(key, value);
          }
        });
      }

      registration.customFieldValues = customFieldMap;
    }

    await registration.save();

    event.registeredUsers += 1;
    await event.save();
    event = await Event.findById(eventId);

    const emailContent = `
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
            <li><strong>📍 Venue:</strong> ${event.venue}</li>
            ${!event.isFree ? `<li><strong>💰 Fee:</strong> ₹${event.fee}</li>` : ""}
          </ul>
          <p>Attached below is your unique event ticket (QR Code). Please bring it with you for entry.</p>
          <h3>📌 Stay Connected:</h3>
          <p>Follow us for updates and behind-the-scenes content:</p>
          <p>
            🔗 <a href="https://www.linkedin.com/company/yellowmatics" target="_blank">LinkedIn</a> |
            📸 <a href="https://www.instagram.com/yellowmatics.ai/" target="_blank">Instagram</a> |
            💬 <a href="https://bit.ly/YMWhatsapp" target="_blank">WhatsApp</a>
          </p>
          <p>If you have any questions, feel free to reply to this email. We can't wait to see you at the event! 🎊</p>
          <p style="text-align: center; font-weight: bold;">🚀 See you soon! 🚀</p>
        </div>
      `;

    const emailUser = event.emailForNotifications || process.env.EMAIL_USER;
    const mailOptions = {
      from: buildFromAddress(emailUser),
      to: email,
      subject: `Registration Confirmed - ${event.name} | Ticket #${newTicketId}`,
      html: emailContent,
      attachments: [
        {
          filename: "ticket.png",
          content: qrImage.split(";base64,").pop(),
          encoding: "base64",
          cid: "ticketQR",
        },
      ],
    };

    try {
      await sendEmail(event, mailOptions);
      res.json({
        message: `🎉 Registration successful! Ticket ID: #${newTicketId}. Check your email.`,
      });
    } catch (emailError) {
      console.error("Error sending registration email:", emailError);
      res.json({
        message: `🎉 Registration successful! Ticket ID: #${newTicketId}. Email notification failed, but your registration is confirmed.`,
      });
    }
  } catch (error) {
    console.error("❌ Error during registration:", error);
    res.status(500).json({ message: "Registration failed", error });
  }
};

const createTestRegistration = async (req, res) => {
  try {
    const { name, email, phone, eventId } = req.body;

    if (!name || !email || !phone || !eventId) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    const transactionRef = `TEST-${Date.now()}`;
    const registration = new Registration({
      name,
      email,
      phone,
      eventId,
      paymentStatus: "pending",
      paymentId: transactionRef,
      paymentMethod: "upi",
      paymentScreenshot: "https://res.cloudinary.com/demo/image/upload/v1312461204/sample.jpg",
      customFieldValues: {},
    });

    await registration.save();

    res.json({
      success: true,
      message: "Test registration created successfully",
      registration,
    });
  } catch (error) {
    console.error("Error creating test registration:", error);
    res.status(500).json({ message: "Failed to create test registration" });
  }
};

module.exports = {
  checkRegistrationStatus,
  registerForEvent,
  createTestRegistration,
};

