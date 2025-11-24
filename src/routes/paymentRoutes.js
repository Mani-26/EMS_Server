const express = require("express");
const router = express.Router();
const QRCode = require("qrcode");
const crypto = require("crypto");
const cloudinary = require("cloudinary").v2;
const { sendEmail } = require("../services/emailService");
const Event = require("../models/Event");
const Registration = require("../models/Registration");

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Generate a unique transaction reference
const generateTransactionRef = () => {
  return `YM${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 10000)}`;
};

// Create UPI payment
router.post("/create-payment", async (req, res) => {
  const { eventId, name, email, phone, customFieldValues } = req.body;

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
    const upiId = event.upiId || process.env.UPI_ID; // Use event's UPI ID if available, otherwise fallback to env
    const merchantName = encodeURIComponent(process.env.MERCHANT_NAME || "Yellowmatics Events");
    const amount = event.fee;
    const note = encodeURIComponent(`Payment for ${event.name}`);
    
    // Log payment details for debugging
    // console.log("Event payment details:", {
    //   eventId: event._id,
    //   eventName: event.name,
    //   upiId: event.upiId,
    //   fallbackUpiId: process.env.UPI_ID,
    //   finalUpiId: upiId,
    //   phoneNumber: event.phoneNumber,
    //   amount: event.fee
    // });
    
    // Create UPI links for different apps
    // Standard UPI link (works with most UPI apps)
    const upiLink = `upi://pay?pa=${upiId}&pn=${merchantName}&am=${amount}&cu=INR&tr=${transactionRef}&tn=${note}`;
    
    // Google Pay specific link
    const gpayLink = `upi://pay?pa=${upiId}&pn=${merchantName}&am=${amount}&cu=INR&tr=${transactionRef}&tn=${note}&mode=04&purpose=00`;
    
    // PhonePe specific link
    const phonePeLink = `upi://pay?pa=${upiId}&pn=${merchantName}&am=${amount}&cu=INR&tr=${transactionRef}&tn=${note}&mc=0000&mode=04`;
    
    // Use the standard UPI link as the final link
    const finalUpiLink = upiLink;
    
    // Generate QR code for the final UPI link with enhanced options
    const qrCode = await QRCode.toDataURL(finalUpiLink, {
      errorCorrectionLevel: 'H',
      margin: 1,
      width: 300,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      }
    });

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
      customFieldValues: customFieldValues || {}
    };
    
    // console.log("Registration data with custom fields:", registrationData);

    // We'll use our own QR code instead of relying on external service
    // Generate a backup QR code with a more compatible format for Google Pay
    const backupQrData = `upi://pay?pa=${upiId}&pn=${encodeURIComponent(process.env.MERCHANT_NAME || "Yellowmatics Events")}&am=${amount}&cu=INR&mode=04&purpose=00`;
    
    // Add additional metadata to the QR code for better tracking
    const enhancedBackupQrData = {
      upiLink: backupQrData,
      eventName: event.name,
      amount: event.fee,
      transactionRef: transactionRef,
      timestamp: new Date().toISOString()
    };
    
    // Generate the backup QR code with enhanced options
    const backupQrCode = await QRCode.toDataURL(JSON.stringify(enhancedBackupQrData), {
      errorCorrectionLevel: 'H',
      margin: 1,
      width: 300,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      }
    });

    // Return payment details
    res.json({
      success: true,
      transactionRef,
      upiLink: finalUpiLink,
      gpayLink: gpayLink,
      phonePeLink: phonePeLink,
      qrCode,
      backupQrCode,
      upiId: event.upiId || process.env.UPI_ID, // Ensure we're using the event's UPI ID
      phoneNumber: event.phoneNumber || "",
      amount: event.fee,
      eventDetails: {
        name: event.name,
        fee: event.fee,
        date: event.date,
        venue: event.venue,
        upiId: event.upiId, // Include UPI ID in event details
        phoneNumber: event.phoneNumber, // Include phone number in event details
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

// Check payment status without uploading screenshot
router.post("/check-payment-status", async (req, res) => {
  const { transactionRef, email } = req.body;
  
  // console.log("Checking payment status for:", { transactionRef, email });
  
  try {
    // Validate required fields
    if (!transactionRef || !email) {
      return res.status(400).json({ message: "Transaction reference and email are required" });
    }
    
    // Check if a registration exists for this transaction
    const registration = await Registration.findOne({
      paymentId: transactionRef,
      email,
    });
    
    if (!registration) {
      return res.json({
        success: false,
        message: "No registration found for this transaction reference"
      });
    }
    
    // Check if payment screenshot exists
    if (registration.paymentScreenshot) {
      return res.json({
        success: true,
        message: "Payment screenshot already exists",
        ticketId: registration.ticketId,
        registrationId: registration._id,
        paymentScreenshotUrl: registration.paymentScreenshot,
        paymentStatus: registration.paymentStatus || 'pending'
      });
    }
    
    return res.json({
      success: false,
      message: "No payment screenshot found for this registration"
    });
  } catch (error) {
    console.error("Error checking payment status:", error);
    return res.status(500).json({ message: "Server error checking payment status" });
  }
});

// Verify payment
router.post("/verify-payment", async (req, res) => {
  const { transactionRef, email, upiTransactionId, paymentScreenshot, registrationData } = req.body;
  
  // console.log("Registration data received:", {
  //   transactionRef,
  //   email,
  //   upiTransactionId,
  //   hasScreenshot: !!paymentScreenshot,
  //   registrationData: JSON.stringify(registrationData)
  // });

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
      // console.log("Creating new registration with data:", registrationData);
      
      // Ensure customFieldValues is properly formatted
      let customFieldValues = registrationData.customFieldValues || {};
      // console.log("Custom field values before processing:", customFieldValues);
      
      // Create the registration with basic fields first
      registration = new Registration({
        name: registrationData.name,
        email: email.toLowerCase().trim(),
        phone: registrationData.phone,
        eventId: registrationData.eventId,
        paymentStatus: 'pending',
        paymentId: transactionRef,
        paymentMethod: 'upi'
      });
      
      // Handle custom field values
      try {
        // Get custom field values from registration data
        let customFields = registrationData.customFieldValues || {};
        
        // Convert to object if it's a string (JSON)
        if (typeof customFields === 'string') {
          try {
            customFields = JSON.parse(customFields);
          } catch (e) {
            console.error("Error parsing customFields JSON string:", e);
            customFields = {};
          }
        }
        
        // Convert Map to plain object if needed
        if (customFields instanceof Map) {
          const plainObject = {};
          customFields.forEach((value, key) => {
            plainObject[key] = value;
          });
          customFields = plainObject;
        }
        
        // Create a new Map for Mongoose
        const customFieldsMap = new Map();
        
        // Process the custom fields
        if (typeof customFields === 'object' && !Array.isArray(customFields)) {
          Object.entries(customFields).forEach(([key, value]) => {
            if (value !== null && value !== undefined) {
              // Don't sanitize the key - keep it exactly as in the event definition
              customFieldsMap.set(key, value);
            }
          });
        } else {
          customFieldsMap.set("Note", "Custom field values format not recognized");
        }
        
        // Set the custom field values as a Map
        registration.customFieldValues = customFieldsMap;
      } catch (customFieldError) {
        console.error("Error processing custom fields:", customFieldError);
        // Continue without custom fields if there's an error
        registration.customFieldValues = new Map();
      }
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

    // Check if payment screenshot already exists
    if (registration.paymentScreenshot) {
      // Return success with existing screenshot URL and ticket ID
      return res.json({
        success: true,
        message: "Payment screenshot already uploaded and pending verification",
        ticketId: registration.ticketId,
        registrationId: registration._id,
        paymentScreenshotUrl: registration.paymentScreenshot,
        paymentStatus: registration.paymentStatus || 'pending'
      });
    }
    
    // Upload payment screenshot to Cloudinary
    let screenshotUrl = '';
    try {
      // Check if the image is a valid base64 string
      if (!paymentScreenshot) {
        return res.status(400).json({ message: "Payment screenshot is missing" });
      }
      
      if (!paymentScreenshot.startsWith('data:image')) {
        return res.status(400).json({ message: "Invalid payment screenshot format. Must be a valid image." });
      }
      
      // Log the size of the base64 string
      // console.log(`Payment screenshot base64 length: ${paymentScreenshot.length} characters`);
      
      // Upload the base64 image to Cloudinary with more lenient options
      const uploadResult = await cloudinary.uploader.upload(paymentScreenshot, {
        folder: 'payment_screenshots',
        resource_type: 'image',
        public_id: `payment_${transactionRef}`,
        quality: 'auto',
        fetch_format: 'auto',
        flags: 'lossy',
        transformation: [
          { width: 1200, crop: 'limit' },
          { quality: 'auto:low' }
        ],
        timeout: 60000 // Increase timeout to 60 seconds
      });
      
      screenshotUrl = uploadResult.secure_url;
      // console.log('Successfully uploaded image to Cloudinary:', screenshotUrl);
    } catch (cloudinaryError) {
      console.error('Error uploading to Cloudinary:', cloudinaryError);
      // Provide more specific error message
      const errorMessage = cloudinaryError.message || "Unknown error";
      return res.status(500).json({ 
        message: "Failed to upload payment screenshot. Technical error: " + errorMessage,
        error: errorMessage
      });
    }

    // Update registration status - keep as pending but save screenshot
    registration.transactionId = upiTransactionId || `MANUAL-${Date.now()}`;
    
    // Only update the screenshot if it doesn't already exist
    if (!registration.paymentScreenshot) {
      registration.paymentScreenshot = screenshotUrl;
      // console.log('Saving new payment screenshot URL:', screenshotUrl);
    } 
    // else {
    //   console.log('Keeping existing payment screenshot URL:', registration.paymentScreenshot);
    // }
    
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

    // Send confirmation email with ticket using event-specific email if available (OAuth2)
    const emailUser = event.emailForNotifications || process.env.EMAIL_USER;

    // Create ticket data for QR code
    const ticketData = {
      name: registration.name,
      ticketId: registration.ticketId,
      email: registration.email,
      phone: registration.phone || 'Not provided',
      eventId: event._id.toString(),
      eventName: event.name,
      venue: event.venue,
      date: event.date,
      fee: event.fee,
      paymentId: registration.paymentId,
      registrationDate: registration.registrationDate,
      paymentStatus: 'Pending Verification'
    };

    // Generate QR code with all ticket details
    const ticketQrCode = await QRCode.toDataURL(JSON.stringify(ticketData), {
      errorCorrectionLevel: 'H',
      margin: 1,
      width: 300,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      }
    });

    const emailContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 5px;">
       
        

        <h1 style="color: #FFA500; text-align: center;">🔄 Payment Verification in Progress</h1>
        
        <p>Hello ${registration.name},</p>
        
        <p>Thank you for registering for <strong>${event.name}</strong>. We have received your payment screenshot and it is currently being verified by our team.</p>
        
        <div style="background-color: #f9f9f9; padding: 20px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #17a2b8;">
          <h2 style="color: #333; margin-top: 0; margin-bottom: 15px;">🎟️ Your Registration Details</h2>
          
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 10px; border-bottom: 1px solid #eee; width: 40%;"><strong>👤 Name:</strong></td>
              <td style="padding: 10px; border-bottom: 1px solid #eee;">${registration.name}</td>
            </tr>
            <tr>
              <td style="padding: 10px; border-bottom: 1px solid #eee;"><strong>🎫 Ticket ID:</strong></td>
              <td style="padding: 10px; border-bottom: 1px solid #eee; font-weight: bold; color: #17a2b8;">#${registration.ticketId}</td>
            </tr>
            <tr>
              <td style="padding: 10px; border-bottom: 1px solid #eee;"><strong>📧 Email:</strong></td>
              <td style="padding: 10px; border-bottom: 1px solid #eee;">${registration.email}</td>
            </tr>
            <tr>
              <td style="padding: 10px; border-bottom: 1px solid #eee;"><strong>📱 Phone:</strong></td>
              <td style="padding: 10px; border-bottom: 1px solid #eee;">${registration.phone || 'Not provided'}</td>
            </tr>
            <tr>
              <td style="padding: 10px; border-bottom: 1px solid #eee;"><strong>📌 Event:</strong></td>
              <td style="padding: 10px; border-bottom: 1px solid #eee;">${event.name}</td>
            </tr>
            <tr>
              <td style="padding: 10px; border-bottom: 1px solid #eee;"><strong>📅 Event Date:</strong></td>
              <td style="padding: 10px; border-bottom: 1px solid #eee;">${new Date(event.date).toLocaleDateString('en-US', {weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'})}</td>
            </tr>
            <tr>
              <td style="padding: 10px; border-bottom: 1px solid #eee;"><strong>📍 Venue:</strong></td>
              <td style="padding: 10px; border-bottom: 1px solid #eee;">${event.venue}</td>
            </tr>
            <tr>
              <td style="padding: 10px; border-bottom: 1px solid #eee;"><strong>💰 Fee:</strong></td>
              <td style="padding: 10px; border-bottom: 1px solid #eee;">₹${event.fee}</td>
            </tr>
            <tr>
              <td style="padding: 10px; border-bottom: 1px solid #eee;"><strong>💳 Payment Reference:</strong></td>
              <td style="padding: 10px; border-bottom: 1px solid #eee;">${registration.paymentId}</td>
            </tr>
            <tr>
              <td style="padding: 10px; border-bottom: 1px solid #eee;"><strong>📆 Registration Date:</strong></td>
              <td style="padding: 10px; border-bottom: 1px solid #eee;">${new Date(registration.registrationDate).toLocaleString('en-US', {dateStyle: 'full', timeStyle: 'short'})}</td>
            </tr>
            <tr>
              <td style="padding: 10px; border-bottom: 1px solid #eee;"><strong>🔄 Status:</strong></td>
              <td style="padding: 10px; border-bottom: 1px solid #eee;"><span style="color: #ffc107; font-weight: bold;">Pending Verification</span></td>
            </tr>
          </table>
        </div>

        <div style="background-color: #fff3cd; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #ffc107;">
          <h3 style="color: #856404; margin-top: 0;">⚠️ Important Information</h3>
          <p style="margin-bottom: 8px;">Your payment is currently being verified by our team. Once verified, you will receive your official ticket with QR code via email.</p>
          <p style="margin-bottom: 8px;">Please keep your Ticket ID <strong>#${registration.ticketId}</strong> handy for any communication regarding your registration.</p>
          <p style="margin-bottom: 0;">Verification usually takes 1-2 business days. Thank you for your patience.</p>
        </div>

        <div style="background-color: #d4edda; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #28a745;">
          <h3 style="color: #155724; margin-top: 0;">✅ Check Your Registration Status</h3>
          <p>You can check your registration status anytime using your Ticket ID and email at:</p>
          <p style="text-align: center;">
            <a href="${process.env.CLIENT_URL}/check-status" style="display: inline-block; background-color: #4CAF50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;">Check Status</a>
          </p>
        </div>

        <p>If you have any questions, feel free to reply to this email or contact our support team at <a href="mailto:events@yellowmatics.ai">events@yellowmatics.ai</a>.</p>

        <div style="margin-top: 30px; border-top: 1px solid #eee; padding-top: 20px;">
          <p style="text-align: center; color: #666; font-size: 14px;">Connect with us</p>
          <div style="text-align: center; margin-bottom: 15px;">
            <a href="https://www.linkedin.com/company/yellowmatics" style="text-decoration: none; margin: 0 10px; color: #0077B5;">LinkedIn</a> | 
            <a href="https://www.instagram.com/yellowmatics.ai/" style="text-decoration: none; margin: 0 10px; color: #E1306C;">Instagram</a> | 
            <a href="https://bit.ly/YMWhatsapp" style="text-decoration: none; margin: 0 10px; color: #25D366;">WhatsApp</a>
          </div>
          <p style="text-align: center; color: #666; font-size: 12px;">© ${new Date().getFullYear()} Yellowmatics. All rights reserved.</p>
        </div>
      </div>
    `;

    let mailOptions = {
      from: `Yellowmatics.ai <${emailUser}>`,
      to: registration.email,
      subject: `Payment Verification in Progress - ${event.name} | Ticket #${registration.ticketId}`,
      html: emailContent
    };

    try {
      await sendEmail(event, mailOptions);
    } catch (emailError) {
      console.error("Error sending payment verification email:", emailError);
      // Continue even if email fails
    }

    // Determine if this was a new screenshot or an existing one
    const isNewScreenshot = !registration.paymentScreenshot || registration.paymentScreenshot === screenshotUrl;
    
    res.json({
      success: true,
      message: isNewScreenshot ? 
        "Payment screenshot received and pending verification" : 
        "Payment screenshot already exists and is pending verification",
      ticketId: registration.ticketId,
      registrationId: registration._id,
      status: "pending",
      paymentScreenshotUrl: registration.paymentScreenshot
    });
  } catch (error) {
    console.error("Error verifying payment:", error);
    
    // Provide more detailed error information for debugging
    let errorDetails = {
      message: error.message,
      stack: error.stack,
      name: error.name
    };
    
    if (error.name === 'ValidationError' && error.errors) {
      errorDetails.validationErrors = {};
      Object.keys(error.errors).forEach(key => {
        errorDetails.validationErrors[key] = error.errors[key].message;
      });
    }
    
    console.error("Detailed error:", errorDetails);
    
    res.status(500).json({ 
      message: "Failed to verify payment", 
      error: error.message,
      details: errorDetails
    });
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

module.exports = router;