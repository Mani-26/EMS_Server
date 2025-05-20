require("dotenv").config();
const express = require("express");
const router = express.Router();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const nodemailer = require("nodemailer");
const QRCode = require("qrcode");

// We'll pass the models from the main app
let Event, Registration;

// Initialize models
const initModels = (models) => {
  Event = models.Event;
  Registration = models.Registration;
};

// Create a payment intent for Stripe
router.post("/create-payment-intent", async (req, res) => {
  const { eventId, name, email, paymentMethod = 'card' } = req.body;

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

    // Payment intent options
    const paymentIntentOptions = {
      amount: event.fee * 100, // Stripe requires amount in paise (1/100 of INR)
      currency: "inr",
      metadata: {
        eventId,
        name,
        email,
        paymentMethod
      },
    };
    
    // For now, we'll use card payments for all methods
    // We'll handle UPI payments differently
    paymentIntentOptions.payment_method_types = ['card'];
    
    // Store the requested payment method in metadata for reference
    paymentIntentOptions.metadata.requestedPaymentMethod = paymentMethod;
    
    // Create the payment intent
    const paymentIntent = await stripe.paymentIntents.create(paymentIntentOptions);

    // Return the client secret
    res.json({
      clientSecret: paymentIntent.client_secret,
      paymentMethod,
      eventDetails: {
        name: event.name,
        fee: event.fee,
        date: event.date,
        venue: event.venue,
      }
    });
  } catch (error) {
    console.error("Error creating payment intent:", error);
    res.status(500).json({ message: "Failed to create payment", error: error.message });
  }
});

// Webhook to handle Stripe events
router.post("/webhook", async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    // For testing without a real webhook, we can simulate a successful payment
    if (!process.env.STRIPE_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET === 'whsec_your_webhook_secret') {
      console.log('Using test webhook mode - no signature verification');
      // Parse the raw body since it's not automatically parsed for webhooks
      const rawBody = req.body.toString();
      event = JSON.parse(rawBody);
    } else {
      // In production, verify the signature
      event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    }
  } catch (err) {
    console.error(`Webhook Error: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  if (event.type === 'payment_intent.succeeded') {
    const paymentIntent = event.data.object;
    await handleSuccessfulPayment(paymentIntent);
  }

  // Return a response to acknowledge receipt of the event
  res.json({ received: true });
});

// Function to handle successful payments
async function handleSuccessfulPayment(paymentIntent) {
  const { eventId, name, email } = paymentIntent.metadata;

  try {
    let event = await Event.findById(eventId);
    if (!event) {
      console.error("Event not found for payment:", eventId);
      return;
    }

    // Find last issued ticketId and increment
    const lastTicket = await Registration.findOne({ eventId })
      .sort({ ticketId: -1 })
      .select("ticketId");
    const newTicketId = lastTicket ? lastTicket.ticketId + 1 : 1;

    // Get event details for the QR code
    // const event = await Event.findById(eventId);
    
    // Create a detailed ticket data object
    const ticketData = {
      name: name,
      ticketId: newTicketId,
      email: email,
      phone: phone || 'Not provided',
      eventId: eventId,
      eventName: event.name,
      venue: event.venue,
      date: event.date,
      fee: event.fee,
      paymentStatus: 'Verified',
      paymentMethod: 'Card',
      registrationDate: new Date()
    };
    
    // Convert to JSON string for QR code
    const ticketCode = JSON.stringify(ticketData);
    
    // Generate QR code with enhanced options
    const qrImage = await QRCode.toDataURL(ticketCode, {
      errorCorrectionLevel: 'H',
      margin: 1,
      width: 300,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      }
    });

    // Save Registration with ticketId and payment info
    const registration = new Registration({
      name,
      email,
      eventId,
      ticketId: newTicketId,
      ticket: qrImage,
      paymentStatus: 'completed',
      paymentId: paymentIntent.id,
      paymentMethod: 'card',
    });
    await registration.save();

    // Update event registrations
    event.registeredUsers += 1;
    await event.save();

    // Send confirmation email
    let transporter = nodemailer.createTransport({
      service: "Gmail",
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    });

    let emailContent = `
      <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: auto;">
        <h2 style="text-align: center; color: #007bff;">🎉 Congratulations, ${name}! You're Registered! 🎟</h2>
        <p>Dear <strong>${name}</strong>,</p>
        <p>We're thrilled to confirm your registration for <strong>${event.name}</strong>! Get ready for an amazing experience.</p>

        <h3>📅 Event Details:</h3>
        <ul>
          <li><strong>🎫 Ticket ID:</strong> #${newTicketId}</li>
          <li><strong>📌 Event Name:</strong> ${event.name}</li>
          <li><strong>📅 Date:</strong> ${event.date}</li>
          <li><strong>📝 Description:</strong> ${event.description}</li>
          <li><strong>📍 Venue:</strong> ${event.venue}</li>
          <li><strong>💰 Fee:</strong> ₹${event.fee} (Payment Completed)</li>
          <li><strong>💳 Payment ID:</strong> ${paymentIntent.id}</li>
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

    let mailOptions = {
      from: "Yellowmatics.ai <events@yellowmatics.ai>",
      to: email,
      subject: `🎟 Your Ticket for ${event.name} | Ticket #${newTicketId}`,
      html: emailContent,
      attachments: [
        {
          filename: "ticket.png",
          content: qrImage.split(";base64,").pop(),
          encoding: "base64",
          cid: "ticketQR" // Content ID referenced in the HTML
        },
      ],
    };

    await transporter.sendMail(mailOptions);
    // console.log(`🎉 Registration successful for ${email}. Ticket ID: #${newTicketId}`);
  } catch (error) {
    console.error("❌ Error processing successful payment:", error);
  }
}

// Check payment status for an event
router.get("/payment-status/:paymentIntentId", async (req, res) => {
  try {
    const { paymentIntentId } = req.params;
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    
    res.json({
      status: paymentIntent.status,
      amount: paymentIntent.amount / 100, // Convert back to rupees from cents
    });
  } catch (error) {
    console.error("Error checking payment status:", error);
    res.status(500).json({ message: "Failed to check payment status", error: error.message });
  }
});

module.exports = {
  router,
  initModels
};