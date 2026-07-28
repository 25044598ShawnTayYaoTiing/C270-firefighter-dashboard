# Firefighter Smart Incident Dashboard

## Overview

The Firefighter Smart Incident Dashboard is an SCDF-inspired school prototype for emergency incident reporting. It helps users capture emergency call information, clean raw transcripts, generate AI-assisted incident report drafts, review and edit report details, save reports to MySQL, and monitor operational records through dashboard, reports, map, and analytics pages.

The project uses Node.js, Express.js, EJS, CSS, JavaScript, MySQL, Gemini Flash, RealtimeSTT, Leaflet, and OpenStreetMap.

## Problem Statement

Emergency incident reporting can be time-consuming when important details are captured manually. Duty officers need to record location, incident type, hazards, injured or trapped persons, response status, missing information, and officer notes. Missing or unclear details can slow down report review, documentation, and follow-up action.

This prototype reduces manual effort by supporting transcript intake, AI-assisted cleanup, AI-assisted draft generation, structured review, searchable MySQL storage, and live operational summaries.

## Target Users

- SCDF emergency call operators
- Dispatch officers
- Incident report reviewers
- Fire and rescue supervisors
- Operations team members

## System Architecture

![System Architecture](docs/images/system-architecture.png)

The application keeps its existing server-rendered EJS architecture, with a small two-container boundary for local Compose. An Nginx UI gateway serves public assets and proxies same-origin page/API requests to the Node.js backend. The backend renders the existing EJS pages, handles authentication and report routes, calls Gemini, and reads/writes incident records in Railway MySQL.

```text
Prototype Users
-> Frontend/UI container using Nginx, CSS, JavaScript, and same-origin proxying
-> Backend/API container using Node.js, Express.js, and EJS
-> Railway MySQL using incidents and officers tables

Backend/API container -> Gemini API
Backend/API container -> optional external RealtimeSTT service
```

The UI gateway is intentionally a reverse proxy rather than a new SPA. Existing EJS views, form actions, browser API calls, sessions, map assets, AI flows, and report-completion behavior stay intact while the sensitive database and Gemini configuration remains in the backend container.

Supporting services:

- Gemini Flash for AI transcript cleanup and AI-assisted incident draft generation
- RealtimeSTT for the live speech-to-text proof-of-concept
- Leaflet and OpenStreetMap for live incident map visualisation
- OneMap, when configured, for Singapore coordinate lookup

## Main Prototype Workflow

![Main Prototype Workflow](docs/images/main-workflow.png)

```text
Emergency Call Information
-> Transcript Intake
-> AI Transcript Cleanup
-> AI-Assisted Incident Draft
-> Duty Officer Review and Edit
-> Save Incident Report to MySQL
-> Dashboard / Reports / Map / Analytics Updated
```

## Features

### Dashboard Overview

The dashboard summarises current incident reporting activity using cards for:

- All Incident Records
- Awaiting Officer Review
- Reviewed Reports
- Urgent / Escalated Incidents
- New Reports This Week

Dashboard values are recalculated from MySQL whenever the page reloads. The database does not currently store response time, so the dashboard uses reports created this week instead of an average response-time metric.

### Live Call Intake

![Live Call Intake](docs/images/live-call-intake.png)

The Live Call Intake page supports a RealtimeSTT speech-to-text proof-of-concept and a manual transcript fallback. It includes:

- Live Transcript for the latest speech segment
- Full Transcript for committed transcript text
- Clean Transcript Text for AI-cleaned output
- Send Raw Transcript to move raw text into Create Report
- Send Clean Transcript to move reviewed cleaned text into Create Report

If RealtimeSTT is unavailable, users can paste transcript text manually.

### AI-Assisted Transcript Cleanup

Gemini Flash helps clean raw transcript text for readability and clarity. The browser calls the Express backend, and the backend calls Gemini; the browser never calls Gemini directly.

### AI-Assisted Incident Drafting

Gemini Flash helps generate editable incident fields from a transcript, including:

- Incident type
- Location
- Summary
- Hazards
- Injured or trapped persons
- Missing information
- Officer notes
- Response status

AI drafts must be reviewed by duty officers before saving. If Gemini is unavailable, the app keeps manual editing available and can return a conservative fallback draft.

