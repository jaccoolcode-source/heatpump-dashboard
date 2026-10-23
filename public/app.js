'use strict';

// ── Constants ─────────────────────────────────────────────────────────────────
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTHS_LONG  = ['January','February','March','April','May','June',
                      'July','August','September','October','November','December'];
const YR_COLORS    = ['#4a90e2','#4caf77','#e74c3c','#f39c12','#9b59b6','#1abc9c','#e67e22','#ec407a'];
const CHART_YEARS_SHOWN = 3;               // most recent years visible in the charts by default
const AUTO_RELOAD_MS   = 30 * 60 * 1000;   // reload data while the page stays open
const STATUS_POLL_MS   = 3000;             // while a refresh is running
const REFRESH_TIMEOUT  = 5 * 60 * 1000;

// ── State ─────────────────────────────────────────────────────────────────────
let heatpumpData    = null;
let consumptionChart = null;
let temperatureChart = null;
let selectedYear    = String(new Date().getFullYear());
let years           = [];                  // years with readings plus the current year, oldest first

// ── Boot ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  setupCharts();
  await loadData();
  setInterval(loadData, AUTO_RELOAD_MS);
});

// ── Data loading ──────────────────────────────────────────────────────────────
async function loadData() {
  try {
    const res = await fetch('/api/data');
    heatpumpData = await res.json();
    renderAll();
    await loadStatus();
  } catch (err) {
    console.error('Load error:', err);
    el('lastUpdated').textContent = '⚠️ Error loading data';
  }
}

function renderAll() {
  updateYears();
  renderKpi();
  renderConsumptionChart();
  renderTemperatureChart();
  renderHistoryTable();
  renderTotals();
}

// ── Collector status ──────────────────────────────────────────────────────────
async function loadStatus() {
  const res    = await fetch('/api/status');
  const status = await res.json();
  renderStatus(status);
  return status;
}

function renderStatus(status) {
  const fmt  = iso => new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  const last = status.lastRun;
  let text;
  if (status.running) {
    text = '⏳ Reading the heat pump controller…';
  } else if (last && !last.ok && last.finishedAt) {
    text = `⚠️ Controller read failed ${fmt(last.finishedAt)}: ${last.error}`;
    if (status.lastSuccess) text += ` · last successful ${fmt(status.lastSuccess.finishedAt)}`;
  } else if (status.lastSuccess) {
    text = `Updated from the controller · ${fmt(status.lastSuccess.finishedAt)}`;
  } else {
    text = 'Updated manually';
  }
  el('lastUpdated').textContent = text;
  el('refreshBtn').disabled = Boolean(status.running);
}

async function refreshNow() {
  el('refreshBtn').disabled = true;
  try {
    const res  = await fetch('/api/refresh', { method: 'POST' });
    const body = await res.json();
    if (!body.started) {
      el('lastUpdated').textContent = `⚠️ ${body.reason}`;
      if (res.status !== 409) el('refreshBtn').disabled = false;
      return;
    }
    const deadline = Date.now() + REFRESH_TIMEOUT;
    let status;
    do {
      await new Promise(r => setTimeout(r, STATUS_POLL_MS));
      status = await loadStatus();
    } while (status.running && Date.now() < deadline);
    await loadData();
  } catch (err) {
    console.error('Refresh error:', err);
    el('lastUpdated').textContent = '⚠️ Refresh failed';
    el('refreshBtn').disabled = false;
  }
}

