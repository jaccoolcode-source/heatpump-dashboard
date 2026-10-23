# Heatpump Dashboard

A self-hosted dashboard for tracking heat pump energy consumption over time. Displays monthly kWh data for heating and domestic hot water (DHW), temperature trends, and COP statistics.

Built for a **Stiebel Eltron HMD 6 LWD** with a Luxtronik 2.x controller. Readings come from *Monitor energii* and are collected automatically by the `heatpump-collector` service. They can still be edited by hand.

## Stack

- **Node.js** + Express — serves static files and the `/api/data`, `/api/status` and `/api/refresh` endpoints
- **Chart.js** — renders consumption and temperature charts
- **Collector** — Node.js service that reads the controller's remote display (see below)
- **Docker** + Traefik — deployed at `heatpump-dashboard.localhost`

## Project structure

```
.
├── server.js               # Express server
├── public/
│   ├── index.html
│   ├── app.js
│   └── style.css
├── collector/
│   ├── index.js            # schedule, runs, "Refresh now" endpoint
│   ├── lux.js              # controller WebSocket client
│   ├── lcd.js              # LCD frame decoding and text recognition
│   ├── glyphs.json         # font bitmaps of the controller display
│   ├── navigator.js        # verified step-by-step menu navigation
│   ├── history.js          # updates heatpump-history.json
│   └── tools/              # development helpers (capture, teach, probe)
├── data/
│   ├── heatpump-history.json         # your data (gitignored)
│   ├── collector-status.json         # last collector run (gitignored)
│   └── heatpump-history.example.json # structure reference
├── Dockerfile
└── docker-compose.yml
```

## Getting started

1. Copy the example data file and fill in your readings:
   ```bash
   cp data/heatpump-history.example.json data/heatpump-history.json
   ```

2. Run locally:
   ```bash
   npm install
   npm start
   # → http://localhost:3000
   ```

3. Or with Docker (requires Traefik network):
   ```bash
   # Create the shared Traefik network once (if not already created)
   docker network create traefik

   docker compose up -d
   # → http://heatpump-dashboard.localhost
   ```

> **Data persistence:** `./data` is bind-mounted into the container. Editing `heatpump-history.json` on the host takes effect immediately on the next page reload — no container restart needed.

## Collector

The controller shows monthly history and the current month only on its display, which you can view and operate in the browser under *Sieć lokalna*. The collector logs in to the controller and operates that remote display like a person would. It reads the screen text with a bitmap font table, `collector/glyphs.json`.

Each run:
1. If last month is not final yet, it opens *Serwis → Informacje → Monitor energii → Zużycie energii → Historia → year → month*. It stores the consumption and the average outdoor temperature, marked `"source": "Historia"`.
2. It opens *… → Zużycie energii → Bieżący miesiąc* and stores the current month's consumption so far, marked `"source": "Bieżący miesiąc"`.
3. It returns the display to the standard screen.

Runs happen 60 s after the container starts (so a PC that was switched off catches up), daily at 10:15 Europe/Warsaw, and when you click **🔄 Refresh now** on the dashboard. A failed run is retried twice, 5 minutes apart.

**Safety.** Every key press is decided from the screen currently shown. OK is pressed only when the back arrow is selected, or when the selected row is the next one on the path above. The row is checked twice, a moment apart. Unknown screens are backed out of. Values that cannot be read exactly, or where heating + hot water ≠ total, fail the run instead of being written.

**Setup.** Create `.env` in the project root (gitignored):
```
LUX_HOST=192.168.231.149
LUX_PASSWORD=your-controller-password
```

Logs: `docker logs heatpump-collector`. The display is shared with the panel on the wall and any open *Sieć lokalna* browser tab. Avoid using them during a run.

## Data format

`data/heatpump-history.json` — monthly end-of-month readings:

```json
{
  "description": "...",
  "readings": {
    "YYYY-MM": {
      "date": "YYYY-MM-DD",
      "avgTemp": 5,
      "consumed": { "heating": 656.8, "dhw": 87.1, "total": 743.9 },
      "produced": { "heating": null,  "dhw": null,  "total": null  }
    }
  }
}
```

`produced` values are used to calculate COP. Set to `null` if not available from your heat pump.

Entries written by the collector also carry `source` (`"Historia"` = final, `"Bieżący miesiąc"` = month so far) and `updatedAt`. The previous version of the file is kept as `heatpump-history.json.bak`.

## Data privacy

`data/heatpump-history.json` is gitignored — it contains real home energy consumption data and is never committed.
