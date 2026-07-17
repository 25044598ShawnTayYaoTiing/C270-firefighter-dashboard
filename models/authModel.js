// done by Thein 25040396
// AI Features: authModel.js handles officer credential verification, including password hashing and comparison for secure authentication.
const bcrypt = require('bcrypt');
const officerModel = require('./officerModel');

exports.verifyOfficerCredentials = async (username, password) => {
  const officer = await officerModel.findActiveOfficerByUsername(username);

  if (!officer || !officer.password_hash) {
    return null;
  }

  const passwordMatches = await bcrypt.compare(password, officer.password_hash);

  if (!passwordMatches) {
    return null;
  }

  return {
    id: officer.id,
    username: officer.username,
    officer_name: officer.officer_name,
    officer_role: officer.officer_role
  };
};
