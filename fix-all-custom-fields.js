/**
 * Fix script for all registrations with missing custom fields
 * 
 * Run this script with: node fix-all-custom-fields.js
 */

const mongoose = require('mongoose');
require('dotenv').config();

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log('Connected to MongoDB');
  fixAllRegistrations();
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

async function fixAllRegistrations() {
  try {
    console.log('Starting to fix all registrations with missing custom fields...');
    
    // Get all events with custom fields
    const events = await Event.find({ 'customFields.0': { $exists: true } });
    console.log(`Found ${events.length} events with custom fields`);
    
    let totalFixed = 0;
    
    // Process each event
    for (const event of events) {
      console.log(`\nProcessing event: ${event.name} (${event._id})`);
      console.log(`Custom fields: ${event.customFields.length}`);
      
      // Get all registrations for this event
      const registrations = await Registration.find({ eventId: event._id });
      console.log(`Found ${registrations.length} registrations for this event`);
      
      let eventFixed = 0;
      
      // Process each registration
      for (const registration of registrations) {
        // Check if custom fields are missing
        if (!registration.customFieldValues || 
            (registration.customFieldValues instanceof Map && registration.customFieldValues.size === 0) ||
            (typeof registration.customFieldValues === 'object' && Object.keys(registration.customFieldValues).length === 0)) {
          
          console.log(`\nFixing registration for ${registration.name} (${registration._id})`);
          
          // Create a new Map for custom fields
          const customFieldsMap = new Map();
          
          // Add placeholder values for each custom field
          event.customFields.forEach(field => {
            const defaultValue = getDefaultValueForType(field.fieldType);
            customFieldsMap.set(field.fieldName, defaultValue);
            console.log(`  Setting default value for ${field.fieldName}: ${defaultValue}`);
          });
          
          // Update the registration
          registration.customFieldValues = customFieldsMap;
          await registration.save();
          
          console.log(`  Fixed registration for ${registration.name}`);
          eventFixed++;
          totalFixed++;
        }
      }
      
      console.log(`Fixed ${eventFixed} registrations for event: ${event.name}`);
    }
    
    console.log(`\nTotal registrations fixed: ${totalFixed}`);
    
  } catch (error) {
    console.error('Error fixing registrations:', error);
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