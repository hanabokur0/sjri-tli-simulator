<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>SJRI + TLI + REHI Simulator</title>
<script src="https://cdn.jsdelivr.net/npm/papaparse@5.4.1/papaparse.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
</head>
<body>
<h2>SJRI + TLI + REHI Simulator</h2>
<p>Upload CSV → simulate rate shocks.</p>

<input id="csv" type="file" accept=".csv" />
<label>Max shock (%)<input id="maxShock" type="number" value="3" step="0.25"></label>
<label>Step (%)<input id="stepShock" type="number" value="0.25" step="0.25"></label>
<button id="run">Run</button>

<h3>Aggregate collapse risk (SJRI/TLI)</h3>
<canvas id="chartAgg" height="160"></canvas>
<button id="dlAggCsv">Download CSV</button>

<h3>REHI by region vs rate shock</h3>
<canvas id="chartRehi" height="160"></canvas>
<button id="dlRehiCsv">Download CSV</button>

<script>
const LOSS_TLI_AMPLIFIER = 0.8;
function range(a,b,step){const out=[];for(let x=a;x<=b+1e-12;x+=step) out.push(+x.toFixed(6));return out}
function clip01(x){return Math.max(0, Math.min(1, x))}
function downloadCSV(filename, rows){
  const header = Object.keys(rows[0]);
  const csv = [header.join(",")].concat(rows.map(r=>header.map(k=>r[k]).join(","))).join("\\n");
  const blob = new Blob([csv], {type:'text/csv'});
  const a = document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=filename; a.click();
}
function computeNoTLI(rows, shocks){
  const agg = new Map(); for(const dy of shocks){ agg.set(dy, {sum:0, w:0}); }
  for(const r of rows){
    const dur=+r.duration_years, jgb=+r.jgb_holdings_jpy, eq=+r.equity_capital_jpy;
    for(const dy of shocks){
      const loss = dur * (dy/100) * jgb;
      const lte = eq>0 ? loss/eq : Infinity;
      let p=0; if(lte>0.30) p = Math.min(1,(lte-0.30)/(1.0-0.30));
      const a = agg.get(dy); a.sum += p*jgb; a.w += jgb;
    }
  }
  return shocks.map(dy=>({rate_shock:dy, collapse: (agg.get(dy).w? agg.get(dy).sum/agg.get(dy).w : 0)}));
}
function computeWithTLI(rows, shocks){
  const agg = new Map(); for(const dy of shocks){ agg.set(dy, {sum:0, w:0}); }
  for(const r of rows){
    const dur=+r.duration_years, jgb=+r.jgb_holdings_jpy, eq=+r.equity_capital_jpy, tli=+r.tli||0;
    for(const dy of shocks){
      const raw = dur*(dy/100)*jgb, loss = raw*(1+LOSS_TLI_AMPLIFIER*tli);
      const lte = eq>0 ? loss/eq : Infinity;
      const stressed = Math.max(0.15, 0.30-0.10*tli), insolvent=Math.max(0.60, 1.00-0.20*tli);
      let p=0; if(lte>stressed) p = lte>=insolvent ? 1 : (lte-stressed)/(insolvent-stressed);
      const a = agg.get(dy); a.sum += p*jgb; a.w += jgb;
    }
  }
  return shocks.map(dy=>({rate_shock:dy, collapse_tli:(agg.get(dy).w? agg.get(dy).sum/agg.get(dy).w : 0)}));
}
function computeREHI(rows, shocks){
  const regionRows=[];
  for(const dy of shocks){
    for(const r of rows){
      const dur=+r.duration_years, jgb=+r.jgb_holdings_jpy, eq=+r.equity_capital_jpy;
      const npl=+r.npl_ratio||0, tli=+r.tli||0, D=+r.diversification_index||0, assets=+r.total_assets_jpy||1;
      const raw = dur*(dy/100)*jgb, loss = raw*(1+LOSS_TLI_AMPLIFIER*tli);
      const lte = eq>0 ? loss/eq : 0;
      const L=clip01(lte), F=clip01(npl), T=clip01(tli), DD=clip01(D);
      const REHI = 100*(0.30*(1-L)+0.30*(1-F)+0.20*(1-T)+0.20*DD);
      regionRows.push({region:r.region, rate_shock:dy, REHI:+REHI.toFixed(2)});
    }
  }
  return regionRows;
}
let chartAgg, chartRehi, lastAgg, lastRehi;
document.getElementById('run').onclick=()=>{
  const file=document.getElementById('csv').files[0];
  if(!file) return alert("CSV required");
  const maxShock=+document.getElementById('maxShock').value, step=+document.getElementById('stepShock').value;
  const shocks=range(0,maxShock,step);
  Papa.parse(file,{header:true,skipEmptyLines:true,complete:(res)=>{
    const rows=res.data;
    const a=computeNoTLI(rows,shocks), b=computeWithTLI(rows,shocks);
    lastAgg = a.map((r,i)=>({rate_shock:r.rate_shock, no_tli:r.collapse, with_tli:b[i].collapse_tli}));
    if(chartAgg) chartAgg.destroy();
    chartAgg=new Chart(document.getElementById('chartAgg'),{
      type:'line',data:{labels:shocks,datasets:[
        {label:'No TLI',data:a.map(r=>r.collapse)},
        {label:'With TLI',data:b.map(r=>r.collapse_tli)}
      ]},
      options:{scales:{y:{min:0,max:1}}}
    });
    lastRehi=computeREHI(rows,shocks);
    if(chartRehi) chartRehi.destroy();
    const byRegion={};
    lastRehi.forEach(r=>{(byRegion[r.region]=byRegion[r.region]||[]).push({x:r.rate_shock,y:r.REHI});});
    chartRehi=new Chart(document.getElementById('chartRehi'),{
      type:'line',
      data:{datasets:Object.keys(byRegion).map(k=>({label:k,data:byRegion[k]}))},
      options:{scales:{y:{min:0,max:100}}}
    });
  }});
};
document.getElementById('dlAggCsv').onclick=()=>{if(lastAgg)downloadCSV('agg.csv',lastAgg);}
document.getElementById('dlRehiCsv').onclick=()=>{if(lastRehi)downloadCSV('rehi.csv',lastRehi);}
</script>
</body>
</html>