### Incident Report CRUD

![Create Incident Report](docs/images/create-report.png)

![Incident Reports](docs/images/incident-reports.png)

![Incident Details](docs/images/incident-details.png)

The dashboard keeps MySQL-backed incident report management:

- Create report
- View report
- Edit report
- Delete report
- Search reports
- Filter reports by status

Officer login is backed by the MySQL `officers` table. New reports automatically save the logged-in officer as `reporting_officer_id`, and existing reports without an officer still display `Not assigned`.

Report completion appears on Create Report, Edit Report, and Report Details. Completion is based on transcript, reporting officer, incident location, incident type, date and time, summary, hazards, injured or trapped persons, and non-draft response status. The logged-in officer is counted automatically on Create Report. The progress bar is advisory only and does not block the existing MySQL save flow.

### Live Incident Map

![Live Incident Map](docs/images/incident-map.png)

The Dashboard includes a Live Incident Map built with Leaflet and OpenStreetMap. It uses current MySQL incident rows and does not rely on hardcoded sample markers.

Map rules:

- Incidents appear only when they have finite `latitude` and `longitude` values.
- Escalated or urgent incidents are red.
- Pending or awaiting review incidents are orange.
- Active, ongoing, dispatched, or in-progress incidents are blue.
- Completed, reviewed, closed, or resolved reports are hidden from the live map.
- Live incidents without usable coordinates appear under Unmapped Incidents.

Coordinate resolution order:

1. Existing valid latitude and longitude.
2. OneMap Search API, when `ONEMAP_EMAIL` and `ONEMAP_PASSWORD` are configured.
3. Local Singapore fallback matching from location, transcript, or summary.
4. `null` if no match is found.

To backfill old reports that are missing coordinates:

```powershell
node scripts/backfillIncidentCoordinates.js
```

For backend-only map payload debugging in non-production:

```text
GET /dev/map-payload
```

When `GEOCODING_DEBUG=true`, dashboard rendering logs map payload counts to the Node.js console. OneMa
es are recalculated from MySQL and show:

- Incident type distribution
- Response status overview
- High-frequency locations
- Pending review count
- Reviewed report count
- Escalated incident count
- Reports created this week

Percentages are calculated as `group count / total report count`.

### Search and Filtering

Search uses backend MySQL `LIKE` queries with parameters. It checks:

- Incident ID
- Incident Type
- Location
- Status
- Incident Summary
- Hazards
- Injured or Trapped Persons
- Missing Information
- Officer Notes
- Transcript
- Reporting Officer Name and Role

Search routes:

```text
GET /incidents?search=smoke
GET /incidents?status=Completed&search=vehicle
GET /api/incidents?search=smoke
GET /api/incidents?status=Completed&search=vehicle
```

## Technology Stack

| Area | Technology |
|---|---|
| Frontend | EJS, CSS, JavaScript |
| Backend | Node.js, Express.js |
| Database | MySQL |
| AI | Gemini Flash |
| Speech-to-Text | RealtimeSTT |
| Map | Leaflet + OpenStreetMap |
| Version Control | GitHub |

## Database Design

Database name: `firefighter_dashboard`

Main table: `incidents`

| Field | Purpose |
|---|---|
| id | Primary key |
| incident_id | Unique incident reference |
| reporting_officer_id | Officer from the login session; nullable for older reports |
| incident_type | Type of emergency |
| location | Incident location |
| incident_datetime | Date and time of incident |
| incident_summary | Summary of the incident |
| hazards | Hazards at the scene |
| injured_or_trapped_persons | Injured or trapped person details |
| response_status | Current report status |
| missing_information | Information still required |
| officer_notes | Reviewing officer notes |
| transcript | Original call transcript |
| latitude | Map latitude |
| longitude | Map longitude |
| created_at | Record creation time |
| updated_at | Last updated time |

Supporting table: `officers`

| Field | Purpose |
|---|---|
| id | Primary key |
| username | Unique officer login username |
| password_hash | Bcrypt password hash |
| officer_name | Reporting officer name |
| officer_role | Permission role: `Duty Officer`, `HR`, or `Higher Rank/Admin` |
| is_active | Whether the officer can log in |
| created_at | Record creation time |

