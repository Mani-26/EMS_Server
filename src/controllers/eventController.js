const ExcelJS = require("exceljs");

const Event = require("../models/Event");
const Registration = require("../models/Registration");

const getEventRegistrations = async (req, res) => {
  try {
    const { eventId } = req.params;
    const event = await Event.findById(eventId);
    if (!event) return res.status(404).json({ message: "Event not found" });

    const eventCustomFields = event.customFields || [];
    const registrationsData = await Registration.find({ eventId }).lean();

    const processedRegistrations = registrationsData.map((registration) => {
      let processedCustomFieldValues = {};
      let hasCustomFields = registration.hasCustomFields || false;

      if (registration.customFieldValues) {
        if (typeof registration.customFieldValues === "string") {
          try {
            processedCustomFieldValues = JSON.parse(registration.customFieldValues);
            hasCustomFields = Object.keys(processedCustomFieldValues).length > 0;
          } catch (e) {
            console.error("Error parsing customFieldValues JSON string:", e);
          }
        } else if (registration.customFieldValues instanceof Map) {
          processedCustomFieldValues = {};
          registration.customFieldValues.forEach((value, key) => {
            processedCustomFieldValues[key] = value;
          });
          hasCustomFields = Object.keys(processedCustomFieldValues).length > 0;
        } else if (
          typeof registration.customFieldValues === "object" &&
          !Array.isArray(registration.customFieldValues)
        ) {
          processedCustomFieldValues = registration.customFieldValues;
          hasCustomFields = Object.keys(processedCustomFieldValues).length > 0;
        }
      }

      return {
        ...registration,
        customFieldValues: processedCustomFieldValues,
        hasCustomFields,
        eventCustomFields,
      };
    });

    setTimeout(() => {
      res.json({
        success: true,
        registrations: processedRegistrations,
        eventCustomFields,
      });
    }, 300);
  } catch (error) {
    console.error("Error fetching registrations:", error);
    res.status(500).json({
      success: false,
      message: error.response?.data?.message || "Failed to fetch registrations.",
    });
  }
};

/**
 * Helper function to convert column number to Excel column letter (A, B, ..., Z, AA, AB, etc.)
 * Supports columns beyond Z (AA, AB, AC, etc.)
 */
const getColumnLetter = (colNum) => {
  let result = '';
  while (colNum > 0) {
    const remainder = (colNum - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    colNum = Math.floor((colNum - 1) / 26);
  }
  return result || 'A';
};

/**
 * Helper function to safely extract custom field values from various formats
 */
const extractCustomFieldValue = (customFieldValues, fieldName) => {
  if (!customFieldValues || !fieldName) return "";

  try {
    // Handle Map type (Mongoose Map)
    if (customFieldValues instanceof Map) {
      const value = customFieldValues.get(fieldName);
      return value !== null && value !== undefined ? String(value) : "";
    }

    // Handle string (JSON stringified)
    if (typeof customFieldValues === "string") {
      try {
        const parsed = JSON.parse(customFieldValues);
        if (parsed && typeof parsed === "object" && parsed[fieldName] !== undefined) {
          return String(parsed[fieldName]);
        }
      } catch (e) {
        // If not valid JSON, check if it's a direct string match
        return "";
      }
    }

    // Handle plain object
    if (typeof customFieldValues === "object" && customFieldValues !== null && !Array.isArray(customFieldValues)) {
      if (customFieldValues[fieldName] !== undefined) {
        const value = customFieldValues[fieldName];
        return value !== null && value !== undefined ? String(value) : "";
      }
    }
  } catch (error) {
    console.error(`Error extracting custom field "${fieldName}":`, error);
  }

  return "";
};

/**
 * Helper function to format dates consistently
 */
const formatDate = (dateValue, includeTime = true) => {
  if (!dateValue) return "N/A";
  
  try {
    const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
    if (isNaN(date.getTime())) return "Invalid Date";
    
    if (includeTime) {
      return date.toLocaleString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      });
    } else {
      return date.toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    }
  } catch (error) {
    return "Invalid Date";
  }
};

/**
 * Download event registrations as Excel file - Production Ready Version
 */
