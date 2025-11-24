const { google } = require("googleapis");

const DEFAULT_REDIRECT_URI =
  process.env.OAUTH_REDIRECT_URI || "http://localhost:3000/oauth2callback";

const { BRAND_FROM_NAME } = require("../config/constants");

// Format From address to show only the brand name
const formatFromAddress = (email) => {
  const displayName = BRAND_FROM_NAME || "Yellowmatics.ai";
  // Format: "Display Name" <email> - Email clients will primarily show the display name
  return `"${displayName}" <${email}>`;
};

function encodeMessage(message) {
  return Buffer.from(message)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function normalizeAddress(address) {
  if (!address) return "";
  return Array.isArray(address) ? address.join(", ") : address;
}

function buildMimeMessage(mailOptions = {}) {
  const {
    from,
    to,
    cc,
    bcc,
    subject = "",
    text = "",
    html = "",
    attachments = [],
  } = mailOptions;

  if (!from || !to) {
    throw new Error("Both 'from' and 'to' fields are required for email sending.");
  }

  const newline = "\r\n";
  const hasAttachments = attachments.length > 0;
  const boundary = `====GMAIL_API_BOUNDARY_${Date.now()}====`;
  const headers = [
    `From: ${from}`,
    `To: ${normalizeAddress(to)}`,
  ];

  if (cc) headers.push(`Cc: ${normalizeAddress(cc)}`);
  if (bcc) headers.push(`Bcc: ${normalizeAddress(bcc)}`);

  headers.push(
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    hasAttachments
      ? `Content-Type: multipart/mixed; boundary="${boundary}"`
      : html
        ? 'Content-Type: text/html; charset="UTF-8"'
        : 'Content-Type: text/plain; charset="UTF-8"'
  );

  const body = [];

  if (hasAttachments) {
    body.push(`--${boundary}`);
    body.push('Content-Type: text/html; charset="UTF-8"');
    body.push("Content-Transfer-Encoding: 7bit", "");
    body.push(html || text || "");

    attachments.forEach((attachment) => {
      const {
        filename = "attachment",
        content,
        contentType = "application/octet-stream",
        cid,
        encoding,
      } = attachment;

      if (!content) {
        return;
      }

      const base64Content =
        encoding === "base64"
          ? content
          : Buffer.from(content, encoding || "utf-8").toString("base64");

      body.push("");
      body.push(`--${boundary}`);
      body.push(
        `${cid ? "Content-Disposition: inline" : "Content-Disposition: attachment"}; filename="${filename}"`
      );
      body.push(`Content-Type: ${contentType}; name="${filename}"`);
      if (cid) {
        body.push(`Content-ID: <${cid}>`);
      }
      body.push("Content-Transfer-Encoding: base64", "");
      body.push(base64Content.replace(/(.{76})/g, "$1\n"));
    });

    body.push("");
    body.push(`--${boundary}--`);
  } else {
    body.push("");
    body.push(html || text || "");
  }

  const mimeMessage = headers.concat("", body).join(newline);
  return encodeMessage(mimeMessage);
}

async function getGmailClient(emailUser) {
  if (!emailUser) {
    throw new Error("Email address not configured for this event.");
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "OAuth2 credentials missing. Please set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN in your .env file."
    );
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, DEFAULT_REDIRECT_URI);
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  try {
    const { token } = await oauth2Client.getAccessToken();
    if (!token) {
      throw new Error("Access token is null or undefined");
    }
  } catch (error) {
    console.error("❌ Error getting OAuth2 access token:", error);
    throw new Error(`Failed to get OAuth2 access token: ${error.message}`);
  }

  return google.gmail({ version: "v1", auth: oauth2Client });
}

async function sendEmail(event, mailOptions) {
  const emailUser = event?.emailForNotifications || process.env.EMAIL_USER;

  if (!emailUser) {
    throw new Error("EMAIL_USER not configured. Set EMAIL_USER in your environment.");
  }

  const gmail = await getGmailClient(emailUser);
  const fromAddress = mailOptions.from || formatFromAddress(emailUser);

  const message = buildMimeMessage({
    ...mailOptions,
    from: fromAddress,
  });

  try {
    const response = await gmail.users.messages.send({
      userId: "me",
      requestBody: {
        raw: message,
      },
    });
    return response.data;
  } catch (error) {
    console.error("❌ Error sending email via Gmail API:", error);
    throw error;
  }
}

module.exports = {
  sendEmail,
};