## Getting Started

Follow these steps when setting up the project from zero on Windows.

### Prerequisites

- Node.js and npm
- MySQL running locally or reachable from this machine
- Gemini API key for AI cleanup and report drafting
- PowerShell on Windows
- RealtimeSTT only if live speech-to-text is needed
- Docker Desktop with Docker Compose for the containerised local stack

### 1. Open the Project Folder

```powershell
cd C:\Users\goati\Downloads\firefighter-dashboard-prototype-fixed
```

### 2. Install Dependencies

```powershell
npm install
```

### 3. Set Up MySQL

Use the existing Railway MySQL database. No database container is created by Compose. For a fresh MySQL database, the application and seed scripts create or upgrade the required tables.

```sql
CREATE DATABASE IF NOT EXISTS firefighter_dashboard;
USE firefighter_dashboard;

CREATE TABLE IF NOT EXISTS incidents (
  id INT AUTO_INCREMENT PRIMARY KEY,
  incident_id VARCHAR(20) UNIQUE NOT NULL,
  incident_type VARCHAR(100) NOT NULL,
  location VARCHAR(255) NOT NULL,
  incident_datetime DATETIME NOT NULL,
  incident_summary TEXT NOT NULL,
  hazards TEXT,
  injured_or_trapped_persons TEXT,
  response_status VARCHAR(50) NOT NULL,
  missing_information TEXT,
  officer_notes TEXT,
  transcript TEXT,
  latitude DECIMAL(10, 8) NULL,
  longitude DECIMAL(11, 8) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ON UPDATE CURRENT_TIMESTAMP
);
```

For a fresh database, create the required tables:

```sql
CREATE TABLE IF NOT EXISTS officers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  officer_name VARCHAR(100) NOT NULL,
  officer_role VARCHAR(100) NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS incidents (
  id INT AUTO_INCREMENT PRIMARY KEY,
  incident_id VARCHAR(20) NOT NULL UNIQUE,
  reporting_officer_id INT NULL,
  incident_type VARCHAR(100) NOT NULL,
  location VARCHAR(255) NOT NULL,
  incident_datetime DATETIME NULL,
  incident_summary TEXT NULL,
  hazards TEXT NULL,
  injured_or_trapped_persons TEXT NULL,
  response_status VARCHAR(50) DEFAULT 'Draft',
  missing_information TEXT NULL,
  officer_notes TEXT NULL,
  transcript TEXT NULL,
  latitude DECIMAL(10, 7) NULL,
  longitude DECIMAL(10, 7) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE INDEX idx_incidents_reporting_officer_id ON incidents (reporting_officer_id);
```

For an existing database, add the reporting officer column only if it is missing:

```sql
SHOW COLUMNS FROM incidents LIKE 'reporting_officer_id';
ALTER TABLE incidents ADD COLUMN reporting_officer_id INT NULL;
```

The app, `npm run seed`, and `npm run seed:users` also check/create the `officers` table, add missing login columns, bcrypt-hash demo passwords, and add `reporting_officer_id` when the configured database already exists.

### 4. Create `.env`

Create `.env` in the project root:

```env
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=firefighter_dashboard
DB_PORT=3306
SESSION_SECRET=replace_with_a_long_random_string

GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.5-flash-lite

ONEMAP_EMAIL=
ONEMAP_PASSWORD=
ONEMAP_BASE_URL=https://www.onemap.gov.sg
GEOCODING_DEBUG=false
```

Replace `your_password` with your local MySQL password and set `SESSION_SECRET` to a long random value for local sessions. OneMap credentials are optional; if they are blank, report creation, report editing, and coordinate backfill use the local Singapore fallback resolver. Do not commit `.env` or expose private credentials.

### 5. Configure Gemini AI

Set `GEMINI_API_KEY` to your private Gemini API key and `GEMINI_MODEL` to the supported Flash model used by the deployment.

For the current cloud AI flow:

```env
GEMINI_MODEL=gemini-3.5-flash-lite
```

### 6. Start the Dashboard Only

```powershell
npm start
```

Open:

```text
http://localhost:3000
```

RealtimeSTT is not required if you are using manual transcript input.

