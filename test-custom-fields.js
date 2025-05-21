/**
 * Test script to verify custom fields are being stored correctly
 * 
 * Run this script with: node test-custom-fields.js
 */

const mongoose = require('mongoose');
require('dotenv').config();

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log('Connected to MongoDB');
  runTests();
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

async function runTests() {
  try {
    // Test 1: Create a registration with custom fields
    console.log('\n--- Test 1: Create a registration with custom fields ---');
    
    // Create a test registration with custom fields
    const testCustomFields = {
      'Full Name': 'Test User',
      'Age': 30,
      'Date of Birth': '1994-01-01',
      'Is Student': true,
      'Address.City': 'Test City', // Field with dot in name
      'Preferences': ['Reading', 'Coding']
    };
    
    // Convert to Map
    const customFieldMap = new Map();
    Object.entries(testCustomFields).forEach(([key, value]) => {
      // Sanitize key
      const sanitizedKey = key.replace(/\./g, '_');
      customFieldMap.set(sanitizedKey, value);
      console.log(`Setting custom field: ${sanitizedKey} = ${value}`);
    });
    
    // Create a test registration
    const testRegistration = new Registration({
      name: 'Test User',
      email: 'test@example.com',
      phone: '1234567890',
      eventId: mongoose.Types.ObjectId(),
      ticketId: 12345,
      paymentStatus: 'completed',
      customFieldValues: customFieldMap
    });
    
    // Save the registration
    await testRegistration.save();
    console.log('Test registration created with ID:', testRegistration._id);
    
    // Test 2: Retrieve the registration and check custom fields
    console.log('\n--- Test 2: Retrieve the registration and check custom fields ---');
    
    // Retrieve the registration
    const retrievedRegistration = await Registration.findById(testRegistration._id);
    console.log('Retrieved registration:', retrievedRegistration.name);
    
    // Check if customFieldValues is a Map
    console.log('customFieldValues is a Map:', retrievedRegistration.customFieldValues instanceof Map);
    
    // Print all custom field values
    console.log('Custom field values:');
    retrievedRegistration.customFieldValues.forEach((value, key) => {
      console.log(`  ${key}: ${JSON.stringify(value)}`);
    });
    
    // Test 3: Convert Map to object for API response
    console.log('\n--- Test 3: Convert Map to object for API response ---');
    
    // Convert Map to object
    const customFieldObject = {};
    retrievedRegistration.customFieldValues.forEach((value, key) => {
      customFieldObject[key] = value;
    });
    
    console.log('Custom fields as object:', customFieldObject);
    
    // Test 4: Clean up
    console.log('\n--- Test 4: Clean up ---');
    
    // Delete the test registration
    await Registration.deleteOne({ _id: testRegistration._id });
    console.log('Test registration deleted');
    
    console.log('\nAll tests completed successfully!');
  } catch (error) {
    console.error('Error running tests:', error);
  } finally {
    // Disconnect from MongoDB
    mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}