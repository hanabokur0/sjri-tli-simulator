// ---- 人が迷わないための最小ロジック ----
const LOSS_TLI_AMPLIFIER = 0.8;
let chartAgg=null, chartRehi=null;
let headers=[], rowsRaw=[], mapping=null;

const REQUIRED_FIELDS = [
  ["name","名称"],["region","地域"],
  ["total_assets_jpy","総資産(円)"],["equity_capital_jpy","自己資本(円)"],
  ["jgb_holdings_jpy","JGB保有(円)"],["duration_years","デュレーション(年)"],
  ["npl_ratio","不良債権比率(0-1)"],["tli","TLI(0-1)"],["diversification_index","分散度(0-1)"]
];

// サンプル（人がすぐ試せる）
const sampleCSV = `name,region,total_assets_jpy,equity_capital_jpy,jgb_holdings_jpy,duration_years,npl_ratio,tli,diversification_index
Shinkin A,Tokyo,1200000000000,50000000000,350000000000,6,0.02,0.5,0.65
Shinkin B,Osaka,800000000000,32000000000,200000000000,5,0.03,0.4,0.55
Shinkin C,Aichi,650000000000,25000000000,120000000000,8,0.015,0.6,0.6`;

function parseCSV(text){
  const lines = text.trim().split(/\r?\n/);
  const head = lines[0].split(",").map(s=>s.trim());
  const data = lines.slice(1).map(line=>{
    const v = line.split(",");
    const o = {}; head.forEach((h,i)=>o[h]= (v[i]??"").trim());
    return o;
  });
  return {head, data};
}

function buildMapper(head){
  headers = head;
  const box = document.getElementById("mapper");
  box.innerHTML = "";
  REQUIRED_FIELDS.forEach(([key,label])=>{
    const div = document.createElement("div");
    div.className="maprow";
    div.innerHTML = `
      <span class="maplabel">${label}</span>
      <select data-key="${key}">
        <option value="">未選択</option>
        ${headers.map(h=>`<option value="${h}">${h}</option>`).join("")}
      </select>`;
    box.appendChild(div);
  });
  document.getElementById("mapBox").style.display = "block";
  setMsg("列を対応付けたら「③ 実行」が有効になります。");
  updateRunButton();
  box.querySelectorAll("select").forEach(s=>s.addEventListener("change", updateRunButton));
}

function updateRunButton(){
  const selects = [...document.querySelectorAll("#mapper select")];
  const ok = selects.every(s=>s.value);
  document.getElementById("btnRun").disabled = !ok;
}

function readFile(file){
  const reader = new FileReader();
  reader.onload = ev=>{
    const {head,data} = parseCSV(ev.target.result);
    rowsRaw = data;
    buildMapper(head);
  };
  reader.readAsText(file);
}

document.getElementById("fileInput").addEventListener("change", e=>{
  const f = e.target.files[0]; if(!f) return;
  readFile(f);
});

document.getElementById("useSample").addEventListener("click", ()=>{
  const {head,data} = parseCSV(sampleCSV);
  rowsRaw = data;
  buildMapper(head);
  // サンプルは自動マッピング
  REQUIRED_FIELDS.forEach(([key])=>{
    const sel = document.querySelector(`#mapper select[data-key="${key}"]`);
    if(sel && headers.includes(key)) sel.value = key;
  });
  updateRunButton();
});

document.getElementById("btnReset").addEventListener("click", ()=>{
  document.getElementById("fileInput").value="";
  rowsRaw=[]; headers=[]; mapping=null;
  document.getElementById("mapBox").style.display="none";
  if(chartAgg) chartAgg.destroy(); if(chartRehi) chartRehi.destroy();
  document.getElementById("summary").innerHTML="";
  setMsg("");
  document.getElementById("btnRun").disabled=true;
});

document.getElementById("btnRun").addEventListener("click", ()=>{
  mapping = getMapping();
  if(!mapping) { setMsg("未選択の列があります。"); return; }
  const maxShock = +document.getElementById("maxShock").value || 3;
  const step = +document.getElementById("stepShock").value || 0.25;

  const rows = rowsRaw.map(r=>({
    name: r[mapping.name],
    region: r[mapping.region],
    total_assets_jpy: +r[mapping.total_assets_jpy],
    equity_capital_jpy: +r[mapping.equity_capital_jpy],
    jgb_holdings_jpy: +r[mapping.jgb_holdings_jpy],
    duration_years: +r[mapping.duration_years],
    npl_ratio: +r[mapping.npl_ratio],
    tli: +r[mapping.tli],
    diversification_index: +r[mapping.diversification_index]
  }));

  const shocks = range(0, maxShock, step);
  const noTLI = computeNoTLI(rows, shocks);
  const withTLI = computeWithTLI(rows, shocks);
  const rehiSeries = computeREHI(rows, shocks);

  drawAgg(noTLI, withTLI, shocks);
  drawREHI(rehiSeries);
  summarize(rows, shocks, withTLI);
  setMsg("完了。結果を確認してください。");
});

function getMapping(){
  const m = {};
  document.querySelectorAll("#mapper select").forEach(s=>{
    m[s.dataset.key] = s.value;
  });
  return Object.values(m).every(v=>v) ? m : null;
}

