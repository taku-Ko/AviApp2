// static/js/map-core.js
console.log("[MAP] init map-core.js (FIXED: Popup Suppression)");

(function () {
  const map = L.map("map", { zoomControl: false }).setView([36.0, 140.0], 7);
  window.navMap = map;

  // ベースレイヤー
  const baseLayers = {
    "標準地図": L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png", { attribution: "GSI Tiles", maxZoom: 18 }),
    "色別標高図": L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/relief/{z}/{x}/{y}.png", { attribution: "GSI Tiles", maxZoom: 18 }),
    "航空写真": L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg", { attribution: "GSI Tiles", maxZoom: 18 }),
    "OpenStreetMap": L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "&copy; OpenStreetMap" })
  };
  baseLayers["標準地図"].addTo(map);

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

  (async () => {
    // 1. 空域
    await addGeoJsonOverlay(PATH_ASP, {
      style: styleAirspace,
      onEachFeature: (f, layer) => {
        const p = f.properties || {};
        layer.on("click", (e) => {
          if (window.routeMode === "pick") {
            L.DomEvent.stopPropagation(e); // 伝播停止
            if(window.handlePointPick) window.handlePointPick(e.latlng, p.name || "Airspace");
          } else {
            L.popup().setLatLng(e.latlng).setContent(`<b>${p.name || "Airspace"}</b><br>${p.type || ""}`).openOn(map);
          }
        });
      },
    }, "空域 (ASP)");

    // 2. 空港 (METAR連携)
    await addGeoJsonOverlay(PATH_APT, {
      style: styleAirport,
      pointToLayer: (f, latlng) => L.circleMarker(latlng, { radius: 5, color: "#fff", weight: 1, fillColor: "#888", fillOpacity: 0.8 }),
      onEachFeature: setupStationFeature
    }, "空港 (APT)");

    // 3. ヘリポート
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

    // 4. NAV
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
        });
      },
    }, "無線施設 (NAV)");
  })();

  function setupStationFeature(f, layer) {
    const p = f.properties || {};
    const icao = p.icaoCode || p.icao || p.ident || null;
    const name = p.name_ja || p.name || icao || "Unknown";

    layer.on("click", async (e) => {
      // Pickモードなら登録処理のみして終了 (ポップアップは出さない)
      if (window.routeMode === "pick") {
        L.DomEvent.stopPropagation(e);
        if (window.handlePointPick) window.handlePointPick(e.latlng, icao || name);
        return;
      }

      // Normalモード: METAR表示
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

          let newHtml = `<b>${name}</b>`;
          if (icao) newHtml += ` (${icao})`;
          newHtml += `<br><span style="color:${colorStr};font-weight:bold;">${fr}</span>`;
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