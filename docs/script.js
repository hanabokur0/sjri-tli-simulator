// ---- Core parameters ----
const LOSS_TLI_AMPLIFIER = 0.8;

// ---- State ----
let rows = [];              // normalized institutions
let shocks = [];            // grid for charts
let aggNoTLI = [], aggTLI = []; // for aggregate chart
let rehiSeries = [];        // for region chart
let chartAgg = null, chartRehi = null;

// ---- Utils ----
const range = (a,b,step)=>{const out=[];for(let x=a;x<=b+1e-12;x+=step){out.push(+x.toFixed(6))}return out}
const clip01 = x => Math.max(0, Math.min(1, x));
const round2 = x => Math.round(x*100)/100;

function parseCSV(text){
  const lines = text.trim().split(/\r?\n/);
  const head = lines[0].split(",").map(s=>s.trim());
  const body = lines.slice(1).map(line=>{
    const v = line.split(",");
    const o={}; head.forEach((h,i)=>o[h]=(v[i]??"").trim());
    return o;
  });
  return {head, body};
}

function normalize(raw){
  // accept both canonical and loose keys
  const pick = (r, ...cands) => {
    for (const k of cands) if (r[k] !== undefined && r[k] !== "") return r[k];
    return "";
  };
  return raw.map(r=>({
    name: pick(r,"name","Name"),
    region: pick(r,"region","Region"),
    total_assets_jpy: +pick(r,"total_assets_jpy","Total_Assets_JPY","totalAssets","Assets"),
    equity_capital_jpy: +pick(r,"equity_capital_jpy","Equity_Capital_JPY","equity"),
    jgb_holdings_jpy: +pick(r,"jgb_holdings_jpy","JGB_Holdings_JPY","jgb"),
    duration_years: +pick(r,"duration_years","Duration_Years","duration"),
    npl_ratio: +pick(r,"npl_ratio","NPL_Ratio","npl"),
    tli: +pick(r,"tli","TLI"),
    diversification_index: +pick(r,"diversification_index","Diversification_Index","diversification")
  })).filter(r=>r.name && r.equity_capital_jpy>0 && r.jgb_holdings_jpy>=0);
}

// ---- Metrics ----
function computeNoTLI(rows, shocks){
  const agg = new Map(); for(const s of shocks) agg.set(s,{sum:0,w:0});
  for(const r of rows){
    for(const s of shocks){
      const loss = r.duration_years * (s/100) * r.jgb_holdings_jpy;
      const lte  = r.equity_capital_jpy>0 ? loss/r.equity_capital_jpy : Infinity;
      const p = lte<=0.30 ? 0 : (lte>=1.00 ? 1 : (lte-0.30)/(1.00-0.30));
      const a = agg.get(s); a.sum += p*r.jgb_holdings_jpy; a.w += r.jgb_holdings_jpy;
    }
  }
  return shocks.map(s=>({rate_shock:s, weighted_collapse:(agg.get(s).w? agg.get(s).sum/agg.get(s).w:0)}));
}

function computeWithTLI(rows, shocks){
  const agg = new Map(); for(const s of shocks) agg.set(s,{sum:0,w:0});
  for(const r of rows){
    for(const s of shocks){
      const raw = r.duration_years * (s/100) * r.jgb_holdings_jpy;
      const loss = raw * (1 + LOSS_TLI_AMPLIFIER*(r.tli||0));
      const lte  = r.equity_capital_jpy>0 ? loss/r.equity_capital_jpy : Infinity;
      const stressed = Math.max(0.15, 0.30 - 0.10*(r.tli||0));
      const insolvent= Math.max(0.60, 1.00 - 0.20*(r.tli||0));
      let p=0; if(lte>stressed) p = lte>=insolvent ? 1 : (lte-stressed)/(insolvent-stressed);
      const a = agg.get(s); a.sum += p*r.jgb_holdings_jpy; a.w += r.jgb_holdings_jpy;
    }
  }
  return shocks.map(s=>({rate_shock:s, weighted_collapse_tli:(agg.get(s).w? agg.get(s).sum/agg.get(s).w:0)}));
}

function instSJRI(row, shockPct){
  const s = shockPct/100;
  const raw = row.duration_years * s * row.jgb_holdings_jpy;
  const loss = raw * (1 + LOSS_TLI_AMPLIFIER*(row.tli||0));
  const lte  = row.equity_capital_jpy>0 ? loss/row.equity_capital_jpy : Infinity;
  const stressed = Math.max(0.15, 0.30 - 0.10*(row.tli||0));
  const insolvent= Math.max(0.60, 1.00 - 0.20*(row.tli||0));
  if (lte<=stressed) return 0;
  if (lte>=insolvent) return 1;
  return (lte-stressed)/(insolvent-stressed);
}

function instREHI(row, shockPct){
  const s = shockPct/100;
  const raw = row.duration_years * s * row.jgb_holdings_jpy;
  const loss = raw * (1 + LOSS_TLI_AMPLIFIER*(row.tli||0));
  const lte  = row.equity_capital_jpy>0 ? loss/row.equity_capital_jpy : 0;
  const L=clip01(lte), F=clip01(row.npl_ratio||0), T=clip01(row.tli||0), D=clip01(row.diversification_index||0);
  return 100*(0.30*(1-L) + 0.30*(1-F) + 0.20*(1-T) + 0.20*D);
}

