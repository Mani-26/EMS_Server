require("dotenv").config();
const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const QRCode = require("qrcode");
const nodemailer = require("nodemailer");

// We'll pass the models from the main app
let Event, Registration;

// Initialize models
const initModels = (models) => {
  Event = models.Event;
  Registration = models.Registration;
};

// Generate a unique payment reference ID
const generatePaymentRefId = () => {
  return `YM${Date.now()}${Math.floor(Math.random() * 1000)}`;
};

// Create a UPI payment link
router.post("/create-payment", async (req, res) => {
  const { eventId, name, email } = req.body;

  try {
    // Validate inputs
    if (!eventId || !name || !email) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    // Get event details
    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    // Check if event is paid
    if (event.isFree) {
      return res.status(400).json({ message: "This is a free event, no payment required" });
    }

    // Check seat availability
    const remainingSeats = event.seatLimit - event.registeredUsers;
    if (remainingSeats <= 0) {
      return res.status(400).json({ message: "❌ Event is fully booked!" });
    }

    // Check if user is already registered
    const existingRegistration = await Registration.findOne({ email, eventId });
    if (existingRegistration) {
      return res.status(400).json({ message: "⚠️ You are already registered!" });
    }

    // Generate a unique payment reference ID
    const paymentRefId = generatePaymentRefId();
    
    // Create a pending registration
    const pendingRegistration = new Registration({
      name,
      email,
      eventId,
      paymentStatus: 'pending',
      paymentId: paymentRefId,
      paymentMethod: 'upi',
    });
    
    await pendingRegistration.save();

    // Get UPI details from environment variables
    const upiId = process.env.UPI_ID;
    const merchantName = process.env.MERCHANT_NAME || "Yellowmatics Events";
    
    // Create UPI payment link
    // Format: upi://pay?pa=UPI_ID&pn=NAME&am=AMOUNT&tr=REF_ID&tn=NOTE
    const upiLink = `upi://pay?pa=${upiId}&pn=${encodeURIComponent(merchantName)}&am=${event.fee}&tr=${paymentRefId}&tn=${encodeURIComponent(`Payment for ${event.name}`)}`;
    
    // Generate QR code for the UPI link
    const qrCode = await QRCode.toDataURL(upiLink);

    // Return payment details
    res.json({
      success: true,
      paymentRefId,
      upiLink,
      qrCode,
      eventDetails: {
        name: event.name,
        fee: event.fee,
        date: event.date,
        venue: event.venue,
      },
      instructions: [
        "Scan the QR code with any UPI app",
        "Complete the payment in your UPI app",
        "After payment, click 'I've Paid' button",
        "We'll verify your payment and send your ticket"
      ]
    });
  } catch (error) {
    console.error("Error creating UPI payment:", error);
    res.status(500).json({ message: "Failed to create payment", error: error.message });
  }
});

// Verify payment status (manual verification)
router.post("/verify-payment", async (req, res) => {
  const { paymentRefId, email, transactionId } = req.body;

  try {
    // Find the pending registration
    const registration = await Registration.findOne({ 
      paymentId: paymentRefId,
      email
    });

    if (!registration) {
      return res.status(404).json({ message: "Payment reference not found" });
    }

    if (registration.paymentStatus === 'completed') {
      return res.json({ 
        success: true, 
        message: "Payment already verified",
        registrationId: registration._id
      });
    }

    // Get event details
    const event = await Event.findById(registration.eventId);
    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    // Update registration status
    registration.paymentStatus = 'completed';
    if (transactionId) {
      registration.transactionId = transactionId;
    }
    registration.paymentMethod = 'upi';

    // Generate ticket ID
    const ticketId = Math.floor(100000 + Math.random() * 900000);
    registration.ticketId = ticketId;

    // Generate QR code for the ticket
    const ticketData = {
      name: registration.name,
      email: registration.email,
      eventId: registration.eventId,
      eventName: event.name,
      ticketId: ticketId,
    };

    const qrImage = await QRCode.toDataURL(JSON.stringify(ticketData));
    registration.ticket = qrImage;

    await registration.save();

    // Update event registered users count
    event.registeredUsers += 1;
    await event.save();

    // Send confirmation email with ticket
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    const emailContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 5px;">
        <h1 style="color: #4CAF50; text-align: center;">🎉 Registration Confirmed!</h1>
        
        <p>Hello ${registration.name},</p>
        
        <p>Thank you for registering for <strong>${event.name}</strong>. Your payment has been confirmed and your ticket is attached below.</p>
        
        <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <h2 style="color: #333; margin-top: 0;">🎟️ Ticket Details</h2>
          <ul style="list-style-type: none; padding-left: 0;">
            <li><strong>🎫 Ticket ID:</strong> #${ticketId}</li>
            <li><strong>📌 Event Name:</strong> ${event.name}</li>
            <li><strong>📅 Date:</strong> ${event.date}</li>
            <li><strong>📝 Description:</strong> ${event.description}</li>
            <li><strong>📍 Venue:</strong> ${event.venue}</li>
            <li><strong>💰 Fee:</strong> ₹${event.fee}</li>
            <li><strong>💳 Payment ID:</strong> ${registration.paymentId}</li>
          </ul>
        </div>

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

    let mailOptions = {
      from: "Yellowmatics.ai <events@yellowmatics.ai>",
      to: registration.email,
      subject: `🎟 Your Ticket for ${event.name} - ID #${ticketId}`,
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
      success: true,
      message: "Payment verified and ticket generated",
      ticketId,
      registrationId: registration._id
    });
  } catch (error) {
    console.error("Error verifying payment:", error);
    res.status(500).json({ message: "Failed to verify payment", error: error.message });
  }
});

module.exports = {
  router,
  initModels
};