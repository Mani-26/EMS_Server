/**
 * Debug utility for custom fields
 * 
 * Run this script with: node debug-custom-fields.js <registrationId>
 */

const mongoose = require('mongoose');
require('dotenv').config();

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log('Connected to MongoDB');
  debugRegistration();
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

async function debugRegistration() {
  try {
    const registrationId = process.argv[2];
    
    if (!registrationId) {
      console.error('Please provide a registration ID as an argument');
      process.exit(1);
    }
    
    console.log(`Debugging registration: ${registrationId}`);
    
    // Find the registration
    const registration = await Registration.findById(registrationId);
    
    if (!registration) {
      console.error('Registration not found');
      process.exit(1);
    }
    
    console.log('\n--- Registration Details ---');
    console.log(`Name: ${registration.name}`);
    console.log(`Email: ${registration.email}`);
    console.log(`Phone: ${registration.phone}`);
    console.log(`Event ID: ${registration.eventId}`);
    console.log(`Ticket ID: ${registration.ticketId}`);
    console.log(`Payment Status: ${registration.paymentStatus}`);
    console.log(`Payment Verified: ${registration.paymentVerified}`);
    console.log(`Registration Date: ${registration.registrationDate}`);
    
    console.log('\n--- Custom Field Values ---');
    console.log(`Type: ${registration.customFieldValues ? (registration.customFieldValues instanceof Map ? 'Map' : typeof registration.customFieldValues) : 'undefined'}`);
    
    if (registration.customFieldValues instanceof Map) {
      console.log('Size:', registration.customFieldValues.size);
      
      if (registration.customFieldValues.size > 0) {
        console.log('Values:');
        registration.customFieldValues.forEach((value, key) => {
          console.log(`  ${key}: ${JSON.stringify(value)}`);
        });
      } else {
        console.log('Map is empty');
      }
    } else if (typeof registration.customFieldValues === 'object') {
      console.log('Keys:', Object.keys(registration.customFieldValues).length);
      
      if (Object.keys(registration.customFieldValues).length > 0) {
        console.log('Values:');
        Object.entries(registration.customFieldValues).forEach(([key, value]) => {
          console.log(`  ${key}: ${JSON.stringify(value)}`);
        });
      } else {
        console.log('Object is empty');
      }
    }
    
    // Get the event to check custom fields
    const event = await Event.findById(registration.eventId);
    
    if (event) {
      console.log('\n--- Event Custom Fields ---');
      console.log(`Event Name: ${event.name}`);
      console.log(`Custom Fields Count: ${event.customFields ? event.customFields.length : 0}`);
      
      if (event.customFields && event.customFields.length > 0) {
        console.log('Custom Fields:');
        event.customFields.forEach((field, index) => {
          console.log(`  ${index + 1}. ${field.fieldName} (${field.fieldType}) - Required: ${field.isRequired}`);
        });
      } else {
        console.log('No custom fields defined for this event');
      }
    } else {
      console.log('\nEvent not found');
    }
    
    // Fix empty custom fields if needed
    if (event && event.customFields && event.customFields.length > 0 && 
        (!registration.customFieldValues || 
         (registration.customFieldValues instanceof Map && registration.customFieldValues.size === 0) ||
         (typeof registration.customFieldValues === 'object' && Object.keys(registration.customFieldValues).length === 0))) {
      
      console.log('\n--- Custom Fields Fix ---');
      console.log('This registration has empty custom fields for an event that requires them.');
      
      const fixOption = process.argv[3];
      
      if (fixOption === '--fix') {
        console.log('Attempting to fix custom fields...');
        
        // Create a new Map for custom fields
        const customFieldsMap = new Map();
        
        // Add placeholder values for each custom field
        event.customFields.forEach(field => {
          const defaultValue = getDefaultValueForType(field.fieldType);
          customFieldsMap.set(field.fieldName, defaultValue);
          console.log(`Setting default value for ${field.fieldName}: ${defaultValue}`);
        });
        
        // Update the registration
        registration.customFieldValues = customFieldsMap;
        await registration.save();
        
        console.log('Custom fields updated with default values');
      } else {
        console.log('To fix this issue, run the script with the --fix option:');
        console.log(`node debug-custom-fields.js ${registrationId} --fix`);
      }
    }
    
  } catch (error) {
    console.error('Error debugging registration:', error);
  } finally {
    // Disconnect from MongoDB
    mongoose.disconnect();
    console.log('\nDisconnected from MongoDB');
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