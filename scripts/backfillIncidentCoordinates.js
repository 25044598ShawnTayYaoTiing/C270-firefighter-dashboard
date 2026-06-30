const db = require('../config/db');
const {
  resolveIncidentCoordinates
} = require('../helpers/geocodingService');

async function backfillIncidentCoordinates() {
  const [incidents] = await db.query(`
    SELECT
      id,
      incident_id,
      incident_type,
      location,
      incident_summary,
      transcript,
      response_status,
      latitude,
      longitude
    FROM incidents
    WHERE latitude IS NULL OR longitude IS NULL
    ORDER BY incident_datetime DESC, created_at DESC
  `);

  let updatedCount = 0;
  let skippedCount = 0;

  for (const incident of incidents) {
    const coordinates = await resolveIncidentCoordinates({
      latitude: incident.latitude,
      longitude: incident.longitude,
      location: incident.location,
      incident_summary: incident.incident_summary,
      transcript: incident.transcript
    });

    if (!coordinates) {
      skippedCount += 1;
      console.log(`SKIPPED ${incident.incident_id} | ${incident.location || 'No location'} | Missing coordinates or location not mapped.`);
      continue;
    }

    await db.query(
      `
        UPDATE incidents
        SET latitude = ?, longitude = ?
        WHERE incident_id = ?
      `,
      [coordinates.lat, coordinates.lng, incident.incident_id]
    );

    updatedCount += 1;
    console.log(`UPDATED ${incident.incident_id} | ${incident.location || 'No location'} | ${coordinates.source || 'resolver'} | ${coordinates.lat}, ${coordinates.lng}`);
  }

  console.log(`Backfill complete. Updated: ${updatedCount}. Skipped: ${skippedCount}.`);
}

backfillIncidentCoordinates()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.end();
  });
