const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const QRCode = require("qrcode");

const Admin = require("../models/Admin");
const Event = require("../models/Event");
const Registration = require("../models/Registration");
const { sendEmail } = require("../services/emailService");
const { buildFromAddress } = require("../utils/email");

const registerAdmin = async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ message: "All fields are required!" });
  }

  try {
    const existingAdmin = await Admin.findOne({ email });
    if (existingAdmin) {
      return res.status(400).json({ message: "Admin already exists!" });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const newAdmin = new Admin({ name, email, password: hashedPassword });
    await newAdmin.save();

    res.status(201).json({ message: "Admin registered successfully!" });
  } catch (error) {
    res.status(500).json({ message: "Error creating admin", error });
  }
};

const loginAdmin = async (req, res) => {
  const { email, password } = req.body;

  try {
    const admin = await Admin.findOne({ email });
    if (!admin) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const token = jwt.sign(
      { adminId: admin._id, email: admin.email },
      process.env.JWT_SECRET,
      { expiresIn: "24h" }
    );

    res.json({ message: "Login successful", token, admin: { name: admin.name, email: admin.email } });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ message: "Server error during login", error: error.message });
  }
};

const verifyToken = async (req, res) => {
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
};

const verifyPayment = async (req, res) => {
  try {
    const { registrationId, verified } = req.body;

    if (!registrationId) {
      return res.status(400).json({ message: "Registration ID is required" });
    }

    const registration = await Registration.findById(registrationId);
    if (!registration) {
      return res.status(404).json({ message: "Registration not found" });
    }

    registration.paymentVerified = verified;

    if (verified) {
      registration.paymentStatus = "completed";
      registration.verificationDate = new Date();
      registration.verifiedBy = "admin";

      if (!registration.ticketId) {
        const lastTicket = await Registration.findOne({ eventId: registration.eventId })
          .sort({ ticketId: -1 })
          .select("ticketId");
        const newTicketId = lastTicket ? lastTicket.ticketId + 1 : 1;
        registration.ticketId = newTicketId;
      }

      if (!registration.ticket) {
        const event = await Event.findById(registration.eventId);
        const ticketData = {
          name: registration.name,
          ticketId: registration.ticketId,
          email: registration.email,
          phone: registration.phone || "Not provided",
          eventId: registration.eventId,
          eventName: event.name,
          venue: event.venue,
          date: event.date,
          fee: event.fee,
          paymentStatus: "Verified",
          registrationDate: registration.registrationDate,
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

        registration.ticket = qrImage;
      }

      const event = await Event.findById(registration.eventId);
      if (event) {
        const emailContent = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 5px;">
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
                  <td style="padding: 10px; border-bottom: 1px solid #eee;">${registration.phone || "Not provided"}</td>
                </tr>
                <tr>
                  <td style="padding: 10px; border-bottom: 1px solid #eee;"><strong>📌 Event:</strong></td>
                  <td style="padding: 10px; border-bottom: 1px solid #eee;">${event.name}</td>
                </tr>
                <tr>
                  <td style="padding: 10px; border-bottom: 1px solid #eee;"><strong>📅 Event Date:</strong></td>
                  <td style="padding: 10px; border-bottom: 1px solid #eee;">${new Date(event.date).toLocaleDateString("en-US", {
                    weekday: "long",
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}</td>
                </tr>
                <tr>
                  <td style="padding: 10px; border-bottom: 1px solid #eee;"><strong>📍 Venue:</strong></td>
                  <td style="padding: 10px; border-bottom: 1px solid #eee;">${event.venue}</td>
                </tr>
                <tr>
                  <td style="padding: 10px; border-bottom: 1px solid #eee;"><strong>📝 Description:</strong></td>
                  <td style="padding: 10px; border-bottom: 1px solid #eee;">${event.description || "N/A"}</td>
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
                  <td style="padding: 10px; border-bottom: 1px solid #eee;">${
                    registration.registrationDate
                      ? new Date(registration.registrationDate).toLocaleString("en-US", {
                          dateStyle: "full",
                          timeStyle: "short",
                        })
                      : "N/A"
                  }</td>
                </tr>
                <tr>
                  <td style="padding: 10px; border-bottom: 1px solid #eee;"><strong>🔄 Status:</strong></td>
                  <td style="padding: 10px; border-bottom: 1px solid #eee;"><span style="color: #4CAF50; font-weight: bold;">Confirmed</span></td>
                </tr>
              </table>
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

        const mailOptions = {
          from: buildFromAddress(event.emailForNotifications || process.env.EMAIL_USER),
          to: registration.email,
          subject: `Your Ticket for ${event.name} | Ticket #${registration.ticketId}`,
          html: emailContent,
          attachments: [
            {
              filename: "ticket.png",
              content: registration.ticket.split(";base64,").pop(),
              encoding: "base64",
              cid: "ticketQR",
            },
            {
              filename: `Yellowmatics_Ticket_${registration.ticketId}.png`,
              content: registration.ticket.split(";base64,").pop(),
              encoding: "base64",
            },
          ],
        };

        try {
          await sendEmail(event, mailOptions);
        } catch (emailError) {
          console.error("Error sending confirmation email:", emailError);
        }
      }
    }

    await registration.save();

    res.json({
      success: true,
      message: verified ? "Payment verified successfully" : "Payment verification removed",
      registration,
    });
  } catch (error) {
    console.error("Error updating payment verification:", error);
    res.status(500).json({ message: "Failed to update payment verification" });
  }
};

module.exports = {
  registerAdmin,
  loginAdmin,
  verifyToken,
  verifyPayment,
};