// ── KPI Cards ─────────────────────────────────────────────────────────────────
function renderKpi() {
  const readings = heatpumpData?.readings || {};
  const now      = new Date();
  const curYear  = String(now.getFullYear());

  // Current year total
  let yearTotal = 0;
  for (let m = 1; m <= 12; m++) {
    const key = `${curYear}-${String(m).padStart(2,'0')}`;
    yearTotal += readings[key]?.consumed?.total || 0;
  }
  el('kpiYear').textContent = yearTotal > 0 ? yearTotal.toFixed(0) : '—';

  // Peak consumption month (all years)
  let peakVal = 0, peakKey = null;
  for (const [key, r] of Object.entries(readings)) {
    const v = r?.consumed?.total || 0;
    if (v > peakVal) { peakVal = v; peakKey = key; }
  }
  if (peakKey) {
    const [py, pm] = peakKey.split('-');
    el('kpiPeak').textContent    = peakVal.toFixed(0);
    el('kpiPeakDate').textContent = `${MONTHS_LONG[parseInt(pm)-1]} ${py}`;
  }

  // Overall COP (all entries with produced data)
  let totalConsumed = 0, totalProduced = 0;
  for (const r of Object.values(readings)) {
    if (r?.consumed?.total) totalConsumed += r.consumed.total;
    if (r?.produced?.total) totalProduced += r.produced.total;
  }
  if (totalConsumed > 0 && totalProduced > 0) {
    el('kpiCop').textContent = (totalProduced / totalConsumed).toFixed(2);
  }

  // All-time total consumed
  el('kpiTotal').textContent = totalConsumed > 0 ? totalConsumed.toFixed(0) : '—';
}

// ── Charts ────────────────────────────────────────────────────────────────────
function setupCharts() {
  Chart.defaults.color       = '#5e7399';
  Chart.defaults.borderColor = 'rgba(255,255,255,0.05)';

  // Consumption chart
  const cCtx = document.getElementById('consumptionChart').getContext('2d');
  consumptionChart = new Chart(cCtx, {
    type: 'bar',
    data: {
      labels:   MONTHS_SHORT,
      datasets: []
    },
    options: {
      responsive:          true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ctx.raw === null
              ? ` ${ctx.dataset.label}: no data`
              : ` ${ctx.dataset.label}: ${ctx.raw.toFixed(1)} kWh`
          }
        }
      },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.04)' } },
        y: {
          grid:  { color: 'rgba(255,255,255,0.04)' },
          title: { display: true, text: 'kWh', color: '#5e7399', font: { size: 11 } },
          beginAtZero: true
        }
      }
    }
  });

  // Temperature chart
  const tCtx = document.getElementById('temperatureChart').getContext('2d');
  temperatureChart = new Chart(tCtx, {
    type: 'bar',
    data: {
      labels:   MONTHS_SHORT,
      datasets: []
    },
    options: {
      responsive:          true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ctx.raw === null
              ? ` ${ctx.dataset.label}: no data`
              : ` ${ctx.dataset.label}: ${ctx.raw.toFixed(1)} °C`
          }
        }
      },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.04)' } },
        y: {
          grid:  { color: 'rgba(255,255,255,0.04)' },
          title: { display: true, text: '°C', color: '#5e7399', font: { size: 11 } }
        }
      }
    }
  });
}

// ── Years ─────────────────────────────────────────────────────────────────────
// Years come from the data (plus the current year), so a new year appears as soon as it has a reading.
function updateYears() {
  const found = new Set(Object.keys(heatpumpData?.readings || {}).map(k => k.slice(0, 4)));
  found.add(String(new Date().getFullYear()));
  const next = [...found].filter(y => /^\d{4}$/.test(y)).sort();
  if (next.join() === years.join()) return;

  years = next;
  if (!years.includes(selectedYear)) selectedYear = years[years.length - 1];
  const hiddenByDefault = i => i < years.length - CHART_YEARS_SHOWN;

  for (const chart of [consumptionChart, temperatureChart]) {
    chart.data.datasets = years.map((yr, i) => ({
      label:           yr,
      data:            Array(12).fill(null),
      backgroundColor: yearColor(i),
      borderRadius:    5,
      borderSkipped:   false,
      hidden:          hiddenByDefault(i),
    }));
  }

  const toggles = onchange => years.map((yr, i) => `
    <label class="toggle">
      <input type="checkbox" ${hiddenByDefault(i) ? '' : 'checked'} onchange="${onchange}(${i})" />
      <span class="badge" style="--c: ${yearColor(i)}">${yr}</span>
    </label>`).join('');
  el('consumptionToggles').innerHTML = toggles('toggleConsumptionYear');
  el('tempToggles').innerHTML        = toggles('toggleTempYear');

  el('yearTabs').innerHTML = [...years].reverse()
    .map(yr => `<button class="year-tab${yr === selectedYear ? ' active' : ''}" data-year="${yr}">${yr}</button>`)
    .join('');
  setupYearTabs();
}

