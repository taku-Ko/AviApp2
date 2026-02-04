console.log("[MAP] init map-core.js (RainViewer Fix + WindLog)");

(function () {
  // 1. 地図初期化
  const map = L.map("map", { zoomControl: false }).setView([36.0, 140.0], 7);
  
  // camera-layer.js 等から参照できるように公開
  window.navMap = map;

  // 2. ベースレイヤー
  const baseLayers = {
    "標準地図": L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png", { attribution: "GSI Tiles", maxZoom: 18, zIndex: 0 }),
    "色別標高図": L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/relief/{z}/{x}/{y}.png", { attribution: "GSI Tiles", maxZoom: 18, zIndex: 0 }),
    "航空写真": L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg", { attribution: "GSI Tiles", maxZoom: 18, zIndex: 0 }),
    "OpenStreetMap": L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "&copy; OpenStreetMap" })
  };
  baseLayers["標準地図"].addTo(map);

  // 3. レイヤーコントロール
  const layersCtrl = L.control.layers(baseLayers, {}, { position: "topright", collapsed: false }).addTo(map);
  window.navLayersControl = layersCtrl;

  L.control.zoom({ position: "bottomright" }).addTo(map);
  L.control.scale({ position: "bottomleft", metric: true, imperial: false }).addTo(map);

  const PATH_ASP = "/static/data/jp_asp.geojson";
  const PATH_APT = "/static/data/jp_apt.geojson";
  const PATH_NAV = "/static/data/jp_nav.geojson";
  const PATH_HELI = "/static/data/jp_heliport.geojson";

  const styleAirspace = { color: "#555", weight: 1, fillOpacity: 0.1, dashArray: "4 4" };
  const styleAirport = { color: "#1565c0", weight: 1.2, fillOpacity: 0.8, fillColor: "#888" };
  const styleNavAid = { color: "#455a64", weight: 1, fillOpacity: 0 };
  const FLIGHT_COLORS = { "VFR": "#2e7d32", "MVFR": "#1565c0", "IFR": "#c62828", "LIFR": "#ad1457", "UNKNOWN": "#757575" };

  async function addGeoJsonOverlay(url, opts, name) {
    try {
      const r = await fetch(url);
      if (!r.ok) return null;
      const data = await r.json();
      const layer = L.geoJSON(data, opts);
      layer.addTo(map);
      if(name) layersCtrl.addOverlay(layer, name);
      return layer;
    } catch (e) { return null; }
  }

  // ★Codex版 RainViewer実装 (tilecacheドメイン使用)
  async function setupRainViewerLayer() {
    // 重要: tile.cache ではなく tilecache を使用
    const buildRadarUrl = (frameTime) =>
      `https://tilecache.rainviewer.com/v2/radar/${frameTime}/256/{z}/{x}/{y}/2/1_1.png`;

    const fetchLatestFrame = async () => {
      try {
        const response = await fetch("https://api.rainviewer.com/public/weather-maps.json");
        if (!response.ok) return null;
        const data = await response.json();
        
        // 過去データ(past) または 予報(nowcast) の最新を取得
        const radar = (data && data.radar) || {};
        const frames = (radar.nowcast && radar.nowcast.length > 0) ? radar.nowcast : radar.past || [];
        
        if (!frames.length) return null;
        
        const latest = frames[frames.length - 1];
        return latest.time || latest || null;
      } catch (e) {
        console.warn("[MAP] RainViewer fetch error:", e);
        return null;
      }
    };

    try {
      let currentTime = await fetchLatestFrame();
      if (!currentTime) return;

      const radarLayer = L.tileLayer(buildRadarUrl(currentTime), {
        opacity: 0.6,
        maxZoom: 18,
        attribution: "RainViewer",
      });
      
      // デフォルトでON
      radarLayer.addTo(map);
      layersCtrl.addOverlay(radarLayer, "雨雲レーダー (RainViewer)");
      window.rainviewerLayer = radarLayer;

      // 5分ごとに更新
      const refresh = async () => {
        const nextTime = await fetchLatestFrame();
        if (nextTime && nextTime !== currentTime) {
          currentTime = nextTime;
          radarLayer.setUrl(buildRadarUrl(currentTime));
          console.log(`[MAP] Radar updated: ${currentTime}`);
        }
      };
      window.rainviewerRefresh = refresh;
      setInterval(refresh, 5 * 60 * 1000);
      
    } catch (e) {
      console.warn("[MAP] RainViewer layer load failed", e);
    }
  }

  // 初期化実行
  (async () => {
    // 1. レーダー読み込み
    await setupRainViewerLayer();

    // 2. 空域
    await addGeoJsonOverlay(PATH_ASP, {
      style: styleAirspace,
      onEachFeature: (f, layer) => {
        const p = f.properties || {};
        layer.on("click", (e) => {
          if (window.routeMode === "pick") {
            L.DomEvent.stopPropagation(e);
            if(window.handlePointPick) window.handlePointPick(e.latlng, p.name || "Airspace");
          } else {
            L.popup().setLatLng(e.latlng).setContent(`<b>${p.name || "Airspace"}</b><br>${p.type || ""}`).openOn(map);
          }
        });
      },
    }, "空域 (ASP)");

    // 3. 空港 (METAR連携 + 風Log)
    await addGeoJsonOverlay(PATH_APT, {
      style: styleAirport,
      pointToLayer: (f, latlng) => L.circleMarker(latlng, { radius: 5, color: "#fff", weight: 1, fillColor: "#888", fillOpacity: 0.8 }),
      onEachFeature: setupStationFeature
    }, "空港 (APT)");

    // 4. ヘリポート
    await addGeoJsonOverlay(PATH_HELI, {
      style: styleAirport,
      pointToLayer: (f, latlng) => L.circleMarker(latlng, { radius: 6, color: "#fff", weight: 1.5, fillColor: FLIGHT_COLORS["UNKNOWN"], fillOpacity: 0.9 }),
      onEachFeature: (f, layer) => {
        setupStationFeature(f, layer);
        const p = f.properties || {};
        const icao = p.icaoCode || p.icao || p.ident || null;
        if(icao && icao.length === 4) fetchHeliMetar(layer, icao, p);
      }
    }, "ヘリポート");

    // 5. NAV (風Log)
    await addGeoJsonOverlay(PATH_NAV, {
      style: styleNavAid,
      pointToLayer: (f, latlng) => L.circleMarker(latlng, { radius: 3 }),
      onEachFeature: (f, layer) => {
        const p = f.properties || {};
        layer.on("click", (e) => {
          if (window.routeMode === "pick") {
            L.DomEvent.stopPropagation(e);
            if(window.handlePointPick) window.handlePointPick(e.latlng, p.ident || p.name);
          } else {
            L.popup().setLatLng(e.latlng).setContent(`<b>${p.name || p.ident}</b>`).openOn(map);
          }
          // 風ログ取得 (クリック時)
          const name = p.ident || p.name || "NAV";
          fetchWindLog(e.latlng.lat, e.latlng.lng, name);
        });
      },
    }, "無線施設 (NAV)");
  })();

  // --- 共通関数 ---

  async function fetchWindLog(lat, lon, name) {
    try {
      const r = await fetch("/api/gfs_wind", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alt_ft: 3000, points: [{ id: "temp", lat: lat, lon: lon }] })
      });
      if (!r.ok) return;
      const data = await r.json();
      if (data.points && data.points.length > 0) {
        const w = data.points[0];
        const logMsg = `[Log] ${name}: Wind ${Math.round(w.wind_dir)}° / ${Math.round(w.wind_spd)}kt (@${data.level})`;
        console.log(logMsg);
        if (window.addToNavLog) {
            window.addToNavLog({ name, lat, lon, wind_dir: w.wind_dir, wind_spd: w.wind_spd });
        }
      }
    } catch (e) { console.error("Wind fetch failed", e); }
  }

  function setupStationFeature(f, layer) {
    const p = f.properties || {};
    const icao = p.icaoCode || p.icao || p.ident || null;
    const name = p.name_ja || p.name || icao || "Unknown";

    layer.on("click", async (e) => {
      if (window.routeMode === "pick") {
        L.DomEvent.stopPropagation(e);
        if (window.handlePointPick) window.handlePointPick(e.latlng, icao || name);
        return;
      }

      // 風ログ取得
      fetchWindLog(e.latlng.lat, e.latlng.lng, icao || name);

      let html = `<b>${name}</b>`;
      if (icao) html += ` (${icao})`;
      html += `<br>Loading METAR...`;

      const popup = L.popup().setLatLng(e.latlng).setContent(html).openOn(map);

      if (icao && typeof window.avwxFetchMetar === "function") {
        const data = await window.avwxFetchMetar(icao);
        if (data) {
          let colorStr = "#000";
          const fr = (data.flight_rules || "").toUpperCase();
          if(fr === "VFR") colorStr = "green";
          else if(fr === "MVFR") colorStr = "purple";
          else if(fr === "IFR" || fr === "LIFR") colorStr = "red";

          let newHtml = `<b>${name}</b> (${icao})<br>`;
          newHtml += `<span style="color:${colorStr};font-weight:bold;">${fr}</span>`;
          newHtml += `<br><pre style="margin:4px 0;white-space:pre-wrap;font-size:11px;">${data.raw}</pre>`;
          newHtml += `<div style="font-size:10px; color:#666;">${data.time}</div>`;
          popup.setContent(newHtml);
        } else {
          popup.setContent(html.replace("Loading METAR...", "<span style='color:gray'>No Data</span>"));
        }
      } else {
        popup.setContent(`<b>${name}</b><br><span style="color:#666;">${p.municipality || ""}</span>`);
      }
    });
  }

  async function fetchHeliMetar(layer, icao, props) {
    try {
      if(typeof window.avwxFetchMetar === "function") {
        const data = await window.avwxFetchMetar(icao);
        if (data) {
          const rule = data.flight_rules || "UNKNOWN";
          const color = FLIGHT_COLORS[rule] || FLIGHT_COLORS["UNKNOWN"];
          layer.setStyle({ fillColor: color });
        }
      }
    } catch (e) {}
  }
})();