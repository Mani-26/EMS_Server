const mongoose = require("mongoose");

const connectDB = async (uri) => {
  if (!uri) {
    throw new Error("MONGO_URI is not defined");
  }

  mongoose.set("strictQuery", false);

  await mongoose.connect(uri);
  console.log("✅ MongoDB Connected");

  return mongoose.connection;
};

module.exports = connectDB;

