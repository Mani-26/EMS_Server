
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const nodemailer = require("nodemailer");
const QRCode = require("qrcode");
const bodyParser = require("body-parser");

const app = express();
app.use(cors({ 
  
  origin: ["http://localhost:3000", "https://emsserver2-production.up.railway.app","https://yellowmatics-events.vercel.app"], 
  credentials: true 

}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Use bodyParser for any additional parsing needs
app.use(bodyParser.json({ limit: '50mb' }));


// Connect to MongoDB
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.log(err));

// Models
const Event = mongoose.model(
  "Event",
  new mongoose.Schema({
    name: String,
    date: String,
    description: String,
    venue: String, // New field for venue
    seatLimit: Number, // Field for seat limit
    registeredUsers: { type: Number, default: 0 }, // Tracks how many users registered
    isFree: { type: Boolean, default: true }, // Whether the event is free or paid
    fee: { type: Number, default: 0 }, // Fee amount in INR (if paid)
    customFields: [{ 
      fieldName: String,
      fieldType: { type: String, enum: ['text', 'email', 'number', 'date', 'select', 'checkbox'], default: 'text' },
      isRequired: { type: Boolean, default: false },
      options: [String], // For select fields
      placeholder: String
    }]
  })
);

const Registration = mongoose.model(
  "Registration",
  new mongoose.Schema({
    name: String,
    email: String,
    phone: String, // Added phone number field
    eventId: String,
    ticketId: Number,
    ticket: String, // QR Code
    attended: { type: Boolean, default: false },
    paymentStatus: { type: String, enum: ['pending', 'completed', 'failed'], default: 'pending' },
    paymentId: String, // Payment ID (Stripe or UPI reference)
    transactionId: String, // UPI transaction ID (optional)
    paymentMethod: { type: String, enum: ['card', 'upi'], default: 'card' },
    paymentScreenshot: String, // URL to payment screenshot in Cloudinary
    paymentVerified: { type: Boolean, default: false }, // Flag to indicate if payment has been manually verified
    verificationDate: Date, // Date when payment was verified
    verifiedBy: String, // Admin who verified the payment
    registrationDate: { type: Date, default: Date.now }, // When the user registered for the event
    customFieldValues: { type: Map, of: mongoose.Schema.Types.Mixed } // Store custom field values as key-value pairs with mixed types
  })
);

const Admin = mongoose.model(
  "Admin",
  new mongoose.Schema({
    name: String,
    email: { type: String, unique: true },
    password: String,
  })
);

// Stripe routes removed - using only UPI payments

// Import Direct UPI routes
const directUpiModule = require("./direct-upi-routes");
// Initialize models for Direct UPI routes
directUpiModule.initModels({ Event, Registration });
// Use the router
app.use("/api/upi", directUpiModule.router);
const bcrypt = require("bcryptjs");

// Admin Registration (Only for first-time setup)
app.post("/api/admin/register", async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ message: "All fields are required!" });
  }

  try {
    const existingAdmin = await Admin.findOne({ email });
    if (existingAdmin) {
      return res.status(400).json({ message: "Admin already exists!" });
    }

    // Hash the password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Save admin to DB
    const newAdmin = new Admin({ name, email, password: hashedPassword });
    await newAdmin.save();

    res.status(201).json({ message: "Admin registered successfully!" });
  } catch (error) {
    res.status(500).json({ message: "Error creating admin", error });
  }
});

const jwt = require("jsonwebtoken");

// Admin Login
app.post("/api/admin/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    console.log("Admin login attempt:", email);
    const admin = await Admin.findOne({ email });
    if (!admin) {
      console.log("Admin not found:", email);
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) {
      console.log("Password mismatch for:", email);
      return res.status(400).json({ message: "Invalid credentials" });
    }

    // Generate JWT token
    const token = jwt.sign(
      { adminId: admin._id, email: admin.email },
      process.env.JWT_SECRET,
      { expiresIn: "24h" } // Token expires in 24 hours for better testing
    );

    console.log("Login successful for:", email);
    res.json({ message: "Login successful", token, admin: { name: admin.name, email: admin.email } });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ message: "Server error during login", error: error.message });
  }
});