function yearColor(index) {
  return YR_COLORS[index % YR_COLORS.length];
}

function renderConsumptionChart() {
  if (!consumptionChart || !heatpumpData) return;
  const readings = heatpumpData.readings || {};
  years.forEach((yr, i) => {
    consumptionChart.data.datasets[i].data = MONTHS_SHORT.map((_, mi) => {
      const key = `${yr}-${String(mi+1).padStart(2,'0')}`;
      return readings[key]?.consumed?.total ?? null;
    });
  });
  consumptionChart.update();
}

function renderTemperatureChart() {
  if (!temperatureChart || !heatpumpData) return;
  const readings = heatpumpData.readings || {};
  years.forEach((yr, i) => {
    temperatureChart.data.datasets[i].data = MONTHS_SHORT.map((_, mi) => {
      const key = `${yr}-${String(mi+1).padStart(2,'0')}`;
      return readings[key]?.avgTemp ?? null;
    });
  });
  temperatureChart.update();
}

function toggleConsumptionYear(index) {
  if (!consumptionChart) return;
  const ds = consumptionChart.data.datasets[index];
  ds.hidden = !ds.hidden;
  consumptionChart.update();
}

function toggleTempYear(index) {
  if (!temperatureChart) return;
  const ds = temperatureChart.data.datasets[index];
  ds.hidden = !ds.hidden;
  temperatureChart.update();
}

// ── History Table ─────────────────────────────────────────────────────────────
function setupYearTabs() {
  document.querySelectorAll('#yearTabs .year-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('#yearTabs .year-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      selectedYear = tab.dataset.year;
      renderHistoryTable();
    });
  });
}

function renderHistoryTable() {
  if (!heatpumpData) return;
  const readings = heatpumpData.readings || {};
  const tbody    = el('historyBody');
  const rows     = [];
  let sumHeat = 0, sumDhw = 0, sumTotal = 0;
  let tempSum = 0, tempCount = 0;
  let sumConsumed = 0, sumProduced = 0;

  for (let m = 1; m <= 12; m++) {
    const key = `${selectedYear}-${String(m).padStart(2,'0')}`;
    const r   = readings[key];
    const c   = r?.consumed;
    const hasData = c && c.total != null;
    const temp    = r?.avgTemp;

    if (hasData) {
      sumHeat  += c.heating || 0;
      sumDhw   += c.dhw     || 0;
      sumTotal += c.total   || 0;
      sumConsumed += c.total || 0;
      if (r?.produced?.total) sumProduced += r.produced.total;
    }
    if (temp != null) { tempSum += temp; tempCount++; }

    const cop = (c?.total && r?.produced?.total)
      ? (r.produced.total / c.total).toFixed(2)
      : '<span class="no-data">—</span>';

    rows.push(`<tr>
      <td>${MONTHS_LONG[m-1]}</td>
      <td>${temp != null ? temp.toFixed(1)+' °C' : '<span class="no-data">—</span>'}</td>
      <td class="col-heat">${hasData ? (c.heating||0).toFixed(1) : '<span class="no-data">—</span>'}</td>
      <td class="col-dhw">${hasData ? (c.dhw||0).toFixed(1) : '<span class="no-data">—</span>'}</td>
      <td>${hasData ? c.total.toFixed(1) : '<span class="no-data">—</span>'}</td>
      <td>${cop}</td>
    </tr>`);
  }

  tbody.innerHTML = rows.join('');

  el('footAvgTemp').textContent   = tempCount   > 0 ? (tempSum/tempCount).toFixed(1)+' °C' : '—';
  el('footTotalHeat').textContent = sumHeat      > 0 ? sumHeat.toFixed(1)+' kWh' : '—';
  el('footTotalDhw').textContent  = sumDhw       > 0 ? sumDhw.toFixed(1)+' kWh' : '—';
  el('footTotal').textContent     = sumTotal     > 0 ? sumTotal.toFixed(1)+' kWh' : '—';
  el('footCop').textContent       = (sumConsumed > 0 && sumProduced > 0)
    ? (sumProduced/sumConsumed).toFixed(2) : '—';
}

