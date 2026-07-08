const db = require('../config/db');
const officerModel = require('../models/officerModel');

async function seedUsers() {
  await officerModel.ensureOfficerSchema();

  console.log('Seeded demo officer users: admin1, admin2, admin3, admin4, admin5.');
  console.log(`Demo password for all users: ${officerModel.DEMO_PASSWORD}`);
  await db.end();
}

seedUsers().catch(async (error) => {
  console.error(error);
  await db.end();
  process.exit(1);
});
