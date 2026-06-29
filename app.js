const express = require('express');
const path = require('path');
const aiRoutes = require('./routes/aiRoutes');
const incidentRoutes = require('./routes/incidentRoutes');
const pageRoutes = require('./routes/pageRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/', aiRoutes);
app.use('/', incidentRoutes);
app.use('/', pageRoutes);

app.listen(PORT, () => {
  console.log(`Firefighter Smart Incident Dashboard running at http://localhost:${PORT}`);
});

