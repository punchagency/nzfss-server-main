const mongoose = require('mongoose');
const { config } = require('dotenv');
const path = require('path');
const { PointModel } = require('../src/schema/point.schema');
const { EntrantModel } = require('../src/schema/entrants.schema');

// Load environment variables
config({ path: path.resolve(__dirname, '../.env') });

const MONGODB_URI = process.env.MONGODB_STRING || process.env.MONGODB_URI || 'mongodb://localhost:27017/nzfss';

async function checkMissingEntrants() {
    try {
        // Connect to MongoDB
        await mongoose.connect(MONGODB_URI);
        console.log('Connected to MongoDB');

        // Get all points
        const points = await PointModel.find({}).lean();
        console.log(`Found ${points.length} points`);

        // Get all entrant IDs
        const entrantIds = points.map(p => p.entrantId);
        console.log(`Found ${entrantIds.length} entrant IDs in points`);

        // Get unique entrant IDs
        const uniqueEntrantIds = [...new Set(entrantIds.map(id => id.toString()))];
        console.log(`Found ${uniqueEntrantIds.length} unique entrant IDs`);

        // Check which entrants exist
        const existingEntrants = await EntrantModel.find({
            _id: { $in: uniqueEntrantIds.map(id => new mongoose.Types.ObjectId(id)) }
        }).select('_id name').lean();

        console.log(`Found ${existingEntrants.length} existing entrants`);

        const existingEntrantIds = existingEntrants.map(e => e._id.toString());
        const missingEntrantIds = uniqueEntrantIds.filter(id => !existingEntrantIds.includes(id));

        console.log(`Missing entrant IDs:`, missingEntrantIds);

        // Show points that reference missing entrants
        const pointsWithMissingEntrants = points.filter(p => 
            missingEntrantIds.includes(p.entrantId.toString())
        );

        console.log(`Points with missing entrants:`, pointsWithMissingEntrants.map(p => ({
            pointId: p._id.toString(),
            entrantId: p.entrantId.toString(),
            points: p.points,
            dogPoints: p.dogPoints?.length || 0
        })));

        await mongoose.disconnect();
        console.log('Disconnected from MongoDB');

    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

checkMissingEntrants(); 