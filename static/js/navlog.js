// static/js/navlog.js
console.log("[NAVLOG] init navlog.js (Separated Total / Fixed Borders)");

(function () {
  const toRad = d => d * Math.PI / 180;
  const norm360 = d => ((d % 360) + 360) % 360;

  function calcDist(a, b) {
    const R = 6371; const rad = x => x * Math.PI / 180;
    const dLat = rad(b[0] - a[0]), dLon = rad(b[1] - a[1]);
    const x = Math.sin(dLat/2)**2 + Math.cos(rad(a[0]))*Math.cos(rad(b[0]))*Math.sin(dLon/2)**2;
    return (2 * Math.atan2(Math.sqrt(x), Math.sqrt(1-x)) * R) / 1.852;
  }
  function calcBear(a, b) {
    const rad = x => x * Math.PI / 180; const deg = x => (x * 180 / Math.PI + 360) % 360;
    const y = Math.sin(rad(b[1]-a[1])) * Math.cos(rad(b[0]));
    const x = Math.cos(rad(a[0]))*Math.sin(rad(b[0])) - Math.sin(rad(a[0]))*Math.cos(rad(b[0]))*Math.cos(rad(b[1]-a[1]));
    return Math.round(deg(Math.atan2(y, x)));
  }
  function calcWindEffects(TC, TAS, wd, ws) {
    const beta = toRad(norm360(wd + 180) - norm360(TC));
    const xwind = ws * Math.sin(beta);
    const hwind = ws * Math.cos(beta);
    const WCA = (Math.asin(Math.max(-1, Math.min(1, xwind/Math.max(1,TAS))))) * 180 / Math.PI;
    const GS = Math.max(1, TAS * Math.cos(toRad(WCA)) + hwind);
    return { WCA, GS };
  }

  // GSI Var
  const GSI_TXT_PATH = "/static/data/000237031.txt";
  let _gsiVarGrid = null;
  async function getVariation(lat, lon) {
    if (!_gsiVarGrid) {
      try {
        const t = await (await fetch(GSI_TXT_PATH)).text();
        const pts = [];
        t.split(/\r?\n/).forEach(l => {
          const m = l.match(/[-+]?\d+(?:\.\d+)?/g);
          if (m && m.length >= 4) pts.push({ lat:+m[0], lon:+m[1], d:+m[2]+(+m[3]||0)/60 });
        });
        if(pts.length<16) throw new Error();
        const lats=[...new Set(pts.map(p=>p.lat))].sort((a,b)=>a-b);
        const lons=[...new Set(pts.map(p=>p.lon))].sort((a,b)=>a-b);
        const map=new Map(); pts.forEach(p=>map.set(`${p.lat},${p.lon}`, p.d));
        _gsiVarGrid={lats,lons,map};
      } catch(e){ return 0; }
    }
    const g=_gsiVarGrid;
    if(!g.lats.length) return 0;
    const clamp = (v,a) => {
      if(v<=a[0]) return 0; if(v>=a[a.length-1]) return a.length-2;
      return Math.max(0, a.findIndex(x=>x>v)-1);
    };
    const i=clamp(lat,g.lats), j=clamp(lon,g.lons);
    const y1=g.lats[i], y2=g.lats[i+1]||y1, x1=g.lons[j], x2=g.lons[j+1]||x1;
    const pick=k=>g.map.get(k)||0;
    const q11=pick(`${y1},${x1}`), q12=pick(`${y1},${x2}`), q21=pick(`${y2},${x1}`), q22=pick(`${y2},${x2}`);
    if(Math.abs(x2-x1)<1e-9) return q11;
    const tx=(lon-x1)/(x2-x1), ty=(lat-y1)/(y2-y1);
    return q11*(1-tx)*(1-ty)+q12*tx*(1-ty)+q21*(1-tx)*ty+q22*tx*ty;
  }

  async function fetchLegWinds(legs, altFt) {
    const uiDir = parseFloat(document.getElementById("windDir")?.value);
    const uiSpd = parseFloat(document.getElementById("windSpd")?.value);
    const fb = { dir: Number.isFinite(uiDir)?uiDir:null, spd: Number.isFinite(uiSpd)?uiSpd:null };
    if (typeof window.fetchGfsWindsRaw !== "function") {
      const o={}; legs.forEach((_,i)=>o[i]=fb); return o;
    }
    try {
      const req = legs.map((l,i) => ({ id:i, lat:l.mid[0], lon:l.mid[1] }));
      const res = await window.fetchGfsWindsRaw(req, altFt);
      const o={};
      legs.forEach((_,i)=>{
        const r=res[i];
        if(r && typeof r.dir==="number") o[i]={dir:r.dir, spd:r.spd};
        else o[i]=fb;
      });
      return o;
    } catch(e) {
      const o={}; legs.forEach((_,i)=>o[i]=fb); return o;
    }
  }

  function td(content, rowSpan=1, colSpan=1, className="") {
    const rs = rowSpan > 1 ? `rowspan="${rowSpan}"` : "";
    const cs = colSpan > 1 ? `colspan="${colSpan}"` : "";
    const isNoBorder = className.includes("no-border");
    const ed = isNoBorder ? `contenteditable="true"` : `contenteditable="true"`;
    const cls = `${className} editable`.trim();
    return `<td class="${cls}" ${rs} ${cs} ${ed}>${content}</td>`;
  }
  function fmtVar(v) {
    if(v===0) return '0°';
    const d = v<0 ? "E" : "W";
    return `${Math.round(Math.abs(v))}°${d}`;
  }

  window.showNavLog = async function(points, TAS) {
    if (points.length < 2) return; 

    const altFt = parseFloat(document.getElementById("alt").value)||3000;
    const devVal = parseFloat(document.getElementById("dev").value)||0;
    const burnPH = parseFloat(document.getElementById("burnPerHour").value)||30;
    const startFuel = parseFloat(document.getElementById("startFuel").value)||100;
    const etdStr = document.getElementById("etd").value || "";
    let minTime = null;
    if(etdStr) {
      const t = etdStr.split(":");
      minTime = +t[0]*60 + (+t[1]);
    }

    const legs = [];
    for(let i=0; i<points.length-1; i++){
      const A = points[i].latlng;
      const B = points[i+1].latlng;
      const mid = [(A[0]+B[0])/2, (A[1]+B[1])/2];
      const V = await getVariation(mid[0], mid[1]);
      legs.push({
        toName: points[i+1].name,
        dist: calcDist(A, B),
        TC: calcBear(A, B),
        VAR: V,
        mid
      });
    }

    const winds = await fetchLegWinds(legs, altFt);

    let totalDist=0, totalTime=0;
    let currentFuel = startFuel;
    let cumDist = 0;
    let cumTime = 0;

    const computed = legs.map((l, i) => {
      const w = winds[i] || {};
      const wd = w.dir, ws = w.spd;
      let WCA=0, GS=TAS;
      if (wd!=null && ws!=null) {
        const ef = calcWindEffects(l.TC, TAS, wd, ws);
        WCA=ef.WCA; GS=ef.GS;
      }
      const TH = norm360(l.TC + WCA);
      const MH = norm360(TH + l.VAR);
      const CH = norm360(MH + devVal);

      const time = (l.dist / GS) * 60;
      const fuel = (burnPH / 60) * time;
      
      totalDist += l.dist;
      totalTime += time;
      currentFuel -= fuel;
      
      cumDist += l.dist;
      cumTime += time;

      let etaStr = "";
      if (minTime !== null) {
        const arrTime = minTime + cumTime; 
        const h = Math.floor(arrTime/60)%24;
        const m = Math.floor(arrTime%60);
        etaStr = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
      }
      
      return { 
        ...l, wd, ws, WCA, TH, MH, CH, GS, DEV:devVal, 
        time, etaStr, currentFuel, cumDist, cumTime 
      };
    });

    const colGroup = `
      <colgroup>
        <col style="width:16%">
        <col style="width:7%">
        <col style="width:5%">
        <col style="width:5%">
        <col style="width:5%">
        <col style="width:5%">
        <col style="width:5%">
        <col style="width:6%">
        <col style="width:6%">
        <col style="width:6%">
        <col style="width:6%">
        <col style="width:8%"> <col style="width:10%"> <col style="width:10%"> </colgroup>
    `;

    let h = `<div class="nav-paper"><div class="nav-content">`;
    h += `<div class="nav-title">NAVIGATION LOG</div>`;
    h += `<table class="nav-table">`;
    h += colGroup;
    
    // Header
    h += `<thead>
      <tr>
        <th rowspan="2">Check Point</th>
        <th>Wind</th>
        <th>TC</th>
        <th>TH</th>
        <th>MH</th>
        <th rowspan="2">CH</th>
        <th rowspan="2">GS</th>
        <th rowspan="2">DIST</th>
        <th rowspan="2">ETE</th>
        <th rowspan="2">ETA</th>
        <th rowspan="2">ATA</th>
        <th rowspan="2" class="border-right-end">FUEL</th>
        <th rowspan="2" class="no-border"></th>
        <th rowspan="2" class="no-border"></th>
      </tr>
      <tr>
        <th class="sub-head">Spd</th>
        <th class="sub-head">WCA</th>
        <th class="sub-head">VAR</th>
        <th class="sub-head">DEV</th>
      </tr>
    </thead><tbody>`;

    // Row 1
    h += `<tr>`;
    h += td(points[0].name, 1, 1, "cell-cp");
    for(let k=0; k<10; k++) h += td("");
    h += td("", 1, 1, "border-right-end");
    h += td("", 1, 1, "no-border");
    h += td("", 1, 1, "no-border");
    h += `</tr>`;

    // Row 2+
    computed.forEach((c) => {
      // Upper
      h += `<tr>`;
      h += td(c.toName, 2, 1, "cell-cp");
      h += td(c.wd!=null?Math.round(c.wd).toString().padStart(3,'0'):"");
      h += td(Math.round(c.TC).toString().padStart(3,'0'));
      h += td(Math.round(c.TH).toString().padStart(3,'0'));
      h += td(Math.round(c.MH).toString().padStart(3,'0'));
      h += td(Math.round(c.CH).toString().padStart(3,'0'), 2);
      h += td(Math.round(c.GS), 2);
      h += td(c.dist.toFixed(0)); 
      h += td(c.time.toFixed(0));
      h += td(c.etaStr, 2);
      h += td("", 2);
      h += td(Math.max(0, c.currentFuel).toFixed(1), 2, 1, "border-right-end");
      h += td("", 2, 1, "no-border");
      h += td("", 2, 1, "no-border");
      h += `</tr>`;

      // Lower
      h += `<tr>`;
      h += td(c.ws!=null?Math.round(c.ws):"");
      h += td(Math.round(c.WCA));
      h += td(fmtVar(c.VAR));
      h += td(c.DEV);
      h += td(c.cumDist.toFixed(0), 1, 1, "sub-val"); 
      h += td(c.cumTime.toFixed(0), 1, 1, "sub-val"); 
      h += `</tr>`;
    });

    h += `</tbody></table>`;

    // --- Separate Total Table (Empty Label) ---
    h += `<table class="total-table">`;
    h += colGroup;
    h += `<tr>
            <td colspan="6" class="no-border"></td>
            <td class="total-label"></td> <td class="total-cell">${totalDist.toFixed(0)}</td>
            <td class="total-cell">${totalTime.toFixed(0)}</td>
            <td colspan="5" class="no-border"></td>
          </tr>`;
    h += `</table>`;

    // Footer
    const flt = totalTime;
    const gnd = 15;
    const rsv = 45;
    const ttl = flt + gnd + rsv;
    const fF = (burnPH/60)*flt;
    const gF = (burnPH/60)*gnd;
    const rF = (burnPH/60)*rsv;
    const tF = fF + gF + rF;

    h += `<div class="nav-footer">
      <div class="param-box">
        <div class="p-row"><strong>TAS:</strong><span contenteditable="true" class="p-val">${TAS}</span> <span class="unit">kt</span></div>
        <div class="p-row"><strong>ALT:</strong><span contenteditable="true" class="p-val">${altFt}</span> <span class="unit">ft</span></div>
        <div class="p-row"><strong>OAT:</strong><span contenteditable="true" class="p-val">--</span> <span class="unit">℃</span></div>
        <div class="p-row"><strong>IAS:</strong><span contenteditable="true" class="p-val">--</span> <span class="unit">kt</span></div>
      </div>
      <table class="fuel-table">
        <tr>
          <th class="ft-head">FUEL</th>
          <th class="ft-head">Total</th>
          <th class="ft-head">Flight</th>
          <th class="ft-head">Ground</th>
          <th class="ft-head">Reserve</th>
        </tr>
        <tr>
          <td class="ft-label">Time</td>
          <td contenteditable="true">${Math.round(ttl)}</td>
          <td contenteditable="true">${Math.round(flt)}</td>
          <td contenteditable="true">${gnd}</td>
          <td contenteditable="true">${rsv}</td>
        </tr>
        <tr>
          <td class="ft-label">Gallon</td>
          <td contenteditable="true">${tF.toFixed(1)}</td>
          <td contenteditable="true">${fF.toFixed(1)}</td>
          <td contenteditable="true">${gF.toFixed(1)}</td>
          <td contenteditable="true">${rF.toFixed(1)}</td>
        </tr>
      </table>
    </div></div>`;

    const resDiv = document.getElementById("results");
    if(resDiv) {
      resDiv.innerHTML = h;
      resDiv.scrollTop = 0;
    }
    setTimeout(window.fitNavPaper, 0);
  };
  
  window.fitNavPaper = function() {
    const paper = document.querySelector(".nav-paper");
    const container = document.getElementById("results");
    if(!paper || !container) return;

    paper.style.transform = "none";
    paper.style.marginBottom = "0";

    const pW = paper.offsetWidth;
    const cW = container.clientWidth - 40; 
    const scale = Math.min(cW / pW, 1.0);
    
    paper.style.transformOrigin = "top center";
    paper.style.transform = `scale(${scale})`;
    
    const h = paper.offsetHeight;
    paper.style.marginBottom = `-${h - h * scale - 20}px`;
  };
  
  window.addEventListener("resize", () => {
    if (window.fitNavPaper) window.fitNavPaper();
  });
})();