// Verify token endpoint for debugging
app.get("/api/admin/verify-token", async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  
  if (!token) {
    return res.status(401).json({ valid: false, message: "No token provided" });
  }
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    res.json({ valid: true, admin: decoded });
  } catch (error) {
    res.status(401).json({ valid: false, message: "Invalid token", error: error.message });
  }
});
//   } catch (error) {
//     res.status(500).json({ message: "Server error", error });
//   }
// });

// const authMiddleware = (req, res, next) => {
//   const token = req.header("Authorization");

//   if (!token) {
//     return res.status(401).json({ message: "Access Denied! No token provided." });
//   }

//   try {
//     const verified = jwt.verify(token.replace("Bearer ", ""), process.env.JWT_SECRET);
//     req.admin = verified;
//     next();
//   } catch (error) {
//     res.status(403).json({ message: "Invalid Token" });
//   }
// };



// Get all events

const ExcelJS = require("exceljs");

// Download user details as an Excel file
// Get registrations for an event
app.get("/api/events/:eventId/registrations", async (req, res) => {
  try {
    const { eventId } = req.params;
    const event = await Event.findById(eventId);
    if (!event) return res.status(404).json({ message: "Event not found" });

    const registrations = await Registration.find({ eventId }).select("name email phone paymentStatus paymentId transactionId paymentScreenshot paymentVerified ticketId verificationDate registrationDate customFieldValues");
    
    res.json(registrations);
  } catch (error) {
    console.error("Error fetching registrations:", error);
    res.status(500).json({ message: "Failed to fetch registrations" });
  }
});

// Check registration status by ticket ID and email
app.get("/api/registration/status", async (req, res) => {
  try {
    const { ticketId, email } = req.query;
    
    if (!ticketId || !email) {
      return res.status(400).json({ message: "Ticket ID and email are required" });
    }
    
    // Find the registration
    const registration = await Registration.findOne({ 
      ticketId: parseInt(ticketId), 
      email: email.trim().toLowerCase()
    });
    
    if (!registration) {
      return res.status(404).json({ message: "Registration not found. Please check your ticket ID and email." });
    }
    
    // Get event details
    const event = await Event.findById(registration.eventId);
    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }
    
    // Return registration status with event name
    res.json({
      ...registration.toObject(),
      eventName: event.name,
      eventDate: event.date,
      eventVenue: event.venue
    });
  } catch (error) {
    console.error("Error checking registration status:", error);
    res.status(500).json({ message: "Failed to check registration status" });
  }
});

