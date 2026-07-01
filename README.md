# Firefighter Smart Incident Dashboard

## Overview

The Firefighter Smart Incident Dashboard is a web-based incident reporting prototype for SCDF personnel. It helps users capture emergency call information, clean raw transcripts, generate AI-assisted incident report drafts, review and edit report details, save reports to MySQL, and monitor operational records through dashboard, reports, map, and analytics pages.

The project uses Node.js, Express.js, EJS, CSS, JavaScript, MySQL, Ollama, RealtimeSTT, Leaflet, and OpenStreetMap.

## Problem Statement

Emergency incident reporting can be time-consuming when important details are captured manually. SCDF personnel need to record location, incident type, hazards, injured or trapped persons, response status, missing information, and officer notes. Missing or unclear details can slow down report review, documentation, and follow-up action.

This prototype reduces manual effort by supporting transcript intake, AI-assisted cleanup, AI-assisted draft generation, structured review, searchable MySQL storage, and live operational summaries.

## Target Users

- SCDF emergency call operators
- Dispatch officers
- Incident report reviewers
- Fire and rescue supervisors
- Operations team members

## Screenshots

![Dashboard Overview](docs/images/dashboard.png)

![Live Call Intake](docs/images/live-call-intake.png)

![Create Incident Report](docs/images/create-report.png)

![Incident Reports](docs/images/incident-reports.png)

![Incident Details](docs/images/incident-details.png)

![Live Incident Map](docs/images/incident-map.png)

![Analytics](docs/images/analytics.png)

## System Architecture

![System Architecture](docs/images/system-architecture.png)

The application uses a modular monolith structure. The Node.js / Express backend renders EJS pages, handles report routes, calls local AI services, and reads/writes incident records in MySQL.

```text
SCDF Personnel
-> Frontend Web Application using EJS, CSS, and JavaScript
-> Backend Application using Node.js and Express.js
-> MySQL Database using firefighter_dashboard and incidents table
```

Supporting services:

- Ollama for AI transcript cleanup and AI-assisted incident draft generation
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
-> SCDF Personnel Review and Edit
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

The Live Call Intake page supports a RealtimeSTT speech-to-text proof-of-concept and a manual transcript fallback. It includes:

- Live Transcript for the latest speech segment
- Full Transcript for committed transcript text
- Clean Transcript Text for AI-cleaned output
- Send Raw Transcript to move raw text into Create Report
- Send Clean Transcript to move reviewed cleaned text into Create Report

If RealtimeSTT is unavailable, users can paste transcript text manually.

### AI-Assisted Transcript Cleanup

Ollama helps clean raw transcript text for readability and clarity. The browser calls the Express backend, and the backend calls Ollama; the browser never calls Ollama directly.

### AI-Assisted Incident Drafting

Ollama helps generate editable incident fields from a transcript, including:

- Incident type
- Location
- Summary
- Hazards
- Injured or trapped persons
- Missing information
- Officer notes
- Response status

AI drafts must be reviewed by SCDF personnel before saving. If Ollama is unavailable, the app keeps manual editing available and can return a conservative fallback draft.

### Incident Report CRUD

The dashboard keeps MySQL-backed incident report management:

- Create report
- View report
- Edit report
- Delete report
- Search reports
- Filter reports by status

Report completion appears on Create Report, Edit Report, and Report Details. Completion is based on incident location, incident type, date and time, summary, response status, hazards, and injured or trapped persons. The progress bar is advisory only and does not block the existing MySQL save flow.

### Live Incident Map

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

When `GEOCODING_DEBUG=true`, dashboard rendering logs map payload counts to the Node.js console. OneMap email, password, and access tokens are never sent to EJS or frontend JavaScript.

### Analytics

Analytics values are recalculated from MySQL and show:

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
| AI | Ollama |
| Speech-to-Text | RealtimeSTT |
| Map | Leaflet + OpenStreetMap |
| Version Control | GitHub |

## Database Design

![Database Design](docs/images/database-design.png)

Database name: `firefighter_dashboard`

Main table: `incidents`

| Field | Purpose |
|---|---|
| id | Primary key |
| incident_id | Unique incident reference |
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

## Getting Started

### Prerequisites

- Node.js and npm
- MySQL running locally or reachable from this machine
- Ollama installed for AI cleanup and report drafting
- RealtimeSTT installed separately for live speech-to-text
- PowerShell on Windows for the demo launcher

### Install Dependencies

```powershell
npm install
```

### Configure Environment Variables

Create `.env` in the project root using the example in the next section. The `.env` file contains local configuration and must not be committed.

### Start the Dashboard

```powershell
npm start
```

Open:

```text
http://localhost:3000
```

## Environment Variables

```env
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=firefighter_dashboard
DB_PORT=3306

OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=qwen2.5:1.5b

ONEMAP_EMAIL=
ONEMAP_PASSWORD=
ONEMAP_BASE_URL=https://www.onemap.gov.sg
GEOCODING_DEBUG=false
```

OneMap credentials are optional. If `ONEMAP_EMAIL` or `ONEMAP_PASSWORD` is blank, report creation, report editing, and coordinate backfill use the local Singapore fallback resolver. Do not commit `.env` or expose private credentials.

## Run the Full Local Demo

Use this flow when you want the dashboard and RealtimeSTT running together for a prototype demo. Ollama usually runs automatically in the background on Windows, so the script checks whether it is reachable instead of starting it.

