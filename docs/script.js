// ---- Parameters ----
const LOSS_TLI_AMPLIFIER = 0.8;

// ---- State ----
let chartSJRI = null, chartREHI = null;

// ---- DOM ----
const tbody = document.getElementById("tbody");
const shockEl = document.getElementById("shock");
const shockVal = document.getElementById("shockVal");
const redlineEl = document.getElementById("redline");

// ---- Helpers ----
const clip01 = x => Math.max(0, Math.min(1, x));
const fmt = v => isFinite(v) ? v.toFixed(3) : "-";

function newRow(values={}) {
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td><input type="text"   value="${values.name||""}"        placeholder="Shinkin A"></td>
    <td><input type="text"   value="${values.region||""}"      placeholder="Tokyo"></td>
    <td><input type="number" value="${values.assets||""}"      step="1" min="0" placeholder="1200000000000"></td>
    <td><input type="number" value="${values.equity||""}"      step="1" min="0" placeholder="50000000000"></td>
    <td><input type="number" value="${values.jgbRatio||""}"    step="0.1" min="0" max="100" placeholder="30"></td>
    <td><input type="number" value="${values.duration||""}"    step="0.1" min="0" placeholder="6"></td>
    <td><input type="number" value="${values.npl||""}"         step="0.01" min="0" max="1" placeholder="0.02"></td>
    <td><input type="number" value="${values.tli||""}"         step="0.05" min="0" max="1" placeholder="0.5"></td>
    <td><input type="number" value="${values.div||""}"         step="0.05" min="0" max="1" placeholder="0.65"></td>
    <td class="moveflag">-</td>
    <td><button class="ghost del">×</button></td>
  `;
  tbody.appendChild(tr);
}

function readRows() {
  const rows = [];
  [...tbody.querySelectorAll("tr")].forEach(tr => {
    const [name, region, assets, equity, jgbRatio, duration, npl, tli, div] =
      [...tr.querySelectorAll("input")].map(i => i.type==="text" ? i.value.trim() : Number(i.value));
    if (!name && !region && !assets && !equity) return;
    rows.push({
      name: name || "Unnamed",
      region: region || "Unknown",
      total_assets_jpy: +assets || 0,
      equity_capital_jpy: +equity || 0,
      jgb_ratio: +jgbRatio || 0, // %
      duration_years: +duration || 0,
      npl_ratio: clip01(+npl || 0),
      tli: clip01(+tli || 0),
      diversification_index: clip01(+div || 0)
    });
  });
  return rows;
}

// per-institution metrics at selected shock
function instSJRI(row, shockPct) {
  const jgb = row.total_assets_jpy * (row.jgb_ratio/100);
  const raw = row.duration_years * (shockPct/100) * jgb;
  const loss = raw * (1 + LOSS_TLI_AMPLIFIER * row.tli);
  const lte  = row.equity_capital_jpy > 0 ? loss / row.equity_capital_jpy : Infinity;

  const stressed  = Math.max(0.15, 0.30 - 0.10*row.tli);
  const insolvent = Math.max(0.60, 1.00 - 0.20*row.tli);
  if (!isFinite(lte)) return 1;
  if (lte <= stressed) return 0;
  if (lte >= insolvent) return 1;
  return (lte - stressed) / (insolvent - stressed);
}

function instREHI(row, shockPct) {
  const jgb = row.total_assets_jpy * (row.jgb_ratio/100);
  const raw = row.duration_years * (shockPct/100) * jgb;
  const loss = raw * (1 + LOSS_TLI_AMPLIFIER * row.tli);
  const lte  = row.equity_capital_jpy > 0 ? loss / row.equity_capital_jpy : 0;

  const L = clip01(lte);
  const F = clip01(row.npl_ratio);
  const T = clip01(row.tli);
  const D = clip01(row.diversification_index);
  return 100 * (0.30*(1-L) + 0.30*(1-F) + 0.20*(1-T) + 0.20*D);
}

function recomputeAndRender() {
  const shock = Number(shockEl.value);
  shockVal.textContent = shock.toFixed(2) + "%";
  const redline = Number(redlineEl.value);

  const data = readRows();
  const sjri = data.map(r => instSJRI(r, shock));
  const rehi = data.map(r => instREHI(r, shock));

  // move-flag
  [...tbody.querySelectorAll("tr")].forEach((tr, i) => {
    const cell = tr.querySelector(".moveflag");
    if (i >= data.length) { cell.textContent = "-"; return; }
    const alert = (sjri[i] >= redline);
    cell.textContent = alert ? "YES" : "NO";
    cell.style.background = alert ? "#3a1120" : "transparent";
  });

  // charts
  drawBars("chartSJRI", "SJRI (0–1)", sjri, "sjri");
  drawBars("chartREHI", "REHI (0–100)", rehi, "rehi");

  function drawBars(canvasId, label, values, key) {
    const ctx = document.getElementById(canvasId).getContext("2d");
    const labels = data.map(r => r.name);
    if (key==="sjri") {
      if (chartSJRI) chartSJRI.destroy();
      chartSJRI = new Chart(ctx, {
        type: "bar",
        data: { labels, datasets: [{ label, data: values }] },
        options: { responsive:true, maintainAspectRatio:false,
          scales: { y: { min:0, max: key==="sjri" ? 1 : undefined } } }
      });
    } else {
      if (chartREHI) chartREHI.destroy();
      chartREHI = new Chart(ctx, {
        type: "bar",
        data: { labels, datasets: [{ label, data: values }] },
        options: { responsive:true, maintainAspectRatio:false,
          scales: { y: { min:0, max: key==="rehi" ? 100 : undefined } } }
      });
    }
  }
}

// ---- Events ----
document.getElementById("addRow").addEventListener("click", () => {
  newRow();
  bindRowEvents();
});
document.getElementById("clearRows").addEventListener("click", () => {
  tbody.innerHTML = "";
  chartSJRI && chartSJRI.destroy();
  chartREHI && chartREHI.destroy();
});
shockEl.addEventListener("input", recomputeAndRender);
redlineEl.addEventListener("change", recomputeAndRender);

// 変更時に再計算
function bindRowEvents() {
  tbody.querySelectorAll("input").forEach(inp => {
    inp.oninput = recomputeAndRender;
  });
  tbody.querySelectorAll("button.del").forEach(btn => {
    btn.onclick = (e) => { e.target.closest("tr").remove(); recomputeAndRender(); };
  });
}

// 初期3行
newRow();
newRow();
newRow();
bindRowEvents();
recomputeAndRender();