// Update payment verification status (admin only)
app.post("/api/admin/verify-payment", async (req, res) => {
  try {
    const { registrationId, verified } = req.body;
    
    if (!registrationId) {
      return res.status(400).json({ message: "Registration ID is required" });
    }
    
    // Find the registration
    const registration = await Registration.findById(registrationId);
    if (!registration) {
      return res.status(404).json({ message: "Registration not found" });
    }
    
    // Update verification status
    registration.paymentVerified = verified;
    
    // If verifying payment, update status and date
    if (verified) {
      registration.paymentStatus = 'completed';
      registration.verificationDate = new Date();
      registration.verifiedBy = 'admin'; // Could be the admin username in a more complex system
      
      // Generate ticket ID if not already present
      if (!registration.ticketId) {
        const lastTicket = await Registration.findOne({ eventId: registration.eventId })
          .sort({ ticketId: -1 })
          .select("ticketId");
        const newTicketId = lastTicket ? lastTicket.ticketId + 1 : 1;
        registration.ticketId = newTicketId;
      }
      
      // Generate QR Code if not already present
      if (!registration.ticket) {
        const ticketCode = `${registration.email}-${registration.eventId}-${registration.ticketId}`;
        const qrImage = await QRCode.toDataURL(ticketCode);
        registration.ticket = qrImage;
      }
      
      // Get event details for the email
      const event = await Event.findById(registration.eventId);
      if (event) {
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
            <div style="text-align: center; margin-bottom: 20px;">
              <img src="https://yellowmatics.ai/wp-content/uploads/2023/09/yellowmatics-logo.png" alt="Yellowmatics Logo" style="max-width: 200px;">
            </div>
            
            <h1 style="color: #4CAF50; text-align: center;">🎉 Payment Verified - Registration Confirmed!</h1>
            
            <p>Hello ${registration.name},</p>
            
            <p>Great news! Your payment for <strong>${event.name}</strong> has been verified and your registration is now confirmed.</p>
            
            <div style="text-align: center; margin: 30px 0;">
              <div style="border: 2px dashed #4CAF50; padding: 20px; border-radius: 10px; background-color: #f9f9f9; display: inline-block;">
                <h2 style="color: #333; margin-top: 0; text-align: center;">🎟️ Your Event Ticket</h2>
                <div style="text-align: center; margin: 20px 0;">
                  <img src="cid:ticketQR" alt="Event Ticket QR Code" style="max-width: 200px; border: 1px solid #ddd; padding: 10px; background: white;">
                </div>
                <p style="text-align: center; font-weight: bold; margin: 5px 0; font-size: 18px;">Ticket ID: #${registration.ticketId}</p>
                <p style="text-align: center; margin: 5px 0;">${registration.name}</p>
              </div>
            </div>
            
            <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <h2 style="color: #333; margin-top: 0;">📋 Event Details</h2>
              <ul style="list-style-type: none; padding-left: 0;">
                <li style="margin-bottom: 8px;"><strong>📌 Event Name:</strong> ${event.name}</li>
                <li style="margin-bottom: 8px;"><strong>📅 Event Date:</strong> ${new Date(event.date).toLocaleDateString('en-US', {weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'})}</li>
                <li style="margin-bottom: 8px;"><strong>📝 Description:</strong> ${event.description || 'N/A'}</li>
                <li style="margin-bottom: 8px;"><strong>📍 Venue:</strong> ${event.venue}</li>
              </ul>
            </div>
            
            <div style="background-color: #e8f5e9; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #4CAF50;">
              <h3 style="color: #2e7d32; margin-top: 0;">✅ Registration Information</h3>
              <ul style="list-style-type: none; padding-left: 0;">
                <li style="margin-bottom: 8px;"><strong>🎫 Ticket ID:</strong> #${registration.ticketId}</li>
                <li style="margin-bottom: 8px;"><strong>👤 Name:</strong> ${registration.name}</li>
                <li style="margin-bottom: 8px;"><strong>📧 Email:</strong> ${registration.email}</li>
                <li style="margin-bottom: 8px;"><strong>📱 Phone:</strong> ${registration.phone || 'N/A'}</li>
                <li style="margin-bottom: 8px;"><strong>💰 Fee:</strong> ₹${event.fee}</li>
                <li style="margin-bottom: 8px;"><strong>💳 Payment Reference:</strong> ${registration.paymentId}</li>
                <li style="margin-bottom: 8px;"><strong>📆 Registration Date:</strong> ${registration.registrationDate ? new Date(registration.registrationDate).toLocaleString('en-US', {dateStyle: 'full', timeStyle: 'short'}) : 'N/A'}</li>
              </ul>
            </div>
            
            <div style="background-color: #fff3cd; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #ffc107;">
              <h3 style="color: #856404; margin-top: 0;">⚠️ Important Information</h3>
              <ul style="padding-left: 20px;">
                <li style="margin-bottom: 8px;">Please bring this ticket (QR code) with you to the event for entry.</li>
                <li style="margin-bottom: 8px;">You can either print this email or show the QR code on your mobile device.</li>
                <li style="margin-bottom: 8px;">Please arrive at least 15 minutes before the event starts.</li>
                <li style="margin-bottom: 8px;">This ticket is unique to you and cannot be transferred to others.</li>
              </ul>
            </div>
            
            <p>If you have any questions, feel free to reply to this email or contact our support team at <a href="mailto:events@yellowmatics.ai">events@yellowmatics.ai</a>.</p>

            <p style="text-align: center; font-weight: bold; font-size: 18px; margin-top: 30px;">🚀 We can't wait to see you at the event! 🚀</p>
            
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
          from: "Yellowmatics.ai <events@yellowmatics.ai>",
          to: registration.email,
          subject: `🎟 Your Ticket for ${event.name} - ID #${registration.ticketId}`,
          html: emailContent,
          attachments: [
            {
              filename: "ticket.png",
              content: registration.ticket.split(";base64,").pop(),
              encoding: "base64",
              cid: "ticketQR" // Content ID referenced in the HTML
            },
            // Also attach the ticket as a regular attachment so they can download it
            {
              filename: `Yellowmatics_Ticket_${registration.ticketId}.png`,
              content: registration.ticket.split(";base64,").pop(),
              encoding: "base64"
            }
          ],
        };

        try {
          await transporter.sendMail(mailOptions);
          console.log(`Confirmation email sent to ${registration.email}`);
        } catch (emailError) {
          console.error("Error sending confirmation email:", emailError);
          // Continue even if email fails
        }
      }
    }
    
    await registration.save();
    
    res.json({ 
      success: true, 
      message: verified ? "Payment verified successfully" : "Payment verification removed",
      registration
    });
  } catch (error) {
    console.error("Error updating payment verification:", error);
    res.status(500).json({ message: "Failed to update payment verification" });
  }
});

// Test endpoint to create a pending registration (for testing only)
app.post("/api/test/create-pending-registration", async (req, res) => {
  try {
    const { name, email, phone, eventId } = req.body;
    
    // Validate inputs
    if (!name || !email || !phone || !eventId) {
      return res.status(400).json({ message: "All fields are required" });
    }
    
    // Get event details
    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }
    
    // Generate a transaction reference
    const transactionRef = `TEST-${Date.now()}`;
    
    // Create a pending registration
    const registration = new Registration({
      name,
      email,
      phone,
      eventId,
      paymentStatus: 'pending',
      paymentId: transactionRef,
      paymentMethod: 'upi',
      paymentScreenshot: 'https://res.cloudinary.com/demo/image/upload/v1312461204/sample.jpg', // Sample image
      customFieldValues: {} // Empty custom fields for test registration
    });
    
    await registration.save();
    
    res.json({
      success: true,
      message: "Test registration created successfully",
      registration
    });
  } catch (error) {
    console.error("Error creating test registration:", error);
    res.status(500).json({ message: "Failed to create test registration" });
  }
});

app.get("/api/events/:eventId/download", async (req, res) => {
  try {
    const { eventId } = req.params;
    const event = await Event.findById(eventId);
    if (!event) return res.status(404).json({ message: "Event not found" });

    // Get all registrations with complete details
    const registrations = await Registration.find({ eventId });

    // Create a new Excel workbook and sheet
    const workbook = new ExcelJS.Workbook();
    
    // Add workbook properties
    workbook.creator = 'EMS System';
    workbook.lastModifiedBy = 'EMS System';
    workbook.created = new Date();
    workbook.modified = new Date();
    
    // Create the main worksheet with a clean name (remove special characters)
    const cleanEventName = event.name.replace(/[^a-zA-Z0-9 ]/g, '').substring(0, 28);
    const worksheet = workbook.addWorksheet(cleanEventName);
    
    // Add event information at the top
    worksheet.mergeCells('A1:F1');
    const titleCell = worksheet.getCell('A1');
    titleCell.value = event.name;
    titleCell.font = {
      size: 16,
      bold: true,
      color: { argb: '4F46E5' }
    };
    titleCell.alignment = { horizontal: 'center' };
    
    // Add event details
    worksheet.mergeCells('A2:F2');
    worksheet.getCell('A2').value = `Date: ${new Date(event.date).toLocaleDateString('en-US', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    })}`;
    worksheet.getCell('A2').font = { italic: true };
    worksheet.getCell('A2').alignment = { horizontal: 'center' };
    
    worksheet.mergeCells('A3:F3');
    worksheet.getCell('A3').value = `Venue: ${event.venue}`;
    worksheet.getCell('A3').font = { italic: true };
    worksheet.getCell('A3').alignment = { horizontal: 'center' };
    
    worksheet.mergeCells('A4:F4');
    worksheet.getCell('A4').value = `Total Registrations: ${registrations.length}`;
    worksheet.getCell('A4').font = { bold: true };
    worksheet.getCell('A4').alignment = { horizontal: 'center' };
    
    // Add a blank row for spacing
    worksheet.addRow([]);
    
    // Define columns with proper width and headers
    worksheet.columns = [
      { header: 'S.No', key: 'serialNumber', width: 8 },
      { header: 'Name', key: 'name', width: 30 },
      { header: 'Email', key: 'email', width: 35 },
      { header: 'Phone', key: 'phone', width: 15 },
      { header: 'Ticket ID', key: 'ticketId', width: 20 },
      { header: 'Payment Status', key: 'paymentStatus', width: 18 },
      { header: 'Registration Date', key: 'registrationDate', width: 20 }
    ];
    
    // Style the header row
    const headerRow = worksheet.getRow(6);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'E0E0E0' }
    };
    headerRow.alignment = { horizontal: 'center' };
    
    // Add borders to header
    headerRow.eachCell((cell) => {
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      };
    });
    
    // Add data rows with serial numbers
    let serialNumber = 1;
    registrations.forEach((registration) => {
      const rowData = {
        serialNumber,
        name: registration.name,
        email: registration.email,
        phone: registration.phone || 'N/A',
        ticketId: registration.ticketId || 'N/A',
        paymentStatus: registration.paymentStatus ? 
          (registration.paymentStatus === 'completed' ? 'Completed' : 'Pending') : 
          (event.isFree ? 'Free Event' : 'Pending'),
        registrationDate: registration.registrationDate ? 
          new Date(registration.registrationDate).toLocaleString('en-US', {
            year: 'numeric', 
            month: 'short', 
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          }) : 'N/A'
      };
      
      const row = worksheet.addRow(rowData);
      
      // Add conditional formatting for payment status
      const paymentCell = row.getCell('paymentStatus');
      if (rowData.paymentStatus === 'Completed') {
        paymentCell.font = { color: { argb: '28A745' } };
      } else if (rowData.paymentStatus === 'Pending') {
        paymentCell.font = { color: { argb: 'FFC107' } };
      }
      
      // Add borders to all cells in the row
      row.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
        
        // Center specific columns
        if (cell.col === 1 || cell.col === 5 || cell.col === 6) {
          cell.alignment = { horizontal: 'center' };
        }
      });
      
      serialNumber++;
    });
    
    // Add a summary section at the bottom
    const lastRow = worksheet.lastRow.number + 2;
    
    // Count payment statuses
    const completedPayments = registrations.filter(r => r.paymentStatus === 'completed').length;
    const pendingPayments = registrations.filter(r => r.paymentStatus === 'pending').length;
    
    worksheet.mergeCells(`A${lastRow}:C${lastRow}`);
    worksheet.getCell(`A${lastRow}`).value = 'Payment Summary:';
    worksheet.getCell(`A${lastRow}`).font = { bold: true };
    
    worksheet.mergeCells(`D${lastRow}:F${lastRow}`);
    if (event.isFree) {
      worksheet.getCell(`D${lastRow}`).value = 'Free Event - No Payments Required';
    } else {
      worksheet.getCell(`D${lastRow}`).value = `Completed: ${completedPayments} | Pending: ${pendingPayments}`;
    }
    
    // Get filename from query param or generate default
    const filename = req.query.filename || `${event.name.replace(/[^a-zA-Z0-9]/g, '_')}_Registrations.xlsx`;
    
    // Check if this is a direct browser request (has user agent) vs programmatic request
    const userAgent = req.headers['user-agent'] || '';
    const isMobileUserAgent = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent);
    const isDirectAccess = req.query.direct === 'true' || (isMobileUserAgent && req.headers['sec-fetch-dest'] !== 'empty');
    
    // Set content type for Excel files
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    
    // Set appropriate content disposition based on access type
    // For direct browser access on mobile, use 'inline' to open in browser
    // For programmatic or desktop access, use 'attachment' to download
    res.setHeader(
      "Content-Disposition",
      `${isDirectAccess ? 'inline' : 'attachment'}; filename=${filename}`
    );
    
    // Add headers to prevent caching issues
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    
    // Add CORS headers to ensure it works across different domains
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    
    // Add headers to improve mobile browser compatibility
    res.setHeader("X-Content-Type-Options", "nosniff");
    
    // Send the Excel file as a response
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error("Error generating Excel:", error);
    res.status(500).json({ message: "Failed to generate Excel file" });
  }
});