// ------- 指標の計算 -------
function range(a,b,step){const out=[];for(let x=a;x<=b+1e-12;x+=step) out.push(+x.toFixed(6));return out}
function clip01(x){return Math.max(0, Math.min(1, x))}

function computeNoTLI(rows, shocks){
  const agg = new Map(); for(const dy of shocks){ agg.set(dy, {sum:0,w:0}); }
  for(const r of rows){
    const dur=r.duration_years, jgb=r.jgb_holdings_jpy, eq=r.equity_capital_jpy;
    for(const dy of shocks){
      const loss = dur*(dy/100)*jgb;
      const lte = eq>0 ? loss/eq : Infinity;
      const stressed=0.30, insolvent=1.00;
      let p=0; if(lte>stressed) p = Math.min(1,(lte-stressed)/(insolvent-stressed));
      const a = agg.get(dy); a.sum += p*jgb; a.w += jgb;
    }
  }
  return shocks.map(dy=>({rate_shock:dy, weighted_collapse:(agg.get(dy).w? agg.get(dy).sum/agg.get(dy).w:0)}));
}

function computeWithTLI(rows, shocks){
  const agg = new Map(); for(const dy of shocks){ agg.set(dy, {sum:0,w:0}); }
  for(const r of rows){
    const dur=r.duration_years, jgb=r.jgb_holdings_jpy, eq=r.equity_capital_jpy, tli=r.tli||0;
    for(const dy of shocks){
      const raw = dur*(dy/100)*jgb, loss = raw*(1+LOSS_TLI_AMPLIFIER*tli);
      const lte = eq>0 ? loss/eq : Infinity;
      const stressed = Math.max(0.15, 0.30 - 0.10*tli);
      const insolvent= Math.max(0.60, 1.00 - 0.20*tli);
      let p=0; if(lte>stressed) p = lte>=insolvent ? 1 : (lte-stressed)/(insolvent-stressed);
      const a = agg.get(dy); a.sum += p*jgb; a.w += jgb;
    }
  }
  return shocks.map(dy=>({rate_shock:dy, weighted_collapse_tli:(agg.get(dy).w? agg.get(dy).sum/agg.get(dy).w:0)}));
}

function computeREHI(rows, shocks){
  const byRegion = new Map(); // region -> {shock -> {sum,w}}
  for(const dy of shocks){
    for(const r of rows){
      const dur=r.duration_years, jgb=r.jgb_holdings_jpy, eq=r.equity_capital_jpy;
      const npl=r.npl_ratio||0, tli=r.tli||0, D=r.diversification_index||0, assets=r.total_assets_jpy||1;
      const raw = dur*(dy/100)*jgb, loss = raw*(1+LOSS_TLI_AMPLIFIER*tli);
      const lte = eq>0 ? loss/eq : 0;
      const L=clip01(lte), F=clip01(npl), T=clip01(tli), DD=clip01(D);
      const REHI = 100*(0.30*(1-L)+0.30*(1-F)+0.20*(1-T)+0.20*DD);
      const region = (r.region||"Unknown").trim();
      if(!byRegion.has(region)) byRegion.set(region, new Map());
      const m = byRegion.get(region);
      const g = m.get(dy) || {sum:0,w:0};
      g.sum += REHI*assets; g.w += assets; m.set(dy,g);
    }
  }
  const series=[];
  for(const [region, m] of byRegion){
    const arr = [...m.keys()].sort((a,b)=>a-b).map(k=>({x:k, y:m.get(k).sum/m.get(k).w}));
    series.push({label:region, data:arr});
  }
  return series;
}

// ------- 描画と要約 -------
function drawAgg(noTLI, withTLI, shocks){
  const ctx = document.getElementById("chartAgg").getContext("2d");
  if(chartAgg) chartAgg.destroy();
  chartAgg = new Chart(ctx,{
    type:"line",
    data:{labels:shocks, datasets:[
      {label:"No TLI", data:noTLI.map(r=>r.weighted_collapse)},
      {label:"With TLI", data:withTLI.map(r=>r.weighted_collapse_tli)}
    ]},
    options:{responsive:true, maintainAspectRatio:false,
      scales:{y:{min:0,max:1,title:{display:true,text:"Weighted collapse risk"}},x:{title:{display:true,text:"Rate shock (%)"}}}}
  });
}

function drawREHI(series){
  const ctx = document.getElementById("chartRehi").getContext("2d");
  if(chartRehi) chartRehi.destroy();
  chartRehi = new Chart(ctx,{
    type:"line",
    data:{datasets:series},
    options:{parsing:false,responsive:true,maintainAspectRatio:false,
      scales:{y:{min:0,max:100,title:{display:true,text:"REHI (0–100)"}},
              x:{type:"linear",title:{display:true,text:"Rate shock (%)"}}}}
  });
}

function summarize(rows, shocks, withTLI){
  const inst = rows.length;
  const regions = new Set(rows.map(r=>r.region)).size;
  const one = withTLI.find(r=>Math.abs(r.rate_shock-1.0)<1e-9) || withTLI[Math.min(4,withTLI.length-1)];
  const s = document.getElementById("summary");
  s.innerHTML = `機関: <b>${inst}</b>、地域: <b>${regions}</b>。+1%ショック時の加重崩壊リスク（TLI考慮）: <b>${one ? one.weighted_collapse_tli.toFixed(3) : "-"}</b>`;
}

function setMsg(text){ document.getElementById("msg").textContent = text; }
