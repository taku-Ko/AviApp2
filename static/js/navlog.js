console.log("[NAVLOG] init navlog.js (Right Margin Restored)");

(function() {
  function toRad(d) { return d * Math.PI / 180; }
  function toDeg(r) { return r * 180 / Math.PI; }

  function calcDist(p1, p2) {
    const R = 3440.065; 
    const dLat = toRad(p2[0] - p1[0]);
    const dLon = toRad(p2[1] - p1[1]);
    const lat1 = toRad(p1[0]);
    const lat2 = toRad(p2[0]);
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  function calcBear(p1, p2) {
    const lat1 = toRad(p1[0]), lat2 = toRad(p2[0]);
    const dLon = toRad(p2[1] - p1[1]);
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1)*Math.sin(lat2) - Math.sin(lat1)*Math.cos(lat2)*Math.cos(dLon);
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  }

  async function getVariation(lat, lon) {
    return -(7 + (lat - 35)*0.5 + (lon - 135)*0.3);
  }

  function solveWind(tc, tas, windDir, windSpd) {
    const rTC = toRad(tc);
    const wa = toRad(windDir - tc);
    const xwind = windSpd * Math.sin(wa);
    const hwind = windSpd * Math.cos(wa);
    
    let wcaRad = Math.asin(xwind / tas);
    let wca = toDeg(wcaRad);
    let gs = tas * Math.cos(wcaRad) - hwind;
    
    return { wca, gs };
  }

  window.generateNavLogHtml = function(legs, startFuel) { return ""; }

  window.showNavLog = async function(points, TAS) {
    if (points.length < 2) return; 

    // 入力取得
    const tasInput = parseFloat(document.getElementById("tas").value);
    const altInput = parseFloat(document.getElementById("alt").value);
    const oatInput = parseFloat(document.getElementById("oat")?.value);
    const iasInput = parseFloat(document.getElementById("ias")?.value);
    const altFt = Number.isFinite(altInput) ? altInput : 3000;
    
    const devVal = parseFloat(document.getElementById("dev").value)||0;
    const burnPH = parseFloat(document.getElementById("burnPerHour").value)||30;
    const startFuelInput = parseFloat(document.getElementById("startFuel").value)||100;
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

    // 風取得
    const windPoints = legs.map((l, i) => ({ id: i, lat: l.mid[0], lon: l.mid[1] }));
    let winds = {};
    try {
      const resp = await fetch("/api/gfs_wind", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alt_ft: altFt, points: windPoints })
      });
      if(resp.ok) {
        const json = await resp.json();
        (json.points || []).forEach(p => {
          winds[p.id] = { dir: p.wind_dir, spd: p.wind_spd };
        });
      }
    } catch(e) { console.error(e); }

    let computed = [];
    let totalDist = 0;
    let totalTime = 0;
    let currentFuel = startFuelInput;
    let currentTime = minTime;

    legs.forEach((l, i) => {
      const w = winds[i] || { dir: 0, spd: 0 };
      const tasVal = Number.isFinite(tasInput) ? tasInput : TAS;
      const sol = solveWind(l.TC, tasVal, w.dir, w.spd);
      
      const WCA = sol.wca;
      const TH = l.TC + WCA;
      const MH = TH + l.VAR;
      const CH = MH + devVal;
      const GS = sol.gs;
      
      const t_h = l.dist / GS;
      const t_min = t_h * 60;
      
      totalDist += l.dist;
      totalTime += t_min;
      
      const fuelBurn = t_h * burnPH;
      currentFuel -= fuelBurn;
      
      let etaStr = "";
      if(currentTime != null) {
        currentTime += t_min;
        let hh = Math.floor(currentTime / 60) % 24;
        let mm = Math.floor(currentTime % 60);
        etaStr = `${hh.toString().padStart(2,'0')}:${mm.toString().padStart(2,'0')}`;
      }

      computed.push({
        toName: l.toName, dist: l.dist, time: t_min,
        TC: l.TC, VAR: l.VAR, TH: TH, MH: MH, DEV: devVal, CH: CH, GS: GS, WCA: WCA,
        ws: w.spd, wd: w.dir, etaStr: etaStr, currentFuel: currentFuel,
        cumDist: totalDist, cumTime: totalTime
      });
    });

    function td(content, rowSpan=1, colSpan=1, className="") {
      const rs = rowSpan > 1 ? `rowspan="${rowSpan}"` : "";
      const cs = colSpan > 1 ? `colspan="${colSpan}"` : "";
      const ed = `contenteditable="true"`;
      const cls = `${className} editable`.trim();
      return `<td class="${cls}" ${rs} ${cs} ${ed}>${content}</td>`;
    }
    function fmtVar(v) {
      if(v===0) return '0°';
      const d = v<0 ? "W" : "E";
      return `${Math.round(Math.abs(v))}°${d}`;
    }

    // ★修正箇所: 右端の余白(8% + 8% = 16%)を確保するため、他の列幅を調整
    const colGroup = `
      <col style="width:13%"> <col style="width:6%"> <col style="width:6%"> <col style="width:6%"> <col style="width:6%"> <col style="width:6%"> <col style="width:6%"> <col style="width:7%"> <col style="width:7%"> <col style="width:7%"> <col style="width:7%"> <col style="width:7%"> <col style="width:8%"> <col style="width:8%"> `;

    let h = `
    <div class="nav-paper"><div class="nav-content">
      <div class="nav-title">NAVIGATION LOG</div>
      <table class="nav-table">
      ${colGroup}
      <thead>
        <tr>
          <th rowspan="2" class="border-right-end">CHECK POINT</th>
          <th>WIND</th>
          <th>TC</th>
          <th>TH</th>
          <th>MH</th>
          <th rowspan="2">CH</th>
          <th rowspan="2">GS</th>
          <th>DIST</th>
          <th>ETE</th>
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
          <th class="sub-head">Rem</th>
          <th class="sub-head">Rem</th>
        </tr>
      </thead><tbody>`;

    h += `<tr>`;
    h += td(points[0].name, 1, 1, "cell-cp");
    for(let k=0; k<10; k++) h += td("");
    h += td("", 1, 1, "border-right-end");
    h += td("", 1, 1, "no-border");
    h += td("", 1, 1, "no-border");
    h += `</tr>`;

    computed.forEach((c, index) => {
      const isLast = index === computed.length - 1;
      const bottomClass = isLast ? "bottom-thick" : "";

      h += `<tr>`;
      h += td(c.toName, 2, 1, `cell-cp ${bottomClass}`.trim());
      h += td(c.wd!=null?Math.round(c.wd).toString().padStart(3,'0'):"");
      h += td(Math.round(c.TC).toString().padStart(3,'0'));
      h += td(Math.round(c.TH).toString().padStart(3,'0'));
      h += td(Math.round(c.MH).toString().padStart(3,'0'));
      h += td(Math.round(c.CH).toString().padStart(3,'0'), 2, 1, bottomClass);
      h += td(Math.round(c.GS), 2, 1, bottomClass);
      h += td(c.dist.toFixed(0));
      h += td(c.time.toFixed(0));
      h += td(c.etaStr, 2, 1, bottomClass);
      h += td("", 2, 1, bottomClass);
      h += td(Math.max(0, c.currentFuel).toFixed(1), 2, 1, `border-right-end ${bottomClass}`.trim());
      h += td("", 2, 1, "no-border");
      h += td("", 2, 1, "no-border");
      h += `</tr>`;

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
    const gnd = 10;
    const totalFuel = startFuelInput;
    const totalTimeByFuel = burnPH > 0 ? (totalFuel / burnPH) * 60 : 0;
    const rsv = Math.max(0, totalTimeByFuel - flt - gnd);
    const ttl = Math.max(0, totalTimeByFuel);
    
    const fF = (burnPH/60)*flt;
    const gF = (burnPH/60)*gnd;
    const rF = Math.max(0, totalFuel - fF - gF);
    const tF = totalFuel;

    h += `<div class="nav-footer">
      <div class="footer-stack">
        <div class="param-box">
          <div class="p-row"><strong>TAS:</strong><span contenteditable="true" class="p-val">${Number.isFinite(tasInput) ? tasInput : TAS}</span> <span class="unit">kt</span></div>
          <div class="p-row"><strong>ALT:</strong><span contenteditable="true" class="p-val">${altFt}</span> <span class="unit">ft</span></div>
          <div class="p-row"><strong>OAT:</strong><span contenteditable="true" class="p-val">${Number.isFinite(oatInput) ? oatInput : "--"}</span> <span class="unit">℃</span></div>
          <div class="p-row"><strong>IAS:</strong><span contenteditable="true" class="p-val">${Number.isFinite(iasInput) ? iasInput : "--"}</span> <span class="unit">kt</span></div>
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
            <td contenteditable="true">${Math.round(rsv)}</td>
          </tr>
          <tr>
            <td class="ft-label">Gallon</td>
            <td contenteditable="true">${tF.toFixed(1)}</td>
            <td contenteditable="true">${fF.toFixed(1)}</td>
            <td contenteditable="true">${gF.toFixed(1)}</td>
            <td contenteditable="true">${rF.toFixed(1)}</td>
          </tr>
        </table>
      </div></div>
    </div>`;

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