app.get("/api/events", async (req, res) => {
  const events = await Event.find();
  res.json(events);
});

// Create a new event (Admin Only)
app.post("/api/events",  async (req, res) => {
  console.log("Creating event with data:", req.body);
  console.log("Custom fields received:", req.body.customFields);
  
  const { name, date, description, venue, seatLimit, isFree, fee, customFields } = req.body;

  if (!name || !date || !description || !venue || !seatLimit) {
    return res.status(400).json({ message: "All fields are required" });
  }

  // Validate fee if event is not free
  if (isFree === false && (!fee || fee <= 0)) {
    return res.status(400).json({ message: "Fee amount is required for paid events" });
  }

  try {
    // Validate custom fields
    let validatedCustomFields = [];
    if (customFields && Array.isArray(customFields)) {
      // Ensure all custom fields have valid properties
      validatedCustomFields = customFields.map(field => {
        // Ensure field has a name
        if (!field.fieldName) {
          throw new Error("All custom fields must have a name");
        }
        
        // Ensure field type is valid
        if (!['text', 'email', 'number', 'date', 'select', 'checkbox'].includes(field.fieldType)) {
          field.fieldType = 'text'; // Default to text if invalid
        }
        
        // Ensure select fields have options
        if (field.fieldType === 'select' && (!field.options || !Array.isArray(field.options))) {
          field.options = []; // Default to empty array
        }
        
        return {
          fieldName: field.fieldName,
          fieldType: field.fieldType,
          isRequired: !!field.isRequired,
          options: field.options || [],
          placeholder: field.placeholder || ''
        };
      });
    }
    
    const newEvent = new Event({
      name,
      date,
      description,
      venue,
      seatLimit,
      registeredUsers: 0,
      isFree: isFree !== undefined ? isFree : true,
      fee: isFree === false ? fee : 0,
      customFields: validatedCustomFields,
    });
    try {
      await newEvent.save();
      res
        .status(201)
        .json({ message: "Event created successfully!", event: newEvent });
    } catch (saveError) {
      console.error("Error saving event:", saveError);
      console.error("Validation errors:", saveError.errors);
      res.status(500).json({ 
        message: "Error creating event", 
        error: saveError.message,
        validationErrors: saveError.errors 
      });
    }
  } catch (error) {
    console.error("Error in event creation:", error);
    res.status(500).json({ 
      message: "Error creating event", 
      error: error.message 
    });
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
      venue: event.venue,
      seatLimit: event.seatLimit,
      registeredUsers: event.registeredUsers,
      isFree: event.isFree,
      fee: event.fee,
      customFields: event.customFields || [],
    });
  } catch (error) {
    res.status(500).json({ message: "Error fetching event", error });
  }
});