const downloadEventRegistrations = async (req, res) => {
  try {
    const { eventId } = req.params;
    
    // Fetch event and registrations
    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }

    const registrations = await Registration.find({ eventId }).sort({ registrationDate: -1 });

    // Initialize workbook
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Yellowmatics Events Management System";
    workbook.lastModifiedBy = "System";
    workbook.created = new Date();
    workbook.modified = new Date();

    // Clean worksheet name (Excel has restrictions: max 31 chars, cannot contain * ? : \ / [ ])
    // Remove all invalid characters including colon, comma, and other special chars
    const cleanEventName = ((event.name || "Event")
      .replace(/[*?:\\\/\[\]]/g, "") // Remove invalid characters: * ? : \ / [ ]
      .replace(/['"]/g, "") // Remove quotes
      .replace(/,/g, " ") // Replace commas with spaces
      .trim()
      .substring(0, 31) || "Event").trim() || "Event";
    
    const worksheet = workbook.addWorksheet(cleanEventName);

    // Define all columns - including all registration fields
    const baseColumns = [
      { header: "S.No", key: "serialNumber", width: 8 },
      { header: "Name", key: "name", width: 30 },
      { header: "Email", key: "email", width: 35 },
      { header: "Phone", key: "phone", width: 18 },
      { header: "Ticket ID", key: "ticketId", width: 15 },
      { header: "Registration Date", key: "registrationDate", width: 22 },
    ];

    // Add payment-related columns (only for paid events or if any registration has payment info)
    const hasPaymentInfo = !event.isFree || registrations.some(r => r.paymentStatus || r.paymentId);
    if (hasPaymentInfo) {
      baseColumns.push(
        { header: "Payment Status", key: "paymentStatus", width: 18 },
        { header: "Payment ID", key: "paymentId", width: 25 },
        { header: "Payment Method", key: "paymentMethod", width: 18 },
        { header: "Payment Verified", key: "paymentVerified", width: 18 },
        { header: "Verification Date", key: "verificationDate", width: 22 },
        { header: "Verified By", key: "verifiedBy", width: 18 }
      );
    }

    // Add custom fields columns
    const customFieldMap = new Map(); // Track custom field keys for later use
    if (event.customFields && Array.isArray(event.customFields) && event.customFields.length > 0) {
      event.customFields.forEach((field) => {
        if (field && field.fieldName) {
          const sanitizedKey = `custom_${field.fieldName.replace(/[\s\-]/g, "_").replace(/[^a-zA-Z0-9_]/g, "")}`;
          customFieldMap.set(field.fieldName, sanitizedKey);
          baseColumns.push({
            header: field.fieldName,
            key: sanitizedKey,
            width: Math.max(20, Math.min(50, field.fieldName.length + 5)),
          });
        }
      });
    }

    // Calculate total columns and last column letter for merging
    const totalColumns = baseColumns.length;
    const lastColumn = getColumnLetter(totalColumns);

    // Build header section with merged cells
    // Row 1: Event Title
    worksheet.mergeCells(`A1:${lastColumn}1`);
    const titleCell = worksheet.getCell("A1");
    titleCell.value = event.name || "Event";
    titleCell.font = { size: 16, bold: true, color: { argb: "4F46E5" } };
    titleCell.alignment = { horizontal: "center", vertical: "middle" };
    worksheet.getRow(1).height = 25;

    // Row 2: Event Date
    worksheet.mergeCells(`A2:${lastColumn}2`);
    const dateCell = worksheet.getCell("A2");
    dateCell.value = `Date: ${formatDate(event.date, false)}`;
    dateCell.font = { size: 11, italic: true };
    dateCell.alignment = { horizontal: "center", vertical: "middle" };

    // Row 3: Venue
    worksheet.mergeCells(`A3:${lastColumn}3`);
    const venueCell = worksheet.getCell("A3");
    venueCell.value = `Venue: ${event.venue || "N/A"}`;
    venueCell.font = { size: 11, italic: true };
    venueCell.alignment = { horizontal: "center", vertical: "middle" };

    // Row 4: Summary Info
    worksheet.mergeCells(`A4:${lastColumn}4`);
    const summaryCell = worksheet.getCell("A4");
    const totalReg = registrations.length;
    const paidReg = registrations.filter(r => r.paymentStatus === "completed").length;
    const pendingReg = registrations.filter(r => r.paymentStatus !== "completed" && r.paymentStatus !== "free").length;
    
    let summaryText = `Total Registrations: ${totalReg}`;
    if (!event.isFree && hasPaymentInfo) {
      summaryText += ` | Paid: ${paidReg} | Pending: ${pendingReg}`;
    }
    summaryCell.value = summaryText;
    summaryCell.font = { size: 11, bold: true };
    summaryCell.alignment = { horizontal: "center", vertical: "middle" };

    // Row 5: Empty row for spacing
    worksheet.addRow([]);

    // Set columns and get header row (will be row 6)
    worksheet.columns = baseColumns;
    const headerRow = worksheet.getRow(6);
    
    // Style header row
    headerRow.font = { bold: true, size: 11, color: { argb: "FFFFFF" } };
    headerRow.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    headerRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "4F46E5" },
    };
    headerRow.height = 25;

    // Add data rows
    registrations.forEach((registration, index) => {
      const rowData = {
        serialNumber: index + 1,
        name: registration.name || "N/A",
        email: registration.email || "N/A",
        phone: registration.phone || "N/A",
        ticketId: registration.ticketId ? `#${registration.ticketId}` : "N/A",
        registrationDate: formatDate(registration.registrationDate, true),
      };

      // Add payment fields if applicable
      if (hasPaymentInfo) {
        rowData.paymentStatus = registration.paymentStatus || "pending";
        rowData.paymentId = registration.paymentId || "N/A";
        rowData.paymentMethod = registration.paymentMethod || "N/A";
        rowData.paymentVerified = registration.paymentVerified ? "Yes" : "No";
        rowData.verificationDate = formatDate(registration.verificationDate, true);
        rowData.verifiedBy = registration.verifiedBy || "N/A";
      }

      // Add custom field values
      customFieldMap.forEach((key, fieldName) => {
        rowData[key] = extractCustomFieldValue(registration.customFieldValues, fieldName);
      });

      const row = worksheet.addRow(rowData);

      // Style the row
      row.eachCell((cell, colNumber) => {
        // Skip serial number column alignment (keep center)
        if (colNumber === 1) {
          cell.alignment = { vertical: "middle", horizontal: "center" };
        } else if (colNumber === 2) {
          // Name column - left align
          cell.alignment = { vertical: "middle", horizontal: "left" };
        } else if (colNumber === 3) {
          // Email column - left align with blue color
          cell.alignment = { vertical: "middle", horizontal: "left" };
          cell.font = { color: { argb: "1D4ED8" } };
        } else {
          // Other columns - center align
          cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
        }
      });
    });

    // Set column-specific alignments
    worksheet.getColumn("name").alignment = { horizontal: "left" };
    worksheet.getColumn("email").alignment = { horizontal: "left" };

    // Add summary section at the bottom
    worksheet.addRow([]);
    worksheet.addRow([]);

    const summaryStartRow = worksheet.rowCount + 1;
    
    // Add summary statistics
    if (!event.isFree && hasPaymentInfo) {
      const completedCount = registrations.filter(r => r.paymentStatus === "completed").length;
      const pendingCount = registrations.filter(r => r.paymentStatus !== "completed" && r.paymentStatus !== "free").length;
      const verifiedCount = registrations.filter(r => r.paymentVerified === true).length;
      
      worksheet.addRow(["", "", "", "Summary Statistics:", "", "", "", "", ""]);
      worksheet.addRow(["", "", "", `Total Completed Payments: ${completedCount}`, "", "", "", "", ""]);
      worksheet.addRow(["", "", "", `Total Pending Payments: ${pendingCount}`, "", "", "", "", ""]);
      worksheet.addRow(["", "", "", `Total Verified Payments: ${verifiedCount}`, "", "", "", "", ""]);
    } else {
      worksheet.addRow(["", "", "", `Total Registrations: ${registrations.length}`, "", "", "", "", ""]);
    }

    // Style summary rows
    for (let i = summaryStartRow; i <= worksheet.rowCount; i++) {
      const row = worksheet.getRow(i);
      row.font = { bold: true };
      row.getCell(4).font = { bold: true, size: 11 };
    }

    // Auto-fit columns (with max width limits)
    worksheet.columns.forEach((column) => {
      if (column.width) {
        column.width = Math.min(column.width, 50); // Cap at 50
      }
    });

    // Set filename
    const filename = req.query.filename || 
      `${(event.name || "Event").replace(/[^a-zA-Z0-9]/g, "_")}_Registrations_${new Date().toISOString().split('T')[0]}.xlsx`;

    // Determine content disposition
    const userAgent = req.headers["user-agent"] || "";
    const isMobileUserAgent = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent);
    const isDirectAccess =
      req.query.direct === "true" || (isMobileUserAgent && req.headers["sec-fetch-dest"] !== "empty");

    // Set response headers
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `${isDirectAccess ? "inline" : "attachment"}; filename="${encodeURIComponent(filename)}"`
    );
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    res.setHeader("X-Content-Type-Options", "nosniff");

    // Write workbook to response
    await workbook.xlsx.write(res);
    res.end();

  } catch (error) {
    console.error("Error generating Excel file:", error);
    res.status(500).json({ 
      message: "Failed to generate Excel file",
      error: process.env.NODE_ENV === "development" ? error.message : undefined
    });
  }
};