### Run the Complete Local Stack with Docker Compose

The dashboard Compose file runs exactly two application containers: `frontend` (Nginx UI gateway) and `backend` (Node.js/Express). Railway MySQL and Gemini stay external and are not containerised. RealtimeSTT also remains an optional external service so this refactor does not add a third application container or remove live transcription support.

Copy `.env.example` to `.env`, then enter private Railway and session values only in `.env`. Never commit that file.

Build and start the complete stack:

```powershell
docker compose down
docker compose up -d --build
docker compose ps
```

Open `http://localhost:3000`, sign in, test Clean Transcript on Live Call Intake, Generate AI Report on Create Report, and Start Transcription if an external RealtimeSTT service is ready.

Use these values for the supported execution modes:

```env
# Backend container running in Docker Compose
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.5-flash-lite
REALTIME_STT_HEALTH_URL=http://host.docker.internal:8010/health
# Blank makes the browser use the dashboard hostname on port 8010.
REALTIME_STT_WS_URL=

# Node.js running directly on the host
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.5-flash-lite
REALTIME_STT_HEALTH_URL=http://127.0.0.1:8010/health
REALTIME_STT_WS_URL=
```

Inside Docker, Node.js calls Gemini through the Gemini API and checks an externally run RealtimeSTT service at `http://host.docker.internal:8010/health` by default. The browser cannot resolve Docker service names, so it connects to `ws://<dashboard-hostname>:8010/ws/transcribe` (or `wss://` when the dashboard uses HTTPS). This works with `localhost` and later with the laptop's LAN address without hard-coding an IP. Start RealtimeSTT separately when live speech-to-text is needed; manual transcript entry remains available without it.

Useful checks:

```powershell
docker compose ps
docker compose logs --tail 100 frontend backend
Invoke-RestMethod http://localhost:8010/health
```

Stop or restart without deleting model volumes:

```powershell
docker compose stop
docker compose start
docker compose restart
docker compose down
```

If Gemini is unavailable or not configured, cleanup preserves the original transcript and report generation supplies a conservative editable fallback. If RealtimeSTT stops, manual transcript entry remains available. The application and Railway-backed non-AI features continue running.

## DevSecOps pipeline

GitHub Actions now uses a fail-closed pipeline: automated tests, Gitleaks repository/history scanning, production dependency audit, Semgrep SAST, and Trivy HIGH/CRITICAL image scanning all run before AWS authentication, ECR push, or ECS deployment. Pull requests to `main` build and scan but never deploy. Pushes to `main` deploy the exact SHA-tagged backend image that Trivy scanned, then verify ECS and the public health/smoke endpoints.

Run the core checks locally:

```powershell
npm ci
npm test
npm audit --omit=dev --audit-level=high
docker build -t firefighter-dashboard-backend:local .
docker build -f frontend/Dockerfile -t firefighter-dashboard-frontend:local .
docker compose config
```

See [FA L4 DevSecOps evidence](docs/FA-L4-DEVSECOPS.md) for the full gate design, AWS OIDC setup, proof steps, rollback procedure, and required GitHub configuration. See [SECURITY.md](SECURITY.md) for vulnerability reporting and secret-handling rules.

### 7. Seed Sample Reports

```powershell
npm run seed
```

This also seeds the demo officer logins:

| Username | Password | Officer |
|---|---|---|
| `admin1` | `password123` | Admin Duty Officer 1, Higher Rank/Admin |
| `admin2` | `password123` | Admin Duty Officer 2, HR |
| `admin3` | `password123` | Admin Duty Officer 3, Duty Officer |
| `admin4` | `password123` | Admin Duty Officer 4, Duty Officer |
| `admin5` | `password123` | Admin Duty Officer 5, Duty Officer |

To refresh only the demo officer users:

```powershell
npm run seed:users
```

User accounts are managed internally at `/users`; there is no public self-registration route. HR can create and edit Duty Officer accounts. Higher Rank/Admin can create all approved roles, edit managed accounts, and deactivate accounts while preserving incident history.

### Role-based permissions

