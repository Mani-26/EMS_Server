require("dotenv").config();
const express = require("express");
const router = express.Router();
const QRCode = require("qrcode");
const nodemailer = require("nodemailer");
const crypto = require("crypto");
const cloudinary = require("cloudinary").v2;

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// We'll pass the models from the main app
let Event, Registration;

// Initialize models
const initModels = (models) => {
  Event = models.Event;
  Registration = models.Registration;
};

// Generate a unique transaction reference
const generateTransactionRef = () => {
  return `YM${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 10000)}`;
};

// Create UPI payment
router.post("/create-payment", async (req, res) => {
  console.log("UPI payment creation request received:", req.body);
  const { eventId, name, email, phone } = req.body;
  
  // Debug log
  console.log("UPI payment data:", { eventId, name, email, phone });

  try {
    // Validate inputs
    if (!eventId || !name || !email || !phone) {
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

    // Generate transaction reference
    const transactionRef = generateTransactionRef();

    // Create UPI payment link
    // Format: upi://pay?pa=UPI_ID&pn=NAME&am=AMOUNT&tr=REF&tn=NOTE&cu=INR
    const upiId = process.env.UPI_ID;
    const merchantName = encodeURIComponent(process.env.MERCHANT_NAME || "Yellowmatics Events");
    const amount = event.fee;
    const note = encodeURIComponent(`Payment for ${event.name}`);
    
    // Create UPI links for different apps
    // Standard UPI link (works with most UPI apps)
    const upiLink = `upi://pay?pa=${upiId}&pn=${merchantName}&am=${amount}&cu=INR&tr=${transactionRef}&tn=${note}`;
    
    // Google Pay specific link
    const gpayLink = `upi://pay?pa=${upiId}&pn=${merchantName}&am=${amount}&cu=INR&tr=${transactionRef}&tn=${note}&mode=04&purpose=00`;
    
    // PhonePe specific link
    const phonePeLink = `upi://pay?pa=${upiId}&pn=${merchantName}&am=${amount}&cu=INR&tr=${transactionRef}&tn=${note}&mc=0000&mode=04`;
    
    // Use the standard UPI link as the final link
    const finalUpiLink = upiLink;
    
    // Generate QR code for the final UPI link
    const qrCode = await QRCode.toDataURL(finalUpiLink);

    // We'll create the registration object but not save it to the database yet
    // It will only be saved when the user uploads a payment screenshot
    const registrationData = {
      name,
      email,
      phone,
      eventId,
      paymentStatus: 'pending',
      paymentId: transactionRef,
      paymentMethod: 'upi',
    };

    // We'll use our own QR code instead of relying on external service
    // Generate a backup QR code with a more compatible format for Google Pay
    const backupQrData = `upi://pay?pa=${upiId}&pn=${encodeURIComponent(process.env.MERCHANT_NAME || "Yellowmatics Events")}&am=${amount}&cu=INR&mode=04&purpose=00`;
    const backupQrCode = await QRCode.toDataURL(backupQrData);

    // Return payment details
    res.json({
      success: true,
      transactionRef,
      upiLink: finalUpiLink,
      gpayLink: gpayLink,
      phonePeLink: phonePeLink,
      qrCode,
      backupQrCode,
      upiId,
      amount: event.fee,
      eventDetails: {
        name: event.name,
        fee: event.fee,
        date: event.date,
        venue: event.venue,
      },
      registrationData: registrationData, // Include registration data for later use
      instructions: [
        "1. Scan this QR code with any UPI app",
        "2. Complete the payment",
        "3. After payment, click 'I've Paid' button",
        "4. We'll verify your payment and send your ticket"
      ]
    });
  } catch (error) {
    console.error("Error creating UPI payment:", error);
    res.status(500).json({ message: "Failed to create payment", error: error.message });
  }
});

// Verify payment
router.post("/verify-payment", async (req, res) => {
  const { transactionRef, email, upiTransactionId, paymentScreenshot, registrationData } = req.body;

  try {
    // Validate required fields
    if (!transactionRef || !email) {
      return res.status(400).json({ message: "Transaction reference and email are required" });
    }

    if (!paymentScreenshot) {
      return res.status(400).json({ message: "Payment screenshot is required" });
    }

    if (!registrationData) {
      return res.status(400).json({ message: "Registration data is required" });
    }

    // Check if a registration already exists for this transaction
    let registration = await Registration.findOne({
      paymentId: transactionRef,
      email,
    });

    // If registration doesn't exist, create it now
    if (!registration) {
      registration = new Registration({
        ...registrationData,
        paymentId: transactionRef,
        email: email.toLowerCase().trim()
      });
    } else if (registration.paymentStatus === 'completed') {
      return res.json({
        success: true,
        message: "Payment already verified",
        registrationId: registration._id,
        ticketId: registration.ticketId
      });
    }

    // Get event details
    const event = await Event.findById(registration.eventId);
    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    // Upload payment screenshot to Cloudinary
    let screenshotUrl = '';
    try {
      // Check if the image is a valid base64 string
      if (!paymentScreenshot || !paymentScreenshot.startsWith('data:image')) {
        return res.status(400).json({ message: "Invalid payment screenshot format" });
      }
      
      // Upload the base64 image to Cloudinary with optimization options
      const uploadResult = await cloudinary.uploader.upload(paymentScreenshot, {
        folder: 'payment_screenshots',
        resource_type: 'image',
        public_id: `payment_${transactionRef}`,
        quality: 'auto',
        fetch_format: 'auto',
        flags: 'lossy',
        transformation: [
          { width: 800, crop: 'limit' },
          { quality: 'auto:good' }
        ]
      });
      
      screenshotUrl = uploadResult.secure_url;
    } catch (cloudinaryError) {
      console.error('Error uploading to Cloudinary:', cloudinaryError);
      return res.status(500).json({ message: "Failed to upload payment screenshot. Please try again with a smaller image." });
    }

    // Update registration status - keep as pending but save screenshot
    registration.transactionId = upiTransactionId || `MANUAL-${Date.now()}`;
    registration.paymentScreenshot = screenshotUrl;
    registration.paymentStatus = 'pending'; // Keep as pending until admin verifies
    registration.paymentVerified = false;
    
    // Generate ticket ID if not already present
    if (!registration.ticketId) {
      const lastTicket = await Registration.findOne({ eventId: registration.eventId })
        .sort({ ticketId: -1 })
        .select("ticketId");
      const newTicketId = lastTicket ? lastTicket.ticketId + 1 : 1;
      registration.ticketId = newTicketId;
    }

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
        <h1 style="color: #FFA500; text-align: center;">🔄 Payment Verification in Progress</h1>
        
        <p>Hello ${registration.name},</p>
        
        <p>Thank you for registering for <strong>${event.name}</strong>. We have received your payment screenshot and it is currently being verified by our team.</p>
        
        <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <h2 style="color: #333; margin-top: 0;">🎟️ Registration Details</h2>
          <ul style="list-style-type: none; padding-left: 0;">
            <li><strong>🎫 Ticket ID:</strong> #${registration.ticketId}</li>
            <li><strong>📌 Event Name:</strong> ${event.name}</li>
            <li><strong>📅 Date:</strong> ${new Date(event.date).toLocaleDateString()}</li>
            <li><strong>📍 Venue:</strong> ${event.venue}</li>
            <li><strong>💰 Fee:</strong> ₹${event.fee}</li>
            <li><strong>💳 Payment Reference:</strong> ${registration.paymentId}</li>
          </ul>
        </div>

        <div style="background-color: #fff3cd; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #ffc107;">
          <h3 style="color: #856404; margin-top: 0;">⚠️ Important Information</h3>
          <p style="margin-bottom: 0;">Your payment is currently being verified by our team. Once verified, you will receive your official ticket via email.</p>
          <p style="margin-bottom: 0;">Please keep your Ticket ID handy for any communication regarding your registration.</p>
        </div>

        <div style="background-color: #d4edda; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #28a745;">
          <h3 style="color: #155724; margin-top: 0;">✅ Check Your Registration Status</h3>
          <p>You can check your registration status anytime using your Ticket ID and email at:</p>
          <p style="text-align: center;">
            <a href="${process.env.CLIENT_URL}/check-status" style="display: inline-block; background-color: #4CAF50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;">Check Status</a>
          </p>
        </div>

        <p>If you have any questions, feel free to reply to this email or contact our support team.</p>

        <p style="text-align: center; font-weight: bold;">Thank you for your patience! 🙏</p>
      </div>
    `;

    let mailOptions = {
      from: "Yellowmatics.ai <events@yellowmatics.ai>",
      to: registration.email,
      subject: `🔄 Payment Verification in Progress - ${event.name} (ID #${registration.ticketId})`,
      html: emailContent
    };

    await transporter.sendMail(mailOptions);

    res.json({
      success: true,
      message: "Payment screenshot received and pending verification",
      ticketId: registration.ticketId,
      registrationId: registration._id,
      status: "pending"
    });
  } catch (error) {
    console.error("Error verifying payment:", error);
    res.status(500).json({ message: "Failed to verify payment", error: error.message });
  }
});

// Get payment status
router.get("/payment-status/:transactionRef", async (req, res) => {
  const { transactionRef } = req.params;

  try {
    const registration = await Registration.findOne({ paymentId: transactionRef });
    
    if (!registration) {
      return res.status(404).json({ message: "Payment not found" });
    }

    res.json({
      status: registration.paymentStatus,
      ticketId: registration.ticketId,
      paymentMethod: registration.paymentMethod,
    });
  } catch (error) {
    console.error("Error getting payment status:", error);
    res.status(500).json({ message: "Failed to get payment status", error: error.message });
  }
});

module.exports = {
  router,
  initModels,
};