const getEvents = async (req, res) => {
  try {
    const events = await Event.find().sort({ date: -1 });
    res.json(events);
  } catch (error) {
    console.error("Error fetching events:", error);
    res.status(500).json({ message: "Error fetching events", error });
  }
};

const createEvent = async (req, res) => {
  const {
    name,
    date,
    description,
    venue,
    seatLimit,
    isFree,
    fee,
    featured,
    customFields,
    upiId,
    phoneNumber,
    emailForNotifications,
  } = req.body;

  if (!name || !date || !description || !venue || !seatLimit) {
    return res.status(400).json({ message: "All fields are required" });
  }

  if (isFree === false && (!fee || fee <= 0)) {
    return res.status(400).json({ message: "Fee amount is required for paid events" });
  }

  try {
    let validatedCustomFields = [];
    if (customFields && Array.isArray(customFields)) {
      validatedCustomFields = customFields.map((field) => {
        if (!field.fieldName) {
          throw new Error("All custom fields must have a name");
        }

        if (!["text", "email", "number", "date", "select", "checkbox"].includes(field.fieldType)) {
          field.fieldType = "text";
        }

        if (field.fieldType === "select" && (!field.options || !Array.isArray(field.options))) {
          field.options = [];
        }

        return {
          fieldName: field.fieldName,
          fieldType: field.fieldType,
          isRequired: !!field.isRequired,
          options: field.options || [],
          placeholder: field.placeholder || "",
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
      featured: featured || false,
      upiId: upiId || process.env.UPI_ID,
      phoneNumber: phoneNumber || "",
      emailForNotifications: emailForNotifications || process.env.EMAIL_USER,
      customFields: validatedCustomFields,
    });

    await newEvent.save();
    res.status(201).json({ message: "Event created successfully!", event: newEvent });
  } catch (error) {
    console.error("Error in event creation:", error);
    res.status(500).json({
      message: "Error creating event",
      error: error.message,
    });
  }
};

const getEventById = async (req, res) => {
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
      featured: event.featured || false,
      upiId: event.upiId || "",
      phoneNumber: event.phoneNumber || "",
      emailForNotifications: event.emailForNotifications || "",
      customFields: event.customFields || [],
    });
  } catch (error) {
    res.status(500).json({ message: "Error fetching event", error });
  }
};

