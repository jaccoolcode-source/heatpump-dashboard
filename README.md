# Heatpump Dashboard

A self-hosted dashboard for tracking heat pump energy consumption over time. Displays monthly kWh data for heating and domestic hot water (DHW), temperature trends, and COP statistics.

Built for a **Stiebel Eltron HMD 6 LWD** — readings entered manually from *Monitor energii*.

## Stack

- **Node.js** + Express — serves static files and a single `/api/data` endpoint
- **Chart.js** — renders consumption and temperature charts
- **Docker** + Traefik — deployed at `heatpump-dashboard.localhost`

## Project structure

```
.
├── server.js               # Express server
├── public/
│   ├── index.html
│   ├── app.js
│   └── style.css
├── data/
│   ├── heatpump-history.json         # your data (gitignored)
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
   docker compose up -d
   # → http://heatpump-dashboard.localhost
   ```

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

## Data privacy

`data/heatpump-history.json` is gitignored — it contains real home energy consumption data and is never committed.