app.put("/api/events/:id",  async (req, res) => {
  const { id } = req.params;
  console.log("Updating event with data:", req.body);
  console.log("Custom fields received for update:", req.body.customFields);
  
  const { name, date, description, venue, seatLimit, isFree, fee, customFields } = req.body;

  try {
    const event = await Event.findById(id);
    if (!event) {
      return res.status(404).json({ message: "Event not found!" });
    }

    // Validate fee if event is not free
    if (isFree === false && (!fee || fee <= 0)) {
      return res.status(400).json({ message: "Fee amount is required for paid events" });
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
    event.venue = venue || event.venue;
    event.seatLimit = seatLimit || event.seatLimit;
    
    // Update fee information if provided
    if (isFree !== undefined) {
      event.isFree = isFree;
      if (isFree === false) {
        event.fee = fee || event.fee;
      } else {
        event.fee = 0; // Reset fee to 0 if event is marked as free
      }
    }
    
    // Update custom fields if provided
    if (customFields !== undefined) {
      // Validate custom fields
      if (Array.isArray(customFields)) {
        // Ensure all custom fields have valid properties
        const validatedCustomFields = customFields.map(field => {
          // Ensure field has a name
          if (!field.fieldName) {
            throw new Error("All custom fields must have a name");
          }
          
          // Ensure field type is valid
          if (!['text', 'email', 'number', 'date', 'select', 'checkbox'].includes(field.fieldType)) {
            field.fieldType = 'text'; // Default to text if invalid
          }
          
          // Ensure select fields have options
          if (field.fieldType === 'select' && (!field.options || !Array.isArray(field.options))) {
            field.options = []; // Default to empty array
          }
          
          return {
            fieldName: field.fieldName,
            fieldType: field.fieldType,
            isRequired: !!field.isRequired,
            options: field.options || [],
            placeholder: field.placeholder || ''
          };
        });
        
        event.customFields = validatedCustomFields;
      } else {
        event.customFields = []; // Default to empty array if not an array
      }
    }

    try {
      await event.save();
      res.json({ message: "✅ Event updated successfully!", event });
    } catch (saveError) {
      console.error("Error saving event:", saveError);
      console.error("Validation errors:", saveError.errors);
      res.status(500).json({ 
        message: "❌ Error saving event", 
        error: saveError.message,
        validationErrors: saveError.errors 
      });
    }
  } catch (error) {
    console.error("Error updating event:", error);
    res.status(500).json({ message: "❌ Server error while updating", error: error.message });
  }
});

// DELETE an event
app.delete("/api/events/:id",  async (req, res) => {
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
  console.log("Registration request received:", req.body);
  const { name, email, phone, eventId, customFieldValues } = req.body;
  
  // Debug log
  console.log("Registration data:", { name, email, phone, eventId, customFieldValues });

  try {
    let event = await Event.findById(eventId);
    if (!event) return res.status(404).json({ message: "Event not found" });
    
    // Check if event is free or paid
    if (!event.isFree) {
      console.log("Paid event detected:", event.name);
      return res.json({ 
        message: "This is a paid event. Please complete payment to register.",
        isPaid: true,
        fee: event.fee,
        eventName: event.name
      });
    }
    
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
      phone,
      eventId,
      ticketId: newTicketId,
      ticket: qrImage,
      paymentStatus: 'completed', // Free events are automatically completed
      customFieldValues: customFieldValues || {}
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
            <li><strong>📍 Venue:</strong> ${event.venue}</li>
            ${!event.isFree ? `<li><strong>💰 Fee:</strong> ₹${event.fee}</li>` : ''}
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
app.get("/api/events/:eventId/registrations",  async (req, res) => {
  try {
    const { eventId } = req.params;
    const registrations = await Registration.find({ eventId }).select("name email phone customFieldValues");

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
