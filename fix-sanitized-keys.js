/**
 * Fix script for registrations with sanitized keys
 * 
 * Run this script with: node fix-sanitized-keys.js
 */

require('dotenv').config();
const mongoose = require('mongoose');

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI)
  .then(() => {
    console.log('Connected to MongoDB');
    fixSanitizedKeys();
  })
  .catch(err => {
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
  date: String,
  description: String,
  venue: String,
  seatLimit: Number,
  registeredUsers: { type: Number, default: 0 },
  isFree: { type: Boolean, default: true },
  fee: { type: Number, default: 0 },
  featured: { type: Boolean, default: false },
  upiId: String,
  phoneNumber: String,
  emailForNotifications: String,
  appPassword: String,
  customFields: [{ 
    fieldName: String,
    fieldType: { type: String, enum: ['text', 'email', 'number', 'date', 'select', 'checkbox'], default: 'text' },
    isRequired: { type: Boolean, default: false },
    options: [String],
    placeholder: String
  }]
});

const Event = mongoose.model('Event', eventSchema);

async function fixSanitizedKeys() {
  try {
    console.log('Looking for registrations with sanitized keys...');
    
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
      
      // Get the expected field names from the event
      const expectedFieldNames = event.customFields.map(field => field.fieldName);
      console.log(`Expected field names: ${expectedFieldNames.join(', ')}`);
      
      // Process each registration
      for (const registration of registrations) {
        let needsFix = false;
        const customFieldsMap = new Map();
        
        // Check if custom fields exist
        if (registration.customFieldValues && registration.customFieldValues instanceof Map) {
          // Check each key to see if it's sanitized
          for (const [key, value] of registration.customFieldValues.entries()) {
            // Check if the key contains underscores that might have been dots
            if (key.includes('_') && !expectedFieldNames.includes(key)) {
              // Try to find a matching expected field name
              const possibleOriginalKey = expectedFieldNames.find(fieldName => 
                fieldName.replace(/\./g, '_') === key || 
                key.replace(/_/g, '.') === fieldName
              );
              
              if (possibleOriginalKey) {
                console.log(`Found sanitized key: ${key} -> ${possibleOriginalKey}`);
                customFieldsMap.set(possibleOriginalKey, value);
                needsFix = true;
              } else {
                // Keep the original key if no match found
                customFieldsMap.set(key, value);
              }
            } else {
              // Keep the original key
              customFieldsMap.set(key, value);
            }
          }
        } else {
          console.log(`Registration ${registration._id} has no custom fields or they're not a Map`);
          
          // Create default custom fields
          for (const field of event.customFields) {
            let defaultValue;
            
            switch (field.fieldType) {
              case 'text':
                defaultValue = 'Not provided';
                break;
              case 'email':
                defaultValue = 'Not provided';
                break;
              case 'number':
                defaultValue = 0;
                break;
              case 'date':
                defaultValue = new Date().toISOString().split('T')[0];
                break;
              case 'select':
                defaultValue = field.options && field.options.length > 0 ? field.options[0] : 'Not selected';
                break;
              case 'checkbox':
                defaultValue = false;
                break;
              default:
                defaultValue = 'Not provided';
            }
            
            customFieldsMap.set(field.fieldName, defaultValue);
          }
          
          needsFix = true;
        }
        
        // Update the registration if needed
        if (needsFix) {
          console.log(`Fixing registration for ${registration.name} (${registration._id})`);
          registration.customFieldValues = customFieldsMap;
          await registration.save();
          console.log(`Fixed registration for ${registration.name}`);
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
    mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}