1. Start MySQL first.
2. Confirm `.env` exists in the project root.
3. Run `npm install` if `node_modules` is missing.
4. Run the demo launcher:

   ```powershell
   npm run demo
   ```

The demo uses:

- Dashboard on `http://localhost:3000`
- RealtimeSTT on `http://127.0.0.1:8010`
- Ollama on `http://localhost:11434`
- MySQL on `localhost:3306`

The launcher opens separate PowerShell windows for the dashboard and RealtimeSTT, opens the dashboard in your browser, and checks the Ollama API at `http://localhost:11434/api/tags`. It does not start MySQL or Ollama.

By default, the script expects RealtimeSTT at:

```text
C:\Users\goati\Downloads\RealtimeSTT
```

If your RealtimeSTT folder is somewhere else, edit `$RealtimeSttPath` near the top of `scripts/start-demo.ps1`, then run `npm run demo` again. The script checks that the RealtimeSTT folder, `.venv-fastapi`, and `example_fastapi_server\server.py` exist before starting the service.

To stop the demo, close the separate PowerShell windows for the dashboard and RealtimeSTT.

## Seed Sample Incident Reports

The dashboard and analytics read from the MySQL `incidents` table. To load realistic school-prototype data:

```powershell
npm run seed
```

The seed script inserts or refreshes 10 sample reports with IDs `INC-1001` through `INC-1010`, including residential fires, kitchen fire, road traffic accident, lift rescues, gas leak, electrical fire, rubbish chute fire, and vehicle fire. The script uses `ON DUPLICATE KEY UPDATE`, so running it again refreshes those same sample records instead of creating duplicates.

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

## Run Ollama

The dashboard calls Ollama from the Node.js backend. The browser never calls Ollama directly.

1. Install Ollama from:

   ```text
   https://ollama.com
   ```

2. Pull the local model:

   ```powershell
   ollama pull qwen2.5:1.5b
   ```

3. Confirm Ollama is running:

   ```powershell
   ollama list
   ```

4. Ollama should be available at:

   ```text
   http://localhost:11434
   ```

## How Each Feature Works

### Live Call Intake Flow

```text
Start Transcription
-> Speak into microphone
-> RealtimeSTT converts speech to text
-> Live Transcript updates
-> Full Transcript stores committed transcript
-> Send transcript to Create Report
```

The page streams browser microphone audio to `ws://localhost:8010/ws/transcribe`. Stop Transcription commits the latest Live Transcript once, and Clear Transcript resets live, full, and cleaned transcript state.

### AI Report Flow

```text
Raw Transcript
-> Clean Transcript Text
-> AI-Assisted Incident Draft
-> Officer Review
-> Save Report
```

Backend AI endpoints:

```text
POST /api/ai/clean-transcript
POST /api/reports/generate
```

Both endpoints call Ollama at `OLLAMA_HOST` using `OLLAMA_MODEL`.

### Incident CRUD Flow

```text
Create Report
-> Save to MySQL
-> View in Incident Reports
-> Edit or Delete if needed
-> Dashboard and Analytics update after refresh
```

### Map Flow

```text
Incident Location
-> Resolve Latitude and Longitude
-> Save Coordinates to MySQL
-> Dashboard Sends Map Payload
-> Leaflet Displays Marker
```

### Analytics Flow

```text
MySQL Incident Records
-> Group by Type / Status / Location
-> Calculate Totals and Percentages
-> Display Analytics Summary
```

## Troubleshooting

### Port 8010 Already in Use

RealtimeSTT needs port `8010`. Stop the process using that port, or start RealtimeSTT on another port and update the dashboard transcription connection if needed.

### Map Marker Does Not Appear

Confirm the report has valid `latitude` and `longitude` values. Completed, reviewed, closed, and resolved reports are intentionally hidden from the live map. Run the coordinate backfill script if older reports are missing coordinates.

### Dashboard Does Not Connect to MySQL

Confirm MySQL is running and that `.env` contains the correct `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, and `DB_PORT`. The demo script only checks whether MySQL is reachable; it does not start MySQL.

### Ollama Not Responding

Confirm Ollama is installed and running:

```powershell
ollama list
```

Then check:

```text
http://localhost:11434/api/tags
```

If Ollama is unavailable, transcript cleanup and AI report generation may fail, but manual report editing remains available.

### RealtimeSTT Not Responding

Confirm RealtimeSTT is running on `http://localhost:8010` or `http://127.0.0.1:8010`. If the demo launcher cannot start it, check that the RealtimeSTT folder, `.venv-fastapi`, and `example_fastapi_server\server.py` exist.

### Raw Transcript Does Not Send

Confirm there is text in Live Transcript, Full Transcript, Clean Transcript Text, or the manual transcript field before sending. Sent transcripts are stored in `localStorage`, then loaded into the Create Report transcript field.

## Project Status

This is a midpoint prototype.

Completed:

- Dashboard overview
- Incident report CRUD
- MySQL storage
- AI-assisted report drafting
- Transcript cleanup
- Live Call Intake proof-of-concept
- Incident map
- Analytics summary
- Search and filtering
- GitHub version control

## Future Improvements

- Improve transcript accuracy
- Improve report validation
- Improve location mapping
- Add Docker containerisation
- Set up CI/CD pipeline
- Add testing and validation
- Prepare deployment workflow
