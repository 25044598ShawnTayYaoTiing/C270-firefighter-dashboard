const APP_NAME = 'Firefighter Incident Command';

const INCIDENT_STATUSES = Object.freeze([
  'Draft',
  'Pending Review',
  'Completed',
  'Escalated'
]);

const INCIDENT_TYPES = Object.freeze([
  'Residential Fire',
  'Kitchen Fire',
  'Road Traffic Accident',
  'Lift Rescue',
  'Gas Leak',
  'Electrical Fire',
  'Rubbish Chute Fire',
  'Vehicle Fire'
]);

module.exports = {
  APP_NAME,
  INCIDENT_STATUSES,
  INCIDENT_TYPES
};
