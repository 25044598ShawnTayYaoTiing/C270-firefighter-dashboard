require('dotenv').config();

const express = require('express');
const path = require('path');

const pageRoutes = require('./routes/pageRoutes');
const incidentRoutes = require('./routes/incidentRoutes');
const aiRoutes = require('./routes/aiRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use('/', pageRoutes);
app.use('/', incidentRoutes);
app.use('/', aiRoutes);

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
