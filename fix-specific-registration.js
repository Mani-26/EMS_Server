/**
 * Fix script for a specific registration
 * 
 * Run this script with: node fix-specific-registration.js <registrationId>
 */

const mongoose = require('mongoose');
require('dotenv').config();

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log('Connected to MongoDB');
  fixRegistration();
}).catch(err => {
  console.error('MongoDB connection error:', err);
});

// Define the Registration schema
const registrationSchema = new mongoose.Schema({
  name: String,
  email: String,
  phone: String,
  eventId: mongoose.Schema.Types.ObjectId,
  ticketId: Number,
  ticket: String,
  attended: { type: Boolean, default: false },
  paymentStatus: { type: String, enum: ['pending', 'completed', 'failed'], default: 'pending' },
  paymentId: String,
  transactionId: String,
  paymentMethod: { type: String, enum: ['card', 'upi'], default: 'card' },
  paymentScreenshot: String,
  paymentVerified: { type: Boolean, default: false },
  verificationDate: Date,
  verifiedBy: String,
  registrationDate: { type: Date, default: Date.now },
  customFieldValues: { 
    type: Map, 
    of: mongoose.Schema.Types.Mixed,
    default: () => new Map()
  }
});

const Registration = mongoose.model('Registration', registrationSchema);

// Define the Event schema
const eventSchema = new mongoose.Schema({
  name: String,
  description: String,
  date: Date,
  venue: String,
  organizer: String,
  seatLimit: Number,
  registeredUsers: { type: Number, default: 0 },
  isFree: { type: Boolean, default: true },
  fee: { type: Number, default: 0 },
  isPublished: { type: Boolean, default: true },
  customFields: [
    {
      fieldName: String,
      fieldType: String,
      isRequired: Boolean,
      options: [String],
      placeholder: String
    }
  ]
});

const Event = mongoose.model('Event', eventSchema);

async function fixRegistration() {
  try {
    const registrationId = process.argv[2] || "682dc3531d6ecbcb255040b9"; // Default to the ID you provided
    
    console.log(`Fixing registration: ${registrationId}`);
    
    // Find the registration
    const registration = await Registration.findById(registrationId);
    
    if (!registration) {
      console.error('Registration not found');
      process.exit(1);
    }
    
    console.log(`Found registration for ${registration.name} (${registration.email})`);
    
    // Get the event to check custom fields
    const event = await Event.findById(registration.eventId);
    
    if (!event) {
      console.error('Event not found');
      process.exit(1);
    }
    
    console.log(`Event: ${event.name}`);
    console.log(`Custom fields: ${event.customFields ? event.customFields.length : 0}`);
    
    if (!event.customFields || event.customFields.length === 0) {
      console.log('No custom fields defined for this event. Nothing to fix.');
      process.exit(0);
    }
    
    // Create a new Map for custom fields
    const customFieldsMap = new Map();
    
    // Add custom field values
    // You can customize these values based on what should have been entered
    const customValues = {
      // Example: 'Full Name': 'Mani',
      // Example: 'Company': 'Innovator',
      // Add more fields as needed
    };
    
    // Add values for each custom field
    event.customFields.forEach(field => {
      // Check if we have a custom value for this field
      if (customValues[field.fieldName]) {
        customFieldsMap.set(field.fieldName, customValues[field.fieldName]);
        console.log(`Setting custom value for ${field.fieldName}: ${customValues[field.fieldName]}`);
      } else {
        // Use a default value based on the field type
        const defaultValue = getDefaultValueForType(field.fieldType);
        customFieldsMap.set(field.fieldName, defaultValue);
        console.log(`Setting default value for ${field.fieldName}: ${defaultValue}`);
      }
    });
    
    // Update the registration
    registration.customFieldValues = customFieldsMap;
    await registration.save();
    
    console.log('Registration updated with custom field values');
    
    // Verify the update
    const updatedRegistration = await Registration.findById(registrationId);
    console.log('Updated custom field values:');
    updatedRegistration.customFieldValues.forEach((value, key) => {
      console.log(`  ${key}: ${JSON.stringify(value)}`);
    });
    
  } catch (error) {
    console.error('Error fixing registration:', error);
  } finally {
    // Disconnect from MongoDB
    mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

function getDefaultValueForType(fieldType) {
  switch (fieldType) {
    case 'text':
      return 'Not provided';
    case 'email':
      return 'Not provided';
    case 'number':
      return 0;
    case 'date':
      return new Date().toISOString().split('T')[0];
    case 'select':
      return 'Not selected';
    case 'checkbox':
      return false;
    default:
      return 'Not provided';
  }
}