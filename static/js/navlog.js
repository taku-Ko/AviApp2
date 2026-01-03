// static/js/navlog.js
console.log("[NAVLOG] init navlog.js");

(function () {
  // ====== 基本補助 ======
  const toRad = (d) => (d * Math.PI) / 180;
  const toDeg = (r) => (r * 180) / Math.PI;
  const norm360 = (d) => ((d % 360) + 360) % 360;

  function calcDistanceNM(a, b) {
    const R = 6371,
      rad = (x) => (x * Math.PI) / 180;
    const dLat = rad(b[0] - a[0]),
      dLon = rad(b[1] - a[1]);
    const lat1 = rad(a[0]),
      lat2 = rad(b[0]);
    const x =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return (2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)) * R) / 1.852;
  }

  function calcBearing(a, b) {
    const rad = (x) => (x * Math.PI) / 180,
      deg = (x) => ((x * 180) / Math.PI + 360) % 360;
    const lat1 = rad(a[0]),
      lat2 = rad(b[0]),
      dLon = rad(b[1] - a[1]);
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x =
      Math.cos(lat1) * Math.sin(lat2) -
      Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    return Math.round(deg(Math.atan2(y, x)));
  }

  function calcWindEffects(TC_deg, TAS, windDirFrom_deg, windSpd) {
    const beta = toRad(norm360(windDirFrom_deg + 180) - norm360(TC_deg));
    const xwind = windSpd * Math.sin(beta);
    const hwind = windSpd * Math.cos(beta);
    const WCA = toDeg(
      Math.asin(Math.max(-1, Math.min(1, xwind / Math.max(1, TAS))))
    );
    const GS = Math.max(1, TAS * Math.cos(toRad(WCA)) + hwind);
    return { WCA, GS };
  }

  // ====== 偏角（GSIグリッド） ======
  const GSI_TXT_PATH = "/static/data/000237031.txt";
  let _gsiVarGrid = null;
  let _gsiSource = "gsi";
  const EPS = 1e-9;

  function buildGridFromPoints(points) {
    const lats = [...new Set(points.map((p) => p.lat))].sort((a, b) => a - b);
    const lons = [...new Set(points.map((p) => p.lon))].sort((a, b) => a - b);
    const map = new Map();
    for (const p of points) map.set(`${p.lat},${p.lon}`, p.d);
    return { lats, lons, map };
  }

  function parseGsiTxtToGrid(text) {
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    const pts = [];
    for (const line of lines) {
      const nums = line.match(/[-+]?\d+(?:\.\d+)?/g);
      if (!nums || nums.length < 4) continue;
      const lat = parseFloat(nums[0]),
        lon = parseFloat(nums[1]),
        deg = parseFloat(nums[2]),
        min = parseFloat(nums[3] || "0");
      if ([lat, lon, deg].some(Number.isNaN)) continue;
      const varWest = deg + min / 60;
      pts.push({ lat, lon, d: varWest });
    }
    if (pts.length < 16) return null;
    return buildGridFromPoints(pts);
  }

  async function loadGsiVarGrid() {
    if (_gsiVarGrid) return _gsiVarGrid;
    try {
      const res = await fetch(GSI_TXT_PATH, { cache: "no-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const grid = parseGsiTxtToGrid(text);
      if (!grid) throw new Error("解析失敗");
      _gsiVarGrid = grid;
      _gsiSource = "gsi";
      return grid;
    } catch (e) {
      console.error("[VAR] GSI 読み込み失敗:", e.message);
      _gsiVarGrid = { lats: [], lons: [], map: new Map() };
      _gsiSource = "error";
      return _gsiVarGrid;
    }
  }

  async function getVariation(lat, lon) {
    const g = await loadGsiVarGrid();
    const { lats, lons, map } = g;
    if (!lats.length || !lons.length) return 0;

    const clamp = (v, a) => {
      if (v <= a[0]) return { lo: 0, hi: Math.min(1, a.length - 1) };
      if (v >= a[a.length - 1])
        return {
          lo: Math.max(a.length - 2, 0),
          hi: a.length - 1,
        };
      const hi = a.findIndex((x) => x > v);
      return { lo: hi - 1, hi };
    };

    const { lo: i, hi: i2 } = clamp(lat, lats);
    const { lo: j, hi: j2 } = clamp(lon, lons);
    const y1 = lats[i],
      y2 = lats[i2],
      x1 = lons[j],
      x2 = lons[j2];

    const pick = (v, fb) =>
      typeof v === "number" && !Number.isNaN(v) ? v : fb;
    const q11 = map.get(`${y1},${x1}`);
    const q12 = map.get(`${y1},${x2}`);
    const q21 = map.get(`${y2},${x1}`);
    const q22 = map.get(`${y2},${x2}`);
    const q11s = pick(q11, pick(q12, pick(q21, q22 ?? 0)));
    const q12s = pick(q12, q11s);
    const q21s = pick(q21, q11s);
    const q22s = pick(q22, q11s);

    if (Math.abs(x2 - x1) < EPS && Math.abs(y2 - y1) < EPS) return q11s;
    if (Math.abs(x2 - x1) < EPS) {
      const ty = (lat - y1) / Math.max(Math.abs(y2 - y1), EPS);
      return q11s * (1 - ty) + q21s * ty;
    }
    if (Math.abs(y2 - y1) < EPS) {
      const tx = (lon - x1) / Math.max(Math.abs(x2 - x1), EPS);
      return q11s * (1 - tx) + q12s * tx;
    }

    const tx = (lon - x1) / (x2 - x1);
    const ty = (lat - y1) / (y2 - y1);
    return (
      q11s * (1 - tx) * (1 - ty) +
      q12s * tx * (1 - ty) +
      q21s * (1 - tx) * ty +
      q22s * tx * ty
    );
  }

  // ====== NAVLOG 表示用セル生成 ======
  function cell(col, row, content, extra = "") {
    return `<div class="cell ${extra}" style="grid-column:${col}; grid-row:${row};">${content}</div>`;
  }
  function cellSpan(col, rowStart, rowSpan, content, extra = "") {
    return `<div class="cell ${extra}" style="grid-column:${col}; grid-row:${rowStart} / span ${rowSpan};">${content}</div>`;
  }
  function fmtVarLabel(v) {
    const dir = v < 0 ? "E" : v > 0 ? "W" : "";
    const cls = v < 0 ? "var-east" : v > 0 ? "var-west" : "var-zero";
    const n = Math.round(Math.abs(v));
    return `<span class="${cls}">${n}°${dir}</span>`;
  }

  // ====== GFS から中心1点だけ風を取得し、全レグに適用 ======
  async function fetchLegWinds(legs, altFt, allPoints) {
    const uiDirEl = document.getElementById("windDir");
    const uiSpdEl = document.getElementById("windSpd");

    // 修正: ?. を使わず安全に値を取得
    const uiDir = uiDirEl ? parseFloat(uiDirEl.value) : NaN;
    const uiSpd = uiSpdEl ? parseFloat(uiSpdEl.value) : NaN;

    // フォールバック：UI に入力された風を全レグに適用
    const fallbackAll = () => {
      console.log("[NAVLOG] using UI winds (fallback)");
      const out = {};
      if (Number.isFinite(uiDir) && Number.isFinite(uiSpd)) {
        legs.forEach((_, i) => {
          out[i] = { dir: uiDir, spd: uiSpd };
        });
      }
      return out;
    };

    if (typeof window.fetchGfsWindAt !== "function") {
      console.warn(
        "[NAVLOG] fetchGfsWindAt not found, using UI wind only"
      );
      return fallbackAll();
    }

    try {
      // 出発地・経由地・目的地を含む全地点から「中心」を計算
      let sumLat = 0;
      let sumLon = 0;
      let count = 0;

      if (Array.isArray(allPoints) && allPoints.length > 0) {
        allPoints.forEach((p) => {
          const ll = p.latlng;
          if (
            Array.isArray(ll) &&
            typeof ll[0] === "number" &&
            typeof ll[1] === "number"
          ) {
            sumLat += ll[0];
            sumLon += ll[1];
            count++;
          }
        });
      }

      if (count === 0 && Array.isArray(legs) && legs.length > 0) {
        legs.forEach((leg) => {
          const m = leg.mid;
          if (
            Array.isArray(m) &&
            typeof m[0] === "number" &&
            typeof m[1] === "number"
          ) {
            sumLat += m[0];
            sumLon += m[1];
            count++;
          }
        });
      }

      if (count === 0) {
        console.warn(
          "[NAVLOG] no valid points for GFS center; using UI wind"
        );
        return fallbackAll();
      }

      const centerLat = sumLat / count;
      const centerLon = sumLon / count;

      console.log(`[NAVLOG] Fetching GFS for center: ${centerLat.toFixed(2)}, ${centerLon.toFixed(2)} alt=${altFt}`);
      
      // ★ここで API をコール
      const gfs = await window.fetchGfsWindAt(
        centerLat,
        centerLon,
        altFt
      );

      const out = {};
      if (gfs && Number.isFinite(gfs.dir) && Number.isFinite(gfs.spd)) {
        console.log(`[NAVLOG] GFS Success: ${gfs.dir}/${gfs.spd}`);
        
        // ★UIに反映
        if (uiDirEl && uiSpdEl) {
          uiDirEl.value = Math.round(gfs.dir);
          uiSpdEl.value = Math.round(gfs.spd);
        }

        legs.forEach((_, i) => {
          out[i] = { dir: gfs.dir, spd: gfs.spd };
        });
        return out;
      }

      return fallbackAll();
    } catch (e) {
      console.warn(
        "[NAVLOG] GFS wind fetch failed, using UI wind only:",
        e
      );
      return fallbackAll();
    }
  }

  // ====== NAVLOG 表示メイン ======
  async function showNavLog(points, TAS) {
    console.log("[NAVLOG] showNavLog called", points.length, TAS);
    
    // UI取得
    const windDirEl = document.getElementById("windDir");
    const windSpdEl = document.getElementById("windSpd");
    
    // 修正: ?. を使わず安全に
    const windDirUI = windDirEl ? parseFloat(windDirEl.value) : NaN;
    const windSpdUI = windSpdEl ? parseFloat(windSpdEl.value) : NaN;

    const devEl = document.getElementById("dev");
    const DEV = parseFloat((devEl ? devEl.value : "0") || "0");

    const burnEl = document.getElementById("burnPerHour");
    const burnPH = Math.max(0, parseFloat((burnEl ? burnEl.value : "0") || "0"));

    const fuelEl = document.getElementById("startFuel");
    let fuelRemain = Math.max(0, parseFloat((fuelEl ? fuelEl.value : "100") || "100"));

    const etdEl = document.getElementById("etd");
    const etdStr = (etdEl ? etdEl.value : "").trim();

    const altEl = document.getElementById("alt");
    const altFt = parseFloat((altEl ? altEl.value : "3000") || "3000");

    let baseMin = null;
    if (/^\d{1,2}:\d{2}$/.test(etdStr)) {
      const [h, m] = etdStr.split(":").map(Number);
      baseMin = h * 60 + m;
    }

    // まずレグの基本情報（距離 / TC / VAR / 中点）を作る
    const legs = [];
    for (let i = 0; i < points.length - 1; i++) {
      const A = points[i].latlng;
      const B = points[i + 1].latlng;
      const dist = calcDistanceNM(A, B);
      const TC = calcBearing(A, B);
      const mid = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];

      let VAR = 0;
      try {
        VAR = await getVariation(mid[0], mid[1]);
      } catch (e) {
        console.warn("[NAVLOG] getVariation failed", e);
        VAR = 0;
      }

      legs.push({
        fromName: points[i].name || points[i].label || `WP${i + 1}`,
        toName:
          points[i + 1].name ||
          points[i + 1].label ||
          `WP${i + 2}`,
        TC,
        VAR,
        dist,
        mid,
      });
    }

    // レグごとの風向風速
    console.log("[NAVLOG] Fetching winds...");
    const legWinds = await fetchLegWinds(legs, altFt, points);
    console.log("[NAVLOG] Winds fetched");

    // 計算
    const computedLegs = [];
    for (let i = 0; i < legs.length; i++) {
      const base = legs[i];
      const wind = legWinds[i] || {};
      
      const wDir =
        Number.isFinite(wind.dir) && Number.isFinite(wind.spd)
          ? wind.dir
          : Number.isFinite(windDirUI) && Number.isFinite(windSpdUI)
          ? windDirUI
          : null;
          
      const wSpd =
        Number.isFinite(wind.dir) && Number.isFinite(wind.spd)
          ? wind.spd
          : Number.isFinite(windDirUI) && Number.isFinite(windSpdUI)
          ? windSpdUI
          : null;

      let WCA = 0,
        GS = TAS;
      if (wDir !== null && wSpd !== null && TAS > 0) {
        const eff = calcWindEffects(base.TC, TAS, wDir, wSpd);
        WCA = eff.WCA;
        GS = Math.max(1, eff.GS);
      }

      const TH = norm360(base.TC + WCA);
      const MH = norm360(TH + base.VAR);
      const CH = norm360(
        MH + (Number.isFinite(DEV) ? DEV : 0)
      );

      computedLegs.push({
        fromName: base.fromName,
        toName: base.toName,
        windDir: wDir,
        windSpd: wSpd,
        TC: base.TC,
        TH,
        MH,
        CH,
        WCA,
        VAR: base.VAR,
        DEV,
        GS,
        dist: base.dist,
      });
    }

    // === 表描画 ===
    let html = "";
    const sourceLabel =
      _gsiSource === "gsi"
        ? "VAR：国土地理院 2020年偏角"
        : "VAR：GSI読込失敗（0°扱い）";
    html += `<div class="source">${sourceLabel}</div>`;
    html += `<div class="navgrid-wrap"><div class="navgrid" id="navgrid">`;

    // ヘッダ
    html += cellSpan(1, 1, 2, "CP", "head left top");
    html += cellSpan(2, 1, 2, "Wind", "head top");
    html += cell(3, 1, "TC", "head top");
    html += cell(4, 1, "TH", "head top");
    html += cell(5, 1, "MH", "head top");
    html += cellSpan(6, 1, 2, "CH", "head top");
    html += cellSpan(7, 1, 2, "GS", "head top");
    html += cellSpan(8, 1, 2, "DIST", "head top");
    html += cellSpan(9, 1, 2, "ETE", "head top");
    html += cellSpan(10, 1, 2, "ATA", "head top");
    html += cellSpan(11, 1, 2, "Fuel", "head top");

    html += cell(3, 2, "WCA", "head sub");
    html += cell(4, 2, "VAR", "head sub");
    html += cell(5, 2, "DEV", "head sub");

    let cumMin = baseMin;
    let cpMergeCarry = false;

    for (let i = 0; i < computedLegs.length; i++) {
      const g = computedLegs[i];
      const eteMin = (g.dist / g.GS) * 60;
      const fuelUsed = (burnPH / 60) * eteMin;

      let ataStr = "";
      if (cumMin !== null) {
        cumMin += eteMin;
        const eh = Math.floor(cumMin / 60) % 24;
        const em = Math.round(cumMin % 60);
        ataStr = `${String(eh).padStart(2, "0")}:${String(
          em
        ).padStart(2, "0")}`;
      }

      const baseRow = 3 + 2 * i;
      const isFirst = i === 0;

      if (!cpMergeCarry) {
        html += cell(
          1,
          baseRow,
          g.fromName,
          "cp left" + (isFirst ? " top" : "")
        );
      } else {
        cpMergeCarry = false;
      }

      if (i < computedLegs.length - 1) {
        html += cellSpan(
          1,
          baseRow + 1,
          2,
          g.toName,
          "cp left cp-merge-line"
        );
        cpMergeCarry = true;
      } else {
        html += cell(1, baseRow + 1, g.toName, "cp left");
      }

      const topCls =
        (isFirst ? " top" : "") + (i > 0 ? " thick-top" : "");

      html += cell(
        2,
        baseRow,
        g.windDir == null
          ? ""
          : String(Math.round(g.windDir)).padStart(3, "0"),
        topCls
      );
      html += cell(
        2,
        baseRow + 1,
        g.windSpd == null ? "" : String(Math.round(g.windSpd)),
        ""
      );

      html += cell(
        3,
        baseRow,
        String(Math.round(g.TC)).padStart(3, "0"),
        topCls
      );
      html += cell(3, baseRow + 1, String(Math.round(g.WCA)), "");
      html += cell(
        4,
        baseRow,
        String(Math.round(g.TH)).padStart(3, "0"),
        topCls
      );
      html += cell(4, baseRow + 1, fmtVarLabel(g.VAR), "");
      html += cell(
        5,
        baseRow,
        String(Math.round(g.MH)).padStart(3, "0"),
        topCls
      );
      html += cell(
        5,
        baseRow + 1,
        String(Math.round(g.DEV)),
        ""
      );

      const spanTopCls =
        (isFirst ? " top" : "") + (i > 0 ? " thick-top" : "");
      html += cellSpan(
        6,
        baseRow,
        2,
        String(Math.round(g.CH)).padStart(3, "0"),
        spanTopCls
      );
      html += cellSpan(
        7,
        baseRow,
        2,
        Math.round(g.GS),
        spanTopCls
      );
      html += cellSpan(
        8,
        baseRow,
        2,
        g.dist.toFixed(0),
        spanTopCls
      );
      html += cellSpan(
        9,
        baseRow,
        2,
        eteMin.toFixed(0),
        spanTopCls
      );
      html += cellSpan(
        10,
        baseRow,
        2,
        ataStr,
        "editable" + spanTopCls
      );

      fuelRemain = Math.max(0, fuelRemain - fuelUsed);
      html += cellSpan(
        11,
        baseRow,
        2,
        fuelRemain.toFixed(1),
        "editable" + spanTopCls
      );
    }

    html += `</div></div>`;
    
    // HTML挿入
    const resultsDiv = document.getElementById("results");
    if(resultsDiv) {
        resultsDiv.innerHTML = html;
        console.log("[NAVLOG] HTML inserted into #results");
    } else {
        console.error("[NAVLOG] #results div not found!");
    }
    
    setTimeout(fitNavGrid, 0);
  }

  // NAVLOG の縮小表示
  function fitNavGrid() {
    const wrap = document.querySelector("#results .navgrid-wrap");
    const grid = document.getElementById("navgrid");
    const container = document.getElementById("results");
    if (!wrap || !grid || !container) return;

    wrap.style.transform = "scale(1)";
    wrap.style.marginBottom = "0";

    const gw = grid.offsetWidth || 1;
    const gh = grid.offsetHeight || 1;

    const availW = container.clientWidth || 1;
    const availH = container.clientHeight || 1;

    const sW = (availW - 2) / gw;
    const sH = (availH - 2) / gh;
    const s = Math.min(sW, sH, 1);

    wrap.style.width = gw + "px";
    wrap.style.height = gh + "px";
    wrap.style.transform = `scale(${s})`;

    const extraH = gh * s - gh;
    if (extraH > 0) wrap.style.marginBottom = `${extraH}px`;
  }
  window.addEventListener("resize", fitNavGrid);

  // グローバル公開
  window.showNavLog = showNavLog;
  window.fitNavGrid = fitNavGrid;
})();