const updateEvent = async (req, res) => {
  const { id } = req.params;
  const {
    name,
    date,
    description,
    venue,
    seatLimit,
    isFree,
    fee,
    featured,
    upiId,
    phoneNumber,
    customFields,
  } = req.body;

  try {
    const event = await Event.findById(id);
    if (!event) {
      return res.status(404).json({ message: "Event not found!" });
    }

    if (isFree === false && (!fee || fee <= 0)) {
      return res.status(400).json({ message: "Fee amount is required for paid events" });
    }

    if (seatLimit !== undefined && seatLimit !== event.seatLimit) {
      const seatDifference = seatLimit - event.seatLimit;
      event.remainingSeats = Math.max((event.remainingSeats || 0) + seatDifference, 0);
    }

    event.name = name || event.name;
    event.date = date || event.date;
    event.description = description || event.description;
    event.venue = venue || event.venue;
    event.seatLimit = seatLimit || event.seatLimit;

    if (isFree !== undefined) {
      event.isFree = isFree;
      event.fee = isFree === false ? fee || event.fee : 0;
    }

    event.featured = featured !== undefined ? featured : event.featured;

    if (upiId !== undefined) {
      event.upiId = upiId;
    }

    if (phoneNumber !== undefined) {
      event.phoneNumber = phoneNumber;
    }

    if (customFields !== undefined) {
      if (Array.isArray(customFields)) {
        event.customFields = customFields.map((field) => {
          if (!field.fieldName) {
            throw new Error("All custom fields must have a name");
          }

          if (!["text", "email", "number", "date", "select", "checkbox"].includes(field.fieldType)) {
            field.fieldType = "text";
          }

          if (field.fieldType === "select" && (!field.options || !Array.isArray(field.options))) {
            field.options = [];
          }

          return {
            fieldName: field.fieldName,
            fieldType: field.fieldType,
            isRequired: !!field.isRequired,
            options: field.options || [],
            placeholder: field.placeholder || "",
          };
        });
      } else {
        event.customFields = [];
      }
    }

    await event.save();

    res.json({
      message: "✅ Event updated successfully!",
      event: {
        id: event._id,
        name: event.name,
        upiId: event.upiId,
        phoneNumber: event.phoneNumber,
        featured: event.featured,
        customFields: event.customFields,
      },
    });
  } catch (error) {
    console.error("Error updating event:", error);
    res.status(500).json({ message: "❌ Server error while updating", error: error.message });
  }
};

const deleteEvent = async (req, res) => {
  try {
    const event = await Event.findByIdAndDelete(req.params.id);
    if (!event) {
      return res.status(404).json({ message: "Event not found!" });
    }
    res.json({ message: "❌ Event deleted successfully!", event });
  } catch (error) {
    res.status(500).json({ message: "Server error while deleting", error });
  }
};

module.exports = {
  getEventRegistrations,
  downloadEventRegistrations,
  getEvents,
  createEvent,
  getEventById,
  updateEvent,
  deleteEvent,
};