| Feature | Duty Officer | HR | Higher Rank/Admin |
|---|---|---|---|
| Dashboard and incident workflow | Yes | Yes | Yes |
| User Management | No | Limited | Full |
| Add Duty Officer accounts | No | Yes | Yes |
| Add HR or Higher Rank/Admin accounts | No | No | Yes |
| Edit Duty Officer account details | No | Yes | Yes |
| Edit HR or Higher Rank/Admin accounts | No | No | Yes |
| Deactivate accounts | No | No | Yes |
| Backdate incident date/time | No | No | Yes |

All checks are enforced in Express controllers/middleware and in account-model business rules. The sidebar is only a presentation convenience and is not the security boundary. Active account status and current roles are reloaded from MySQL on authenticated requests, so deactivation and permission changes also apply to existing sessions.

The existing schema already includes the fields required by account management. For older installations, the application's schema setup adds equivalent missing columns automatically. The corresponding manual migration is:

```sql
ALTER TABLE officers ADD COLUMN officer_role VARCHAR(100) NULL AFTER officer_name;
ALTER TABLE officers ADD COLUMN is_active BOOLEAN DEFAULT TRUE AFTER officer_role;
ALTER TABLE officers ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

UPDATE officers
SET officer_role = 'Duty Officer'
WHERE officer_role IS NULL OR officer_role IN ('Officer', 'Normal Officer');
```

Run only the `ALTER TABLE` statements for columns that do not already exist. Passwords continue to use bcrypt hashes in `password_hash`; account forms never store plain-text passwords.

### 8. Run RealtimeSTT Only If Live Speech-to-Text Is Needed

```powershell
cd C:\Users\goati\Downloads\RealtimeSTT
.\.venv-fastapi\Scripts\Activate.ps1
python example_fastapi_server\server.py --host 127.0.0.1 --port 8010 --engine faster_whisper --model medium.en --realtime-model tiny.en --language en
```

### 9. Run the Full Demo

```powershell
npm run demo
```

The demo launcher opens the dashboard and RealtimeSTT in separate PowerShell windows, opens the dashboard in your browser, and checks that Gemini AI is configured. It does not start MySQL.

## Environment Variables

The dashboard reads local configuration from `.env`. Keep this file in the project root, keep it private, and never commit it.

| Variable | Purpose |
|---|---|
| `FRONTEND_PORT` | Host port for the Nginx UI container; defaults to `3000` |
| `BACKEND_PORT` | Host port for the backend container; defaults to `3001` |
| `BACKEND_URL` | Internal UI-gateway URL for the backend; defaults to `http://backend:3000` |
| `CORS_ORIGIN` | Allowed frontend origin for browser API calls; defaults to `http://localhost:3000` |
| `DB_HOST` | Railway MySQL host |
| `DB_USER` | MySQL username |
| `DB_PASSWORD` | MySQL password |
| `DB_NAME` | Database name, `firefighter_dashboard` |
| `DB_PORT` | MySQL port, usually `3306` |
| `SESSION_SECRET` | Secret used by `express-session` to sign login cookies |
| `GEMINI_API_KEY` | Private Gemini API key used by the backend only |
| `GEMINI_MODEL` | Gemini Flash model used for cleanup and draft generation |
| `GEMINI_TIMEOUT_MS` | Optional per-attempt Gemini timeout in milliseconds; defaults to `30000` |
| `ONEMAP_EMAIL` | Optional OneMap email |
| `ONEMAP_PASSWORD` | Optional OneMap password |
| `ONEMAP_BASE_URL` | OneMap API base URL |
| `GEOCODING_DEBUG` | Enables backend map payload logging when `true` |
| `REALTIME_STT_HEALTH_URL` | Backend health URL for the optional external RealtimeSTT service |
| `REALTIME_STT_WS_URL` | Optional browser WebSocket URL; blank uses the dashboard hostname on port `8010` |

## Run the Full Local Demo

Use this flow when you want the dashboard and RealtimeSTT running together for a prototype demo. The script checks whether `GEMINI_API_KEY` and `GEMINI_MODEL` are configured without printing the key.

1. Start or confirm MySQL is reachable.
2. Confirm `.env` exists in the project root.
3. Run `npm install` if `node_modules` is missing.
4. Run the demo launcher:

   ```powershell
   npm run demo
   ```

