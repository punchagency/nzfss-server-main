// Script to find and fix mushers with invalid club references
const mongoose = require('mongoose');
const { config } = require('dotenv');
const path = require('path');

// Load environment variables
config({ path: path.resolve(__dirname, '../.env') });

// MongoDB connection string (use server-style env var naming)
const MONGODB_URI = process.env.MONGODB_STRING || process.env.MONGODB_URI || 'mongodb://localhost:27017/nzfss';

// Connect to MongoDB
mongoose.connect(MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

// Define a simplified Musher schema for this script
const musherSchema = new mongoose.Schema({
  name: String,
  registrationNo: String,
  kennelRegistrationNo: String,
  club: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Club',
    required: true
  },
  dogs: Array,
  showProfileConsent: Boolean,
  createdAt: Date,
  updatedAt: Date
});

// Define a simplified Club schema for this script
const clubSchema = new mongoose.Schema({
  clubName: String,
  email: String,
  password: String,
  createdAt: Date
});

// Register models
const Musher = mongoose.model('Musher', musherSchema);
const Club = mongoose.model('Club', clubSchema);

async function findMushersWithInvalidClubReferences() {
  try {
    console.log('Scanning for mushers with invalid club references...');
    
    // Get all mushers
    const mushers = await Musher.find().lean();
    console.log(`Found ${mushers.length} total mushers`);
    
    // Find all existing club IDs
    const clubs = await Club.find().lean();
    const clubIds = clubs.map(club => club._id.toString());
    console.log(`Found ${clubs.length} clubs`);
    
    // Find mushers with invalid club references
    const invalidMushers = [];
    
    for (const musher of mushers) {
      if (!musher.club) {
        console.log(`Musher ${musher._id} has no club reference`);
        invalidMushers.push(musher);
        continue;
      }
      
      const clubId = musher.club.toString();
      if (!clubIds.includes(clubId)) {
        console.log(`Musher ${musher._id} references non-existent club: ${clubId}`);
        invalidMushers.push(musher);
      }
    }
    
    console.log(`Found ${invalidMushers.length} mushers with invalid club references`);
    
    if (invalidMushers.length > 0) {
      // List the problematic mushers
      console.log('\nProblematic mushers:');
      invalidMushers.forEach(musher => {
        console.log(`ID: ${musher._id}, Name: ${musher.name}, Club Reference: ${musher.club || 'null'}`);
      });
      
      // Prompt for default club ID if needed
      if (clubIds.length > 0) {
        console.log('\nAvailable clubs:');
        clubs.forEach(club => {
          console.log(`ID: ${club._id}, Name: ${club.clubName}`);
        });
        
        console.log('\nTo fix these mushers, run this script with the FIX_MUSHERS=true and DEFAULT_CLUB_ID=<club_id> environment variables');
      } else {
        console.log('\nNo clubs found in the database. Please create at least one club before fixing mushers.');
      }
    }
    
    // Fix mushers if FIX_MUSHERS=true and DEFAULT_CLUB_ID is provided
    if (process.env.FIX_MUSHERS === 'true' && process.env.DEFAULT_CLUB_ID) {
      const defaultClubId = process.env.DEFAULT_CLUB_ID;
      
      // Verify the default club exists
      if (!clubIds.includes(defaultClubId)) {
        console.error(`Default club ID ${defaultClubId} does not exist in the database`);
        process.exit(1);
      }
      
      console.log(`\nFixing ${invalidMushers.length} mushers with default club ID: ${defaultClubId}`);
      
      for (const musher of invalidMushers) {
        await Musher.updateOne(
          { _id: musher._id },
          { $set: { club: defaultClubId } }
        );
        console.log(`Fixed musher ${musher._id} (${musher.name})`);
      }
      
      console.log('All invalid musher club references have been fixed');
    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

// Run the function
findMushersWithInvalidClubReferences(); 