// CSVをパース
function parseCSV(text) {
  const lines = text.trim().split("\n");
  const headers = lines[0].split(",");
  return lines.slice(1).map(line => {
    const values = line.split(",");
    const entry = {};
    headers.forEach((h, i) => entry[h.trim()] = values[i] ? values[i].trim() : "");
    return entry;
  });
}

// SJRI/TLIの簡易計算
function calculateMetrics(data) {
  return data.map(row => {
    const jgb = parseFloat(row["JGB_Ratio"] || 0);
    const cap = parseFloat(row["Capital"] || 0);
    const lag = parseFloat(row["Lag"] || 0);

    const sjri = (jgb / 100) * (cap > 0 ? 1000 / cap : 1) * 100;
    const tli = lag * 10;

    return {
      name: row["Name"] || "Unnamed",
      sjri: Math.round(sjri * 100) / 100,
      tli: Math.round(tli * 100) / 100
    };
  });
}

// グラフ描画
function renderChart(results) {
  const ctx = document.getElementById("sjriChart").getContext("2d");
  if (window.sjriChartInstance) {
    window.sjriChartInstance.destroy();
  }
  window.sjriChartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels: results.map(r => r.name),
      datasets: [
        {
          label: "SJRI",
          data: results.map(r => r.sjri),
          backgroundColor: "rgba(255,99,132,0.6)"
        },
        {
          label: "TLI",
          data: results.map(r => r.tli),
          backgroundColor: "rgba(54,162,235,0.6)"
        }
      ]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: "top" },
        title: {
          display: true,
          text: "SJRI & TLI Simulation"
        }
      }
    }
  });
}

// テーブル表示
function renderTable(results) {
  const container = document.getElementById("result");
  container.innerHTML = `
    <table>
      <tr><th>Name</th><th>SJRI</th><th>TLI</th></tr>
      ${results.map(r => `<tr><td>${r.name}</td><td>${r.sjri}</td><td>${r.tli}</td></tr>`).join("")}
    </table>
  `;
}

// ファイル読み込みイベント
document.getElementById("fileInput").addEventListener("change", function (e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function (event) {
    const text = event.target.result;
    const data = parseCSV(text);
    const results = calculateMetrics(data);
    renderChart(results);
    renderTable(results);
  };
  reader.readAsText(file);
});

