/**
 * Fix script for a specific registration with sanitized keys
 * 
 * Run this script with: node fix-specific-registration-keys.js <registrationId>
 */

require('dotenv').config();
const mongoose = require('mongoose');

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI)
  .then(() => {
    console.log('Connected to MongoDB');
    fixRegistration();
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

async function fixRegistration() {
  try {
    const registrationId = process.argv[2] || "682dc69d5d7a39893bb8336a"; // Default to the ID you provided
    
    console.log(`Looking for registration with ID: ${registrationId}`);
    
    const registration = await Registration.findById(registrationId);
    
    if (!registration) {
      console.error('Registration not found');
      return;
    }
    
    console.log(`Found registration for ${registration.name} (${registration.email})`);
    console.log(`Event ID: ${registration.eventId}`);
    
    // Get the event to check custom fields
    const event = await Event.findById(registration.eventId);
    
    if (!event) {
      console.error('Event not found');
      return;
    }
    
    console.log(`Event: ${event.name}`);
    console.log(`Custom fields: ${event.customFields ? event.customFields.length : 0}`);
    
    // Get the expected field names from the event
    const expectedFieldNames = event.customFields.map(field => field.fieldName);
    console.log(`Expected field names: ${expectedFieldNames.join(', ')}`);
    
    // Create a new Map for custom fields
    const customFieldsMap = new Map();
    
    // Check if custom fields exist
    if (registration.customFieldValues && registration.customFieldValues instanceof Map) {
      console.log('Current custom fields:');
      for (const [key, value] of registration.customFieldValues.entries()) {
        console.log(`  ${key}: ${JSON.stringify(value)}`);
        
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
      console.log('No custom fields found or they\'re not a Map');
      
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
        console.log(`Setting default value for ${field.fieldName}: ${defaultValue}`);
      }
    }
    
    // Update the registration
    registration.customFieldValues = customFieldsMap;
    await registration.save();
    
    console.log('Registration updated with fixed custom fields');
    console.log('New custom fields:');
    for (const [key, value] of customFieldsMap.entries()) {
      console.log(`  ${key}: ${JSON.stringify(value)}`);
    }
    
  } catch (error) {
    console.error('Error fixing registration:', error);
  } finally {
    mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}