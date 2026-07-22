require('dotenv').config({ quiet: true });

const express = require('express');
const path = require('path');
const session = require('express-session');

const authRoutes = require('./routes/authRoutes');
const pageRoutes = require('./routes/pageRoutes');
const incidentRoutes = require('./routes/incidentRoutes');
const aiRoutes = require('./routes/aiRoutes');
const userRoutes = require('./routes/userRoutes');
const {
  attachCurrentOfficer,
  requireAuth
} = require('./middleware/authMiddleware');

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || 'firefighter.sid';
const SESSION_SECRET = String(process.env.SESSION_SECRET || '').trim();

if (!SESSION_SECRET) {
  throw new Error('SESSION_SECRET must be configured before starting the application.');
}

app.set('trust proxy', 1);
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.use(express.static(path.join(__dirname, 'public')));
app.use('/vendor/leaflet.heat', express.static(path.join(__dirname, 'node_modules', 'leaflet.heat', 'dist')));
app.use('/vendor/leaflet.markercluster', express.static(path.join(__dirname, 'node_modules', 'leaflet.markercluster', 'dist')));
// Allow long manual transcripts to reach the backend without changing database behavior.
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));
app.use(session({
  name: SESSION_COOKIE_NAME,
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production'
  }
}));
app.use(attachCurrentOfficer);

app.use('/', authRoutes);
app.use(requireAuth);
app.use('/', pageRoutes);
app.use('/', incidentRoutes);
app.use('/', aiRoutes);
app.use('/', userRoutes);

app.use((req, res) => {
  res.status(404).send('Page not found');
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).send('Something went wrong while loading the dashboard.');
});

app.listen(PORT, () => {
  console.log(`Firefighter Smart Incident Dashboard running at http://localhost:${PORT}`);
});