The demo uses:

- Dashboard on `http://localhost:3000`
- RealtimeSTT on `http://127.0.0.1:8010`
- Gemini AI through the backend service
- MySQL from the configured Railway connection

The launcher opens separate PowerShell windows for the dashboard and RealtimeSTT, opens the dashboard in your browser, and checks Gemini configuration. It does not start MySQL.

By default, the script expects RealtimeSTT at:

```text
C:\Users\goati\Downloads\RealtimeSTT
```

If your RealtimeSTT folder is somewhere else, edit `$RealtimeSttPath` near the top of `scripts/start-demo.ps1`, then run `npm run demo` again. The script checks that the RealtimeSTT folder, `.venv-fastapi`, and `example_fastapi_server\server.py` exist before starting the service.

To stop the demo, close the separate PowerShell windows for the dashboard and RealtimeSTT.

## Recommended Demo Testing Flow

Use this flow to test the main prototype path end to end:

1. Confirm MySQL connectivity through the `DB_*` values.
2. Confirm `GEMINI_API_KEY` and `GEMINI_MODEL` are configured.
3. Run `npm install`.
4. Run `npm run seed`.
5. Run `npm start` or `npm run demo`.
6. Open `http://localhost:3000`.
7. Log in with one demo officer account.
8. Check the Dashboard cards.
9. Go to Live Call Intake.
10. Paste or capture a transcript.
11. Click Clean Transcript.
12. Send the transcript to Create Report.
13. Click Generate AI Report.
14. Review and edit the generated fields.
15. Save the report.
16. Confirm Report Details shows the logged-in officer.
17. Log out and confirm protected pages redirect to `/login`.
18. Refresh Dashboard, Map, and Analytics after logging back in.

## Seed Sample Incident Reports

The dashboard and analytics read from the MySQL `incidents` table. To load realistic school-prototype data:

```powershell
npm run seed
```

The seed script creates or upgrades the `officers` table, stores bcrypt password hashes for demo users, adds `reporting_officer_id` to `incidents` when missing, and inserts or refreshes 10 sample reports with IDs `INC-1001` through `INC-1010`. The sample reports include residential fires, kitchen fire, road traffic accident, lift rescues, gas leak, electrical fire, rubbish chute fire, and vehicle fire. The script uses MySQL `ON DUPLICATE KEY UPDATE`, so running it again refreshes those same sample records instead of creating duplicates.

After seeding, open `http://localhost:3000/dashboard` and `http://localhost:3000/analytics` to confirm totals, charts, and percentages update.

## Run RealtimeSTT

RealtimeSTT is a separate Python service. Do not install it as a Node.js package.

1. Clone RealtimeSTT outside this dashboard project:

   ```powershell
   git clone https://github.com/KoljaB/RealtimeSTT.git
   cd RealtimeSTT
   ```

2. Create and activate a Python virtual environment:

   ```powershell
   python -m venv .venv-fastapi
   .\.venv-fastapi\Scripts\Activate.ps1
   ```

3. Upgrade packaging tools:

   ```powershell
   python -m pip install -U pip setuptools wheel
   ```

4. Install the main RealtimeSTT requirements:

   ```powershell
   python -m pip install -r requirements.txt
   ```

5. Install the FastAPI browser server requirements:

   ```powershell
   python -m pip install -r example_fastapi_server\requirements.txt
   ```

6. Start the FastAPI browser server on port `8010`:

   ```powershell
   python example_fastapi_server\server.py --host 0.0.0.0 --port 8010
   ```

7. Open the RealtimeSTT service directly if needed:

   ```text
   http://localhost:8010
   ```

The demo launcher uses this RealtimeSTT command:

```powershell
python example_fastapi_server\server.py --host 127.0.0.1 --port 8010 --engine faster_whisper --model medium.en --realtime-model tiny.en --language en
```

## How Each Feature Works

### Live Call Intake Flow

Open `http://localhost:3000/transcription` or choose Live Call Intake from the sidebar.

