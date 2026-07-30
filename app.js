require('dotenv').config({ quiet: true });

const crypto = require('crypto');
const express = require('express');
const path = require('path');
const session = require('express-session');
const { attachLiveTranscriptionGateway } = require('./services/liveTranscriptionGateway');

const authRoutes = require('./routes/authRoutes');
const pageRoutes = require('./routes/pageRoutes');
const incidentRoutes = require('./routes/incidentRoutes');
const aiRoutes = require('./routes/aiRoutes');
const transcriptionRoutes = require('./routes/transcriptionRoutes');
const userRoutes = require('./routes/userRoutes');
const {
  attachCurrentOfficer,
  requireAuth
} = require('./middleware/authMiddleware');

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || 'firefighter.sid';
const configuredSessionSecret = String(process.env.SESSION_SECRET || '').trim();

if (process.env.NODE_ENV === 'production' && !configuredSessionSecret) {
  throw new Error('SESSION_SECRET must be configured before starting the application.');
}

const SESSION_SECRET = configuredSessionSecret || crypto.randomBytes(32).toString('hex');

if (!configuredSessionSecret) {
  console.warn('[auth] SESSION_SECRET is not set; using a temporary development-only session secret.');
}

app.set('trust proxy', 1);
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

const allowedCorsOrigins = String(process.env.CORS_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedCorsOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Vary', 'Origin');
  }

  if (req.method === 'OPTIONS') return res.sendStatus(204);
  return next();
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use(express.static(path.join(__dirname, 'public')));
app.use('/vendor/leaflet.heat', express.static(path.join(__dirname, 'node_modules', 'leaflet.heat', 'dist')));
app.use('/vendor/leaflet.markercluster', express.static(path.join(__dirname, 'node_modules', 'leaflet.markercluster', 'dist')));
// Allow long manual transcripts to reach the backend without changing database behavior.
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
// Browser microphone clips are raw PCM16 and base64 encoded before transport.
app.use(express.json({ limit: '8mb' }));
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
app.use('/', transcriptionRoutes);
app.use('/', userRoutes);

app.use((req, res) => {
  res.status(404).send('Page not found');
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).send('Something went wrong while loading the dashboard.');
});

const server = app.listen(PORT, () => {
  console.log(`Firefighter Smart Incident Dashboard running at http://localhost:${PORT}`);
});
attachLiveTranscriptionGateway(server);
