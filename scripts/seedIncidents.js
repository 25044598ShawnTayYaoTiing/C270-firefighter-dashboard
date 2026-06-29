const db = require('../config/db');

const incidents = [
  {
    incident_id: 'INC-1001',
    incident_type: 'Residential Fire',
    location: 'Jurong West Street 42',
    incident_datetime: '2026-06-25 09:20:00',
    response_status: 'Pending Review',
    incident_summary: 'Smoke was reported from a seventh-floor residential unit. Firefighters contained a bedroom fire before it spread to nearby rooms.',
    hazards: 'Heavy smoke in corridor, electrical appliances near ignition point, limited visibility at entry.',
    injured_or_trapped_persons: 'One resident assessed for smoke inhalation. No trapped persons found.',
    missing_information: 'Confirm final cause of ignition after scene inspection.',
    officer_notes: 'Review evacuation timeline and attach witness notes before completion.',
    transcript: 'Caller reported smoke from a bedroom window at Jurong West Street 42. Neighbours were evacuating from the same floor.'
  },
  {
    incident_id: 'INC-1002',
    incident_type: 'Kitchen Fire',
    location: 'Bedok North Avenue 3',
    incident_datetime: '2026-06-24 18:45:00',
    response_status: 'Completed',
    incident_summary: 'A cooking fire was extinguished in a residential kitchen. The fire was limited to the stove area.',
    hazards: 'Hot oil, smoke staining, slippery kitchen floor after suppression.',
    injured_or_trapped_persons: 'No injuries reported.',
    missing_information: 'None.',
    officer_notes: 'Resident advised on safe cooking practices.',
    transcript: 'Small kitchen fire at Bedok North Avenue 3. Occupant switched off gas supply and waited outside the unit.'
  },
  {
    incident_id: 'INC-1003',
    incident_type: 'Road Traffic Accident',
    location: 'Tampines Avenue 10',
    incident_datetime: '2026-06-23 07:30:00',
    response_status: 'Escalated',
    incident_summary: 'Two vehicles were involved in a collision near a junction. One driver required assistance exiting the vehicle.',
    hazards: 'Broken glass, leaking coolant, traffic congestion, moving vehicles near responders.',
    injured_or_trapped_persons: 'One driver reported minor chest pain. Passenger condition required further confirmation.',
    missing_information: 'Need final medical outcome and traffic control notes.',
    officer_notes: 'Escalated due to possible injury and road blockage.',
    transcript: 'Caller reported a collision involving two cars on Tampines Avenue 10. One driver was still inside the vehicle.'
  },
  {
    incident_id: 'INC-1004',
    incident_type: 'Lift Rescue',
    location: 'Woodlands Drive 16',
    incident_datetime: '2026-06-22 21:10:00',
    response_status: 'Draft',
    incident_summary: 'Residents were trapped in a stalled lift between floors. Occupants were guided to remain calm while technician support was arranged.',
    hazards: 'Confined lift car, heat discomfort, anxiety among occupants.',
    injured_or_trapped_persons: 'No injuries reported. One occupant felt dizzy after release.',
    missing_information: 'Confirm technician arrival time and lift maintenance reference.',
    officer_notes: 'Draft pending officer review.',
    transcript: 'Three people trapped in a lift at Woodlands Drive 16. Lift stopped between level five and six.'
  },
  {
    incident_id: 'INC-1005',
    incident_type: 'Gas Leak',
    location: 'Yishun Ring Road',
    incident_datetime: '2026-06-21 12:05:00',
    response_status: 'Pending Review',
    incident_summary: 'A gas smell was reported near a coffeeshop service area. Surrounding units were checked and the area was ventilated.',
    hazards: 'Possible gas accumulation, ignition sources nearby, public crowding.',
    injured_or_trapped_persons: 'No injured or trapped persons reported.',
    missing_information: 'Confirm source isolation and utility follow-up.',
    officer_notes: 'Pending review of meter readings and evacuation notes.',
    transcript: 'Shop staff noticed a strong gas smell at Yishun Ring Road. People nearby were moved away from the service area.'
  },
  {
    incident_id: 'INC-1006',
    incident_type: 'Electrical Fire',
    location: 'Ang Mo Kio Avenue 5',
    incident_datetime: '2026-06-20 15:35:00',
    response_status: 'Completed',
    incident_summary: 'An electrical distribution box emitted sparks and smoke near a void deck. Power isolation was requested before inspection.',
    hazards: 'Live electrical components, smoke, public foot traffic near the service cabinet.',
    injured_or_trapped_persons: 'No injuries reported.',
    missing_information: 'None.',
    officer_notes: 'Completed after utility isolation and scene handover.',
    transcript: 'Resident reported sparks from an electrical box at Ang Mo Kio Avenue 5. Smoke was visible at the void deck.'
  },
  {
    incident_id: 'INC-1007',
    incident_type: 'Rubbish Chute Fire',
    location: 'Toa Payoh Lorong 6',
    incident_datetime: '2026-06-19 22:15:00',
    response_status: 'Completed',
    incident_summary: 'A small fire inside a rubbish chute was extinguished. Smoke entered the lift lobby on several floors.',
    hazards: 'Smoke in common area, hot chute access panel, possible falling debris.',
    injured_or_trapped_persons: 'No injuries reported.',
    missing_information: 'Confirm affected floors and ventilation duration.',
    officer_notes: 'Residents advised to avoid chute area until ventilation completed.',
    transcript: 'Caller said smoke was coming from the rubbish chute at Toa Payoh Lorong 6. Burning smell reported near the lift lobby.'
  },
  {
    incident_id: 'INC-1008',
    incident_type: 'Vehicle Fire',
    location: 'PIE Exit 26',
    incident_datetime: '2026-06-18 17:50:00',
    response_status: 'Escalated',
    incident_summary: 'A car fire was reported on the expressway shoulder near PIE Exit 26. Traffic control was required while responders approached.',
    hazards: 'Vehicle fuel, passing traffic, heat from engine bay, road shoulder access risk.',
    injured_or_trapped_persons: 'Driver exited vehicle before responders arrived. No trapped persons reported.',
    missing_information: 'Confirm final tow arrangement and lane reopening time.',
    officer_notes: 'Escalated due to expressway traffic exposure.',
    transcript: 'Caller reported a car on fire near PIE Exit 26. Driver was outside the car and traffic was slowing down.'
  },
  {
    incident_id: 'INC-1009',
    incident_type: 'Residential Fire',
    location: 'Bukit Batok Street 31',
    incident_datetime: '2026-06-17 06:40:00',
    response_status: 'Pending Review',
    incident_summary: 'Smoke was reported from a living room window. Fire damage was limited to furniture near the window.',
    hazards: 'Smoke in unit, burnt furniture, heat near window frame.',
    injured_or_trapped_persons: 'One elderly resident evacuated by neighbours. No injuries reported.',
    missing_information: 'Confirm ignition source and witness statement.',
    officer_notes: 'Pending officer review of resident interview notes.',
    transcript: 'Neighbour reported smoke from a flat at Bukit Batok Street 31. Elderly resident was helped out by neighbours.'
  },
  {
    incident_id: 'INC-1010',
    incident_type: 'Lift Rescue',
    location: 'Sengkang East Way',
    incident_datetime: '2026-06-16 11:25:00',
    response_status: 'Draft',
    incident_summary: 'Two occupants were trapped in a lift that stopped between floors. Building management contacted the lift contractor.',
    hazards: 'Confined space, anxiety, warm lift car.',
    injured_or_trapped_persons: 'Two trapped occupants. No injuries reported.',
    missing_information: 'Confirm release time and contractor reference number.',
    officer_notes: 'Draft saved pending final lift technician details.',
    transcript: 'Two people stuck in a lift at Sengkang East Way. Lift stopped between floors and building management was waiting for technician.'
  }
];