1. To use live speech-to-text, start RealtimeSTT first and click Start Transcription.
2. Allow microphone access, then speak into the microphone.
3. RealtimeSTT converts speech to text through port `8010` on the same hostname used to open the dashboard. For example, localhost uses `ws://localhost:8010/ws/transcribe`, while a LAN client uses the laptop hostname or LAN address.
4. Live Transcript updates with the latest speech segment.
5. Stop Transcription commits the latest text into Full Transcript.
6. Click Clean Transcript to send the transcript to Gemini for cleanup.
7. Click Send Raw Transcript or Send Clean Transcript to open Create Report with the transcript loaded.

If RealtimeSTT is unavailable, paste text into the manual transcript field and continue from the cleanup or send step.

### AI Report Flow

Open Create Report from the sidebar or send a transcript from Live Call Intake.

1. Confirm the Transcript field contains raw or cleaned call text.
2. Click Generate AI Report.
3. The backend sends the transcript to Gemini.
4. The form fills an editable AI-assisted incident draft.
5. Review and edit the generated fields.
6. Save the report with Save Draft or Save Report.

Backend AI endpoints:

```text
POST /api/ai/clean-transcript
POST /api/reports/generate
```

Both endpoints call Gemini using `GEMINI_API_KEY` and `GEMINI_MODEL`. The browser never receives the Gemini API key.

### Incident CRUD Flow

Use the report pages to manage MySQL-backed incident records:

1. Open Create Report to add a new incident.
2. Fill or generate the report fields.
3. Save the report to MySQL.
4. Open Incident Reports to view saved reports.
5. Use search or status filtering to find a report.
6. Open Report Details or Edit Report to review and update a report.
7. Delete a report only when it is no longer needed.
8. Refresh Dashboard and Analytics to see updated totals.

### Map Flow

Open Dashboard to view the Live Incident Map.

1. Create or edit a report with a clear incident location.
2. The backend resolves latitude and longitude when possible.
3. Coordinates are saved to MySQL.
4. The dashboard sends active incident map data to the browser.
5. Leaflet displays markers for incidents with valid coordinates.
6. Completed, reviewed, closed, and resolved reports are hidden from the live map.

### Analytics Flow

Open Analytics from the sidebar.

1. The backend reads current MySQL incident records.
2. It groups reports by type, status, and location.
3. It calculates totals and percentages.
4. The Analytics page displays the latest summary after refresh.

## Troubleshooting

### Port 8010 Already in Use

RealtimeSTT needs port `8010`. Find the process using the port:

```powershell
netstat -ano | findstr :8010
```

Stop the process by replacing `<PID_NUMBER>` with the PID from the last column:

```powershell
taskkill /PID <PID_NUMBER> /F
```

### Map Marker Does Not Appear

Check whether recent reports have coordinates:

```sql
SELECT incident_id, location, response_status, latitude, longitude
FROM incidents
ORDER BY id DESC
LIMIT 10;
```

Reports need valid `latitude` and `longitude` values to appear on the map. Completed, reviewed, closed, and resolved reports are intentionally hidden from the live map.

To backfill missing coordinates:

```powershell
node scripts/backfillIncidentCoordinates.js
```

### Dashboard Does Not Connect to MySQL

Confirm MySQL is running and that `.env` contains the correct `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, and `DB_PORT` values.

In MySQL, check the database and tables:

```sql
SHOW DATABASES;
USE firefighter_dashboard;
SHOW TABLES;
```

The demo script only checks whether MySQL is reachable; it does not start MySQL.

### Gemini AI Not Configured or Unavailable

Confirm `.env` or the cloud environment contains both required Gemini variables:

```env
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.5-flash-lite
```

If Gemini is unavailable, transcript cleanup returns the original transcript and AI report generation returns a conservative editable fallback report. Manual report editing remains available.

### RealtimeSTT Not Responding

Confirm RealtimeSTT is running on `http://localhost:8010` or `http://127.0.0.1:8010`. If the demo launcher cannot start it, check that the RealtimeSTT folder, `.venv-fastapi`, and `example_fastapi_server\server.py` exist.

Manual transcript input still works when RealtimeSTT is unavailable.

### Raw Transcript Does Not Send

Confirm there is text in Live Transcript, Full Transcript, Clean Transcript Text, or the manual transcript field before sending. Sent transcripts are stored in `localStorage`, then loaded into the Create Report transcript field.
