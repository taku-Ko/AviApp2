// static/js/map-core.js
console.log("[MAP] init map-core.js (Gray Airspace Style)");

(function () {
  // ====== 地図セットアップ ======
  // UI機能（ボタン等）は ui-main.js に任せ、ここは純粋な地図初期化のみを行います
  const map = L.map("map", { zoomControl: false }).setView([36.0, 140.0], 7);

  // グローバル公開
  window.navMap = map;
  window.airportStations = []; // weather-imc.js 連携用

  // ベースレイヤー
  const baseLayers = {
    "標準地図": L.tileLayer(
      "https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png",
      { attribution: "GSI 標準地図" }
    ),
    "色別標高図": L.tileLayer(
      "https://cyberjapandata.gsi.go.jp/xyz/relief/{z}/{x}/{y}.png",
      { attribution: "GSI 色別標高図" }
    ),
    "航空写真": L.tileLayer(
      "https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg",
      { attribution: "GSI 航空写真" }
    ),
    "OpenStreetMap": L.tileLayer(
      "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      { attribution: "&copy; OpenStreetMap" }
    )
  };
  baseLayers["標準地図"].addTo(map);

  const layersCtrl = L.control
    .layers(baseLayers, {}, { position: "topright", collapsed: false })
    .addTo(map);
  window.navLayersControl = layersCtrl; // 外部連携用

  L.control.zoom({ position: "bottomright" }).addTo(map);
  L.control.scale({ position: "bottomleft", metric: true, imperial: false }).addTo(map);

  // ====== データパス ======
  const PATH_ASP = "/static/data/jp_asp.geojson";
  const PATH_APT = "/static/data/jp_apt.geojson";
  const PATH_NAV = "/static/data/jp_nav.geojson";
  const PATH_HELI = "/static/data/jp_heliport.geojson";

  // ====== スタイル定義 ======
  
  // ★空域：ご指定の「グレーの点線」スタイル
  const styleAirspace = {
    color: "#555",
    weight: 1,
    fillOpacity: 0.1,
    dashArray: "4 4"
  };

  // 空港・ヘリポート共通
  const styleAirport = { color: "#1565c0", weight: 1.2, fillOpacity: 0.8, fillColor: "#888" };
  const styleNavAid = { color: "#455a64", weight: 1, fillOpacity: 0 };
  
  // ヘリポートMETAR用カラー
  const FLIGHT_COLORS = {
    "VFR": "#2e7d32", "MVFR": "#1565c0", "IFR": "#c62828", "LIFR": "#ad1457", "UNKNOWN": "#757575"
  };

  // GeoJSON読み込みヘルパー
  async function addGeoJsonOverlay(url, opts) {
    try {
      const r = await fetch(url, { headers: { Accept: "application/json" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      console.log("[GeoJSON loaded]", url, data?.features?.length || 0);
      return L.geoJSON(data, opts);
    } catch (e) {
      console.error("GeoJSON load error:", url, e);
      return null;
    }
  }

  // ====== レイヤーロード ======
  (async () => {
    const fitGroup = L.featureGroup();

    // --- 1. 空域（ASP） ---
    // ★グレーの点線スタイルを適用
    const asp = await addGeoJsonOverlay(PATH_ASP, {
      style: styleAirspace,
      onEachFeature: (f, layer) => {
        const p = f.properties || {};
        const html = `<b>${p.name || "Airspace"}</b><br>${p.type || ""}`;
        
        layer.on("click", (e) => {
          // ピックモード中はポップアップを出さない
          const mode = (typeof window.getRouteMode === "function" && window.getRouteMode()) || "text";
          if (mode === "pick") return; 
          layer.bindPopup(html).openPopup(e.latlng);
          L.DomEvent.stop(e);
        });
      },
    });
    if (asp) {
      layersCtrl.addOverlay(asp, "空域（ASP）");
      // デフォルトはOFF
    }

    // --- 2. 空港（APT） ---
    const apt = await addGeoJsonOverlay(PATH_APT, {
      style: styleAirport,
      pointToLayer: (f, latlng) => L.circleMarker(latlng, { radius: 5, color: "#fff", weight: 1, fillColor: "#888", fillOpacity: 0.8 }),
      onEachFeature: setupStationFeature
    });
    if (apt) {
      layersCtrl.addOverlay(apt, "空港（APT）");
      apt.addTo(map);
      fitGroup.addLayer(apt);
      
      // weather-imc.js 連携
      passStationsToImc(apt);
    }

    // --- 3. ヘリポート（HELI） ---
    const heli = await addGeoJsonOverlay(PATH_HELI, {
      style: styleAirport,
      pointToLayer: (f, latlng) => L.circleMarker(latlng, { radius: 6, color: "#fff", weight: 1.5, fillColor: FLIGHT_COLORS["UNKNOWN"], fillOpacity: 0.9 }),
      onEachFeature: (f, layer) => {
        setupStationFeature(f, layer);
        // 4レターがある場合のみ独自にMETAR取得して色更新
        const p = f.properties || {};
        const icao = p.icaoCode || p.icao || p.ident || null;
        if(icao && icao.length === 4) {
          fetchHeliMetar(layer, icao, p);
        }
      }
    });
    if (heli) {
      layersCtrl.addOverlay(heli, "ヘリポート");
      heli.addTo(map);
    }

    // --- 4. 無線施設（NAV） ---
    const nav = await addGeoJsonOverlay(PATH_NAV, {
      style: styleNavAid,
      pointToLayer: (f, latlng) => L.circleMarker(latlng, { radius: 3 }),
      onEachFeature: (f, layer) => {
        const p = f.properties || {};
        layer.bindPopup(`<b>${p.name || p.ident || "NAV"}</b><br>${p.type || p.category || ""}`);
      },
    });
    if (nav) {
      layersCtrl.addOverlay(nav, "無線施設（NAV）");
    }

    // 初期表示範囲調整
    if (fitGroup.getLayers().length > 0) {
      map.fitBounds(fitGroup.getBounds(), { padding: [20, 20] });
    }
  })();

  // ====== 共通ヘルパー関数 ======

  // 空港・ヘリポートの共通ポップアップ＆クリック処理
  function setupStationFeature(f, layer) {
    const p = f.properties || {};
    const icao = p.icaoCode || p.icao || p.ident || p.station || p.code || null;
    const name = p.name_ja || p.name || icao || "Unknown";

    layer.on("click", async (e) => {
      const mode = (typeof window.getRouteMode === "function" && window.getRouteMode()) || "text";
      const latlng = e.latlng;

      // 【ルート作成モード】
      if (mode === "pick") {
        if (typeof window.addPickedPoint === "function") {
          window.addPickedPoint([latlng.lat, latlng.lng], name);
        }
        L.DomEvent.stop(e);
        return;
      }

      // 【通常モード】METAR表示
      let html = `<b>${name}</b>`;
      if (icao) html += ` (${icao})`;
      
      // ICAOがあるならMETAR取得を試みる
      if (icao && typeof window.avwxFetchMetar === "function") {
        try {
          // まずloading表示
          layer.bindPopup(html + "<br>Loading METAR...").openPopup(latlng);
          
          const metar = await window.avwxFetchMetar(icao);
          const fr = (metar?.flight_rules || "").toUpperCase();
          const raw = metar?.raw || "(No Raw Data)";
          
          let colorStr = "#000";
          if(fr === "VFR") colorStr = "green";
          else if(fr === "MVFR") colorStr = "blue";
          else if(fr === "IFR") colorStr = "red";
          else if(fr === "LIFR") colorStr = "purple";

          html += `<br><span style="color:${colorStr};font-weight:bold;">${fr}</span>`;
          html += `<br><pre style="margin:4px 0;white-space:pre-wrap;font-size:11px;">${raw}</pre>`;
          layer.setPopupContent(html);
        } catch (err) {
          layer.setPopupContent(html + `<br><span style="color:red;font-size:11px;">METAR取得不可</span>`);
        }
      } else {
        html += `<br><span style="color:#666;font-size:11px;">${p.municipality || ""}</span>`;
        layer.bindPopup(html).openPopup(latlng);
      }
      L.DomEvent.stop(e);
    });
  }

  // ヘリポート用：初期ロード時にMETARを取得してマーカー色を変える処理
  async function fetchHeliMetar(layer, icao, props) {
    try {
      const res = await fetch(`/api/metar?icao=${icao}`);
      if (!res.ok) return;
      const data = await res.json();
      if (!data || data.error) return;

      const rule = data.flight_rules || "UNKNOWN";
      const color = FLIGHT_COLORS[rule] || FLIGHT_COLORS["UNKNOWN"];
      layer.setStyle({ fillColor: color });
    } catch (e) {
      // 失敗時は無視(グレーのまま)
    }
  }

  // weather-imc.js へ空港リストを渡す処理
  function passStationsToImc(layerGroup) {
    const stations = (layerGroup.toGeoJSON().features || [])
      .map((ft) => {
        const p = ft.properties || {};
        const icao = p.icaoCode || p.icao || p.ident || p.station || p.code || null;
        const c = ft.geometry?.coordinates;
        if (!icao || !c || c.length < 2) return null;
        return { icao: String(icao).trim().toUpperCase(), lat: c[1], lon: c[0] };
      })
      .filter(Boolean);

    window.airportStations = stations;
    if (typeof window.setAirportStationsForImc === "function") {
      window.setAirportStationsForImc(stations);
    }
  }

})();