async function seed() {
  const sql = `
    INSERT INTO incidents (
      incident_id,
      incident_type,
      location,
      incident_datetime,
      incident_summary,
      hazards,
      injured_or_trapped_persons,
      response_status,
      missing_information,
      officer_notes,
      transcript
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      incident_type = VALUES(incident_type),
      location = VALUES(location),
      incident_datetime = VALUES(incident_datetime),
      incident_summary = VALUES(incident_summary),
      hazards = VALUES(hazards),
      injured_or_trapped_persons = VALUES(injured_or_trapped_persons),
      response_status = VALUES(response_status),
      missing_information = VALUES(missing_information),
      officer_notes = VALUES(officer_notes),
      transcript = VALUES(transcript)
  `;

  for (const incident of incidents) {
    await db.query(sql, [
      incident.incident_id,
      incident.incident_type,
      incident.location,
      incident.incident_datetime,
      incident.incident_summary,
      incident.hazards,
      incident.injured_or_trapped_persons,
      incident.response_status,
      incident.missing_information,
      incident.officer_notes,
      incident.transcript
    ]);
  }

  console.log(`Seeded ${incidents.length} incident reports.`);
  await db.end();
}

seed().catch(async (error) => {
  console.error(error);
  await db.end();
  process.exit(1);
});
