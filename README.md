# Firefighter Smart Incident Dashboard

Node.js, Express, EJS, Bootstrap, MySQL, and plain JavaScript dashboard for firefighter incident reporting.

## Run The Node.js Dashboard

1. Install dependencies:

   ```powershell
   npm install
   ```

2. Confirm `.env` contains the MySQL, Ollama, and optional OneMap settings:

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

   OneMap credentials are optional. If `ONEMAP_EMAIL` or `ONEMAP_PASSWORD` is blank, report creation/editing and coordinate backfill use the local Singapore fallback resolver.

3. Start the dashboard:

   ```powershell
   npm start
   ```

4. Open:

   ```text
   http://localhost:3000
   ```

## Running the Full Local Demo

Use this flow when you want the dashboard and RealtimeSTT running together for a prototype demo. Ollama usually runs automatically in the background on Windows, so the script checks whether it is reachable instead of starting it.

1. Start MySQL first. The demo script checks whether MySQL is reachable, but it does not start MySQL for you.
2. Install Node.js dependencies if needed:

   ```powershell
   npm install
   ```

3. Create `.env` in the project root with your local MySQL, Ollama, and optional OneMap settings. Do not commit `.env`.
4. Run the demo launcher:

   ```powershell
   npm run demo
   ```

The launcher opens separate PowerShell windows for:

- Dashboard: the Node.js / Express app at `http://localhost:3000`
- RealtimeSTT: the Python FastAPI transcription service at `http://127.0.0.1:8010`

The launcher also opens the dashboard in your browser and checks the Ollama API at `http://localhost:11434/api/tags`. If Ollama is not reachable, AI cleanup and report generation may not work until Ollama is running.

The launcher prints:

```text
Dashboard:   http://localhost:3000
RealtimeSTT: http://127.0.0.1:8010
Ollama API:  http://localhost:11434/api/tags
```

By default, the script expects RealtimeSTT at:

```text
C:\Users\goati\Downloads\RealtimeSTT
```

If your RealtimeSTT folder is somewhere else, edit `$RealtimeSttPath` near the top of `scripts/start-demo.ps1`, then run `npm run demo` again. The script checks that the RealtimeSTT folder, `.venv-fastapi`, and `example_fastapi_server\server.py` exist before starting the service.

To stop the demo, close the separate PowerShell windows for the dashboard and RealtimeSTT.

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

## Incident Map, Geocoding, Completion, And Search

The Dashboard includes a Live Incident Map built with Leaflet.js and OpenStreetMap tiles. The map uses current MySQL incident rows every time the dashboard loads. It does not use hardcoded sample markers.

Live map rules:

- Incidents appear on the live map only when they have finite `latitude` and `longitude` values.
- Completed-like statuses are hidden from the live map when `response_status` contains `completed`, `reviewed`, `closed`, or `resolved`.
- Pending or awaiting incidents are orange.
- Escalated, urgent, critical, or requires-urgent-review incidents are red.
- Active, ongoing, dispatched, or in-progress incidents are blue.
- Live incidents without usable coordinates appear under Unmapped Incidents.

Report creation and edit flows resolve coordinates before saving when the `latitude` and `longitude` columns exist. Coordinate resolution order is:

1. Existing valid latitude and longitude.
2. OneMap Search API, when `ONEMAP_EMAIL` and `ONEMAP_PASSWORD` are configured.
3. Local Singapore fallback matching from location, transcript, or summary.
4. `null` if no match is found.

The local fallback includes common Singapore areas such as Jurong West, Bedok, Tampines, Woodlands, Yishun, Ang Mo Kio, Toa Payoh, Bukit Batok, Sengkang, Sentosa, Siloso Beach, Beach Station, and Orchard.

To backfill old reports that are missing coordinates:

```powershell
node scripts/backfillIncidentCoordinates.js
```

The script finds rows where `latitude IS NULL OR longitude IS NULL`, resolves coordinates from location, summary, and transcript, updates MySQL when possible, and prints updated or skipped records.

For backend-only map payload debugging in non-production:

```text
GET /dev/map-payload
```

When `GEOCODING_DEBUG=true`, dashboard rendering also logs map payload counts to the Node.js console. No OneMap credentials or tokens are exposed to the browser.

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
2. Open `http://localhost:3000/dev/map-payload` during development to confirm mapped, unmapped, and completed-hidden counts.
3. Search from the topbar or Incident Reports page.
4. Combine search with the status dropdown.
5. Open Create Report and clear required fields to see completion drop.
6. Open an existing report detail page to see saved completion.

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

## Live Call Intake Transcript Flow

1. Start RealtimeSTT on `http://localhost:8010`.
2. Start this dashboard on `http://localhost:3000`.
3. Open `Live Call Intake` from the dashboard sidebar.
4. Click `Start Transcription` and allow microphone access.
5. The page streams browser microphone audio to `ws://localhost:8010/ws/transcribe`.
6. Live Transcript shows the latest realtime or partial speech segment.
7. Full Transcript stores finalized or explicitly committed speech segments. Partial updates are not appended line-by-line.
8. Stop Transcription commits the latest Live Transcript once and keeps Full Transcript.
9. Send Raw Transcript commits the current Live Transcript, then sends Full Transcript to Create Report.
10. Clean Transcript uses Full Transcript when available, with manual input as fallback.
11. Send Clean Transcript prefers the cleaned transcript, then Full Transcript, then manual input.
12. Clear Transcript is the only action that resets live, full, and cleaned transcript state.
13. If RealtimeSTT is not running, paste text into the manual transcript fallback textarea.
14. Sent transcripts are stored in `localStorage`, then loaded into the Create Report transcript field.

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
2. Open `Live Call Intake`.
3. Record or paste a raw transcript.
4. Click `Clean Transcript`.
5. Review and edit the cleaned transcript.
6. Click `Send Clean Transcript`.
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
- Ollama is local only and is called from the Node.js backend, not browser JavaScript.
- OneMap geocoding is called from backend code only. OneMap email, password, and access tokens are never sent to EJS or frontend JavaScript.