// ── All-time Totals ───────────────────────────────────────────────────────────
function renderTotals() {
  if (!heatpumpData) return;
  const readings = heatpumpData.readings || {};
  let heatC = 0, heatP = 0, dhwC = 0, dhwP = 0, totalC = 0, totalP = 0;

  for (const r of Object.values(readings)) {
    heatC  += r?.consumed?.heating || 0;
    dhwC   += r?.consumed?.dhw     || 0;
    totalC += r?.consumed?.total   || 0;
    if (r?.produced) {
      heatP  += r.produced.heating || 0;
      dhwP   += r.produced.dhw     || 0;
      totalP += r.produced.total   || 0;
    }
  }

  const fmt = v => v > 0 ? v.toFixed(1) : '—';
  const cop = (c, p) => (c > 0 && p > 0) ? (p/c).toFixed(2) : '—';

  el('totHeatConsumed').textContent = fmt(heatC);
  el('totHeatProduced').textContent = fmt(heatP);
  el('totHeatCop').textContent      = cop(heatC, heatP);
  el('totDhwConsumed').textContent  = fmt(dhwC);
  el('totDhwProduced').textContent  = fmt(dhwP);
  el('totDhwCop').textContent       = cop(dhwC, dhwP);
  el('totConsumed').textContent     = fmt(totalC);
  el('totProduced').textContent     = fmt(totalP);
  el('totCop').textContent          = cop(totalC, totalP);
}

// ── Copy Stats ────────────────────────────────────────────────────────────────
function buildStatsMessage() {
  const readings = heatpumpData?.readings || {};
  const now      = new Date();
  const curYear  = String(now.getFullYear());

  // Build rows for selected year (use current year for copy)
  const lines = [`🔥 Pompa Ciepla – Statystyki ${curYear}`, ''];
  let sumHeat = 0, sumDhw = 0, sumTotal = 0;

  for (let m = 1; m <= 12; m++) {
    const key = `${curYear}-${String(m).padStart(2,'0')}`;
    const r   = readings[key];
    const c   = r?.consumed;
    if (!c?.total) continue;

    const monthLabel = MONTHS_SHORT[m-1].padEnd(4,' ');
    const temp = r?.avgTemp != null ? `${r.avgTemp.toFixed(0).padStart(3,' ')}°` : '   ';
    const heat = String((c.heating||0).toFixed(0)).padStart(5,' ')+' kWh';
    const dhw  = String((c.dhw||0).toFixed(0)).padStart(4,' ')+' kWh';
    const tot  = String(c.total.toFixed(0)).padStart(5,' ')+' kWh';

    lines.push(`${monthLabel} ${temp}  heating: ${heat}  DHW: ${dhw}  total: ${tot}`);
    sumHeat  += c.heating || 0;
    sumDhw   += c.dhw     || 0;
    sumTotal += c.total;
  }

  if (sumTotal > 0) {
    lines.push('─────────────────────────────────────────');
    lines.push(`Total ${curYear}: heating ${sumHeat.toFixed(0)} kWh  DHW ${sumDhw.toFixed(0)} kWh  total ${sumTotal.toFixed(0)} kWh`);
  }

  // All-time totals
  let allTotal = 0;
  for (const r of Object.values(readings)) allTotal += r?.consumed?.total || 0;
  if (allTotal > 0) {
    lines.push('');
    lines.push(`⚡ Total since installation: ${allTotal.toFixed(0)} kWh`);
  }

  return lines.join('\n');
}

function copyStats() {
  if (!heatpumpData) { showToast('❌ No data'); return; }
  const msg = buildStatsMessage();
  navigator.clipboard.writeText(msg)
    .then(() => showToast('📋 Copied to clipboard!'))
    .catch(() => showToast('❌ Clipboard access denied'));
}

// ── Toast ─────────────────────────────────────────────────────────────────────
let toastTimer = null;
function showToast(msg) {
  const t = el('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
}

// ── Utility ───────────────────────────────────────────────────────────────────
function el(id) { return document.getElementById(id); }
