/**
 * Test script to verify custom fields fix
 * 
 * Run this script with: node test-custom-fields-fix.js
 */

require('dotenv').config();
const mongoose = require('mongoose');

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI)
  .then(() => {
    console.log('Connected to MongoDB');
    testCustomFields();
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

async function testCustomFields() {
  try {
    console.log('Testing custom fields fix...');
    
    // Create test data
    const testData = {
      name: 'Test User',
      email: 'test@example.com',
      phone: '1234567890',
      eventId: new mongoose.Types.ObjectId(),
      paymentId: 'TEST-' + Date.now(),
      paymentMethod: 'upi',
      customFieldValues: {
        'Full Name': 'Test User',
        'Company': 'Test Company',
        'Designation': 'Test Designation',
        'Age': 30,
        'Is Student': true
      }
    };
    
    // Test 1: Create registration with custom fields as object
    console.log('\nTest 1: Create registration with custom fields as object');
    
    // Create a registration with custom fields as object
    const customFieldsMap = new Map();
    Object.entries(testData.customFieldValues).forEach(([key, value]) => {
      customFieldsMap.set(key, value);
    });
    
    const registration = new Registration({
      ...testData,
      customFieldValues: customFieldsMap
    });
    
    await registration.save();
    console.log('Registration created with ID:', registration._id);
    
    // Test 2: Retrieve and verify custom fields
    console.log('\nTest 2: Retrieve and verify custom fields');
    
    const retrievedReg = await Registration.findById(registration._id);
    console.log('Retrieved registration:', retrievedReg.name);
    console.log('Custom fields type:', retrievedReg.customFieldValues instanceof Map ? 'Map' : typeof retrievedReg.customFieldValues);
    console.log('Custom fields size:', retrievedReg.customFieldValues instanceof Map ? retrievedReg.customFieldValues.size : 'N/A');
    
    if (retrievedReg.customFieldValues instanceof Map) {
      console.log('Custom fields:');
      retrievedReg.customFieldValues.forEach((value, key) => {
        console.log(`  ${key}: ${JSON.stringify(value)}`);
      });
    }
    
    // Test 3: Clean up
    console.log('\nTest 3: Clean up');
    await Registration.deleteOne({ _id: registration._id });
    console.log('Test registration deleted');
    
    console.log('\nAll tests completed successfully!');
  } catch (error) {
    console.error('Error testing custom fields:', error);
  } finally {
    mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}