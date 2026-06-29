# Firefighter Smart Incident Dashboard

Node.js, Express, EJS, Bootstrap, MySQL, and plain JavaScript dashboard for firefighter incident reporting.

## Run The Node.js Dashboard

1. Install dependencies:

   ```powershell
   npm install
   ```

2. Confirm `.env` contains the MySQL settings:

   ```env
   DB_HOST=localhost
   DB_USER=root
   DB_PASSWORD=your_password
   DB_NAME=firefighter_dashboard
   DB_PORT=3306
   OLLAMA_HOST=http://localhost:11434
   OLLAMA_MODEL=qwen2.5:1.5b
   ```

3. Start the dashboard:

   ```powershell
   npm start
   ```

4. Open:

   ```text
   http://localhost:3000
   ```

## Seed Incident Reports

The dashboard and analytics read from the MySQL `incidents` table. To load realistic school-prototype data:

```powershell
npm run seed
```

The seed script inserts or refreshes 10 sample reports with IDs `INC-1001` through `INC-1010`, including residential fires, kitchen fire, road traffic accident, lift rescues, gas leak, electrical fire, rubbish chute fire, and vehicle fire. The script uses `ON DUPLICATE KEY UPDATE`, so running it again refreshes those same sample records instead of creating duplicates.

## Dashboard And Analytics Data

Dashboard values are recalculated from MySQL whenever the page reloads:

- Total Incident Reports: count of all rows in `incidents`
- Pending Review: rows where `response_status = 'Pending Review'`
- Completed Reports: rows where `response_status = 'Completed'`
- Reports This Week: rows whose `incident_datetime` falls in the current week
- Escalated Incidents: rows where `response_status = 'Escalated'`

Analytics values are also recalculated from MySQL:

- Incident count by type groups rows by `incident_type`
- Incident count by status groups rows by `response_status`
- Top locations groups rows by `location`
- Percentages are calculated as `group count / total report count`

The database does not currently store response time, so the dashboard uses `Reports This Week` instead of an average response-time metric.

## Test Dashboard Updates

1. Run `npm run seed`.
2. Start the app with `npm start`.
3. Open `http://localhost:3000/dashboard` and confirm totals appear.
4. Open `http://localhost:3000/analytics` and confirm percentages match the seeded records.
5. Create a new report from `Create Report`, then refresh Dashboard and Analytics.
6. Edit a report status, then refresh Pending, Completed, or Escalated pages.
7. Delete a report, then refresh Dashboard and Analytics to confirm totals decrease.

## Incident Map, Completion, And Search

The Dashboard includes an Incident Map built with Leaflet.js and OpenStreetMap tiles. It does not require a paid API key. Reports use `latitude` and `longitude` if those columns exist in MySQL. If they do not exist, the app falls back to built-in coordinates for common Singapore areas such as Jurong West, Bedok, Tampines, Woodlands, Yishun, Ang Mo Kio, and Toa Payoh. Reports with unknown locations are shown in an Unmapped Incidents list below the map.

Report completion appears on Create Report, Edit Report, and Report Details. Completion is based on seven required fields:

- Incident Location
- Incident Type
- Date and Time
- Incident Summary
- Response Status
- Hazards
- Injured or Trapped Persons

The progress bar updates while editing forms. Reports below 70% show `Review required before submission.` Complete reports show `Report appears complete.` This is advisory only; it does not block the existing MySQL save flow.

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

To test:

1. Open `http://localhost:3000/dashboard` and confirm map markers appear.
2. Search from the topbar or Incident Reports page.
3. Combine search with the status dropdown.
4. Open Create Report and clear required fields to see completion drop.
5. Open an existing report detail page to see saved completion.

## Run RealtimeSTT Separately

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

## Real-Time Transcription Flow

1. Start RealtimeSTT on `http://localhost:8010`.
2. Start this dashboard on `http://localhost:3000`.
3. Open `Real-Time Transcription` from the dashboard sidebar.
4. Click `Start Transcription` and allow microphone access.
5. The page streams browser microphone audio to `ws://localhost:8010/ws/transcribe`.
6. Final and realtime transcript messages appear in the transcript display.
7. If RealtimeSTT is not running, paste text into the manual transcript fallback textarea.
8. Click `Send Transcript to Create Report`.
9. The transcript is stored in `localStorage`, then loaded into the Create Report transcript field.

## Run Ollama Locally

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

## AI Cleanup And Report Flow

1. Open the dashboard at `http://localhost:3000`.
2. Open `Real-Time Transcription`.
3. Record or paste a raw transcript.
4. Click `Clean Transcript`.
5. Review and edit the cleaned transcript.
6. Click `Send Clean Transcript to Create Report`.
7. Click `Generate AI Report`.
8. Review and edit all report fields.
9. Save the report with the existing MySQL-backed Save Draft or Save Report buttons.

## AI API Endpoints

Clean transcript:

```text
POST /api/ai/clean-transcript
```

Generate report:

```text
POST /api/reports/generate
```

Both endpoints call Ollama at `OLLAMA_HOST` using `OLLAMA_MODEL`. If Ollama is unavailable, the app returns a clear error and keeps manual editing available. Report generation also returns a conservative fallback draft.

## Notes

- MySQL CRUD remains handled by the existing dashboard backend.
- RealtimeSTT remains a separate local Python/FastAPI service.
- The dashboard does not fail when RealtimeSTT is unavailable.
- Ollama is local only; no cloud AI APIs are used.