function computeREHIseries(rows, shocks){
  const byRegion = new Map(); // region -> s -> {sum,w}
  for(const s of shocks){
    for(const r of rows){
      const rehi = instREHI(r, s);
      const m = byRegion.get(r.region) || new Map();
      const g = m.get(s) || {sum:0,w:0};
      g.sum += rehi*(r.total_assets_jpy||1); g.w += (r.total_assets_jpy||1);
      m.set(s,g); byRegion.set(r.region,m);
    }
  }
  const series=[];
  for(const [region,m] of byRegion){
    const arr=[...m.keys()].sort((a,b)=>a-b).map(k=>({x:k,y:m.get(k).sum/m.get(k).w}));
    series.push({label:region, data:arr});
  }
  return series;
}

// ---- Rendering ----
function drawAgg(){
  const ctx = document.getElementById("chartAgg").getContext("2d");
  if(chartAgg) chartAgg.destroy();
  chartAgg = new Chart(ctx,{
    type:"line",
    data:{labels: shocks, datasets:[
      {label:"No TLI", data: aggNoTLI.map(r=>r.weighted_collapse)},
      {label:"With TLI", data: aggTLI.map(r=>r.weighted_collapse_tli)}
    ]},
    options:{responsive:true, maintainAspectRatio:false,
      scales:{y:{min:0,max:1,title:{display:true,text:"Weighted collapse risk"}},
              x:{title:{display:true,text:"Rate shock (%)"}}}}
  });
}

function drawREHI(){
  const ctx = document.getElementById("chartRehi").getContext("2d");
  if(chartRehi) chartRehi.destroy();
  chartRehi = new Chart(ctx,{
    type:"line",
    data:{datasets: rehiSeries},
    options:{parsing:false,responsive:true,maintainAspectRatio:false,
      scales:{y:{min:0,max:100,title:{display:true,text:"REHI (0–100)"}},
              x:{type:"linear",title:{display:true,text:"Rate shock (%)"}}}}
  });
}

function fillBankSelector(){
  const sel = document.getElementById("bankSel");
  sel.innerHTML = rows.map(r=>`<option value="${r.name}">${r.name}</option>`).join("");
  sel.onchange = updateKPIsAndTable;
}

function updateKPIsAndTable(){
  const shock = +document.getElementById("shockSel").value;
  document.getElementById("shockVal").textContent = shock.toFixed(2) + "%";
  const red = +document.getElementById("redline").value;

  // KPIs for selected
  const name = document.getElementById("bankSel").value;
  const row = rows.find(r=>r.name===name) || rows[0];
  const sjri = row ? instSJRI(row, shock) : 0;
  const rehi = row ? instREHI(row, shock) : 0;
  document.getElementById("kpiSjri").textContent = sjri.toFixed(3);
  document.getElementById("kpiRehi").textContent = rehi.toFixed(1);
  document.getElementById("warn").style.display = (sjri >= red) ? "block" : "none";

  // table for all
  const tbody = document.querySelector("#tbl tbody");
  const arr = rows.map(r=>({
    name:r.name, region:r.region,
    sjri: instSJRI(r, shock),
    rehi: instREHI(r, shock)
  })).sort((a,b)=>b.sjri-a.sjri);

  tbody.innerHTML = arr.map(x=>{
    const danger = x.sjri >= red ? ' style="background:#3a1120"' : "";
    return `<tr${danger}><td>${escapeHtml(x.name)}</td><td>${escapeHtml(x.region)}</td><td>${x.sjri.toFixed(3)}</td><td>${x.rehi.toFixed(1)}</td></tr>`;
  }).join("");
}

function escapeHtml(s){return (s||"").replace(/[&<>"']/g,m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]))}

// ---- Wire-up ----
document.getElementById("shockSel").addEventListener("input", updateKPIsAndTable);
document.getElementById("redline").addEventListener("change", updateKPIsAndTable);
document.getElementById("btnReset").addEventListener("click", ()=>{
  document.getElementById("fileInput").value="";
  rows=[]; aggNoTLI=[]; aggTLI=[]; rehiSeries=[];
  if(chartAgg) chartAgg.destroy(); if(chartRehi) chartRehi.destroy();
  document.querySelector("#tbl tbody").innerHTML="";
  document.getElementById("bankSel").innerHTML="";
  document.getElementById("kpiSjri").textContent="-";
  document.getElementById("kpiRehi").textContent="-";
  document.getElementById("warn").style.display="none";
});

document.getElementById("useSample").addEventListener("click", ()=>{
  const sample=`name,region,total_assets_jpy,equity_capital_jpy,jgb_holdings_jpy,duration_years,npl_ratio,tli,diversification_index
Shinkin A,Tokyo,1200000000000,50000000000,350000000000,6,0.02,0.5,0.65
Shinkin B,Osaka,800000000000,32000000000,200000000000,5,0.03,0.4,0.55
Shinkin C,Aichi,650000000000,25000000000,120000000000,8,0.015,0.6,0.6`;
  bootstrapFromCSV(sample);
});

document.getElementById("fileInput").addEventListener("change", e=>{
  const f = e.target.files[0]; if(!f) return;
  const r = new FileReader();
  r.onload = ev => bootstrapFromCSV(ev.target.result);
  r.readAsText(f);
});

function bootstrapFromCSV(text){
  const {body} = parseCSV(text);
  rows = normalize(body);
  if(!rows.length){ alert("No valid rows"); return; }

  // shock grid for charts
  shocks = range(0, 3.0, 0.25);
  aggNoTLI = computeNoTLI(rows, shocks);
  aggTLI   = computeWithTLI(rows, shocks);
  rehiSeries = computeREHIseries(rows, shocks);

  drawAgg();
  drawREHI();
  fillBankSelector();
  updateKPIsAndTable();
}
