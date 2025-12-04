// static/js/map-core.js
console.log("[MAP] init map-core.js");

(function () {
  // ====== 地図セットアップ ======
  const map = L.map("map", { zoomControl: false }).setView([36.2, 138.2], 6);

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
  };
  baseLayers["標準地図"].addTo(map);

  const layersCtl = L.control
    .layers(baseLayers, {}, { position: "topleft", collapsed: false })
    .addTo(map);

  L.control.zoom({ position: "bottomright" }).addTo(map);
  L.control
    .scale({ position: "bottomleft", metric: true, imperial: false })
    .addTo(map);

  // ====== タブ切替（入力 / 結果） ======
  const TabControl = L.Control.extend({
    onAdd: function () {
      const div = L.DomUtil.create("div", "tab-control leaflet-control");
      const btnInput = L.DomUtil.create("button", "btn active", div);
      btnInput.textContent = "入力";
      const btnResults = L.DomUtil.create("button", "btn", div);
      btnResults.textContent = "結果";

      L.DomEvent.disableClickPropagation(div);

      L.DomEvent.on(btnInput, "click", (e) => {
        e.preventDefault();
        if (window.showTab) window.showTab("input");
        btnInput.classList.add("active");
        btnResults.classList.remove("active");
      });

      L.DomEvent.on(btnResults, "click", (e) => {
        e.preventDefault();
        if (window.showTab) window.showTab("results");
        btnResults.classList.add("active");
        btnInput.classList.remove("active");
      });

      return div;
    },
  });
  map.addControl(new TabControl({ position: "topright" }));

  // グローバル公開
  window.navMap = map;
  window.navLayersCtl = layersCtl;

  // ====== GeoJSON オーバーレイ ======
  const PATH_ASP = "/static/data/jp_asp.geojson";
  const PATH_APT = "/static/data/jp_apt.geojson";
  const PATH_NAV = "/static/data/jp_nav.geojson";

  function styleAirspace(f) {
    const p = (f && f.properties) || {};
    const name = `${p.name || p.designation || ""} ${p.type || p.class || ""}`;
    const isCtrlOrInfo =
      /管制圏|情報圏|CTR|Control Zone|Information Zone/i.test(name);
    const fiveNM =
      /(\b|[^0-9])5\s*NM/i.test(name) ||
      p.radius_nm === 5 ||
      p.radiusNM === 5 ||
      p.radius === 5;
    const color = isCtrlOrInfo && fiveNM ? "#fb8c00" : "#FF68BB";
    return { color, weight: 1.6, fillOpacity: 0 };
  }

  const styleAirport = { color: "#1565c0", weight: 1.2, fillOpacity: 0 };
  const styleNavAid = { color: "#455a64", weight: 1, fillOpacity: 0 };

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

  let airportStations = []; // METAR / IMC 用

  // ====== ASP / APT / NAV ロード ======
  (async () => {
    const fitGroup = L.featureGroup().addTo(map);

    // --- 空域（ASP） ---
    const asp = await addGeoJsonOverlay(PATH_ASP, {
      style: styleAirspace,
      onEachFeature: (f, layer) => {
        const p = f.properties || {};
        const html = `<b>${p.name || p.designation || "AIRSPACE"}</b><br>
          Type/Class: ${p.class || p.type || ""}<br>
          LOWER: ${p.lower || p.floor || ""} / UPPER: ${
          p.upper || p.ceiling || ""
        }`;

        layer.on("click", (e) => {
          const mode =
            (typeof window.getRouteMode === "function" &&
              window.getRouteMode()) ||
            "text";

          // ピックモード中はポップアップを出さない → 下の map.click に通す
          if (mode === "pick") {
            return;
          }

          layer.bindPopup(html).openPopup(e.latlng);
          L.DomEvent.stop(e);
        });
      },
    });
    if (asp) {
      layersCtl.addOverlay(asp, "空域（ASP）");
      asp.addTo(map);
      fitGroup.addLayer(asp);
    }

    // --- 空港（APT） ---
    const apt = await addGeoJsonOverlay(PATH_APT, {
      style: styleAirport,
      pointToLayer: (f, latlng) => L.circleMarker(latlng, { radius: 4 }),
      onEachFeature: (f, layer) => {
        const p = f.properties || {};
        const icao =
          p.icaoCode || p.icao || p.ident || p.station || p.code || null;
        const name = p.name || icao || "APT";

        layer.on("click", async (e) => {
          const mode =
            (typeof window.getRouteMode === "function" &&
              window.getRouteMode()) ||
            "text";

          const latlng = e.latlng;

          if (mode === "pick") {
            // 地図クリックモード：METAR は出さずにルートピンとして追加
            if (typeof window.addPickedPoint === "function") {
              const label = name || (icao ? `APT ${icao}` : "APT");
              window.addPickedPoint([latlng.lat, latlng.lng], label);
            }
            L.DomEvent.stop(e);
            return;
          }

          // 地名入力モード：METAR を取得してポップアップ
          if (icao && typeof window.avwxFetchMetar === "function") {
            try {
              const metar = await window.avwxFetchMetar(icao);
              const fr = (metar?.flight_rules || "").toUpperCase();
              const raw = metar?.raw || "";
              const html = `<b>${name} (${icao})</b><br>
                Flight rules: ${fr}<br>
                <pre style="margin:4px 0;white-space:pre-wrap;">${raw}</pre>`;
              layer.bindPopup(html).openPopup(latlng);
            } catch (err) {
              const html = `<b>${name} (${icao})</b><br>METAR取得失敗`;
              layer.bindPopup(html).openPopup(latlng);
            }
          } else {
            const html = `<b>${name}</b><br>ICAO未設定のためMETAR取得不可`;
            layer.bindPopup(html).openPopup(latlng);
          }

          L.DomEvent.stop(e);
        });
      },
    });

    if (apt) {
      layersCtl.addOverlay(apt, "空港（APT）");

      // METAR / IMC 用 station リスト作成
      airportStations = (apt.toGeoJSON().features || [])
        .map((ft) => {
          const p = ft.properties || {};
          const icao =
            p.icaoCode || p.icao || p.ident || p.station || p.code || null;
          const c = ft.geometry?.coordinates;
          if (!icao || !c || c.length < 2) return null;
          return {
            icao: String(icao).trim().toUpperCase(),
            lat: c[1],
            lon: c[0],
          };
        })
        .filter(Boolean);

      // weather-imc.js 側に渡す
      if (typeof window.setAirportStationsForImc === "function") {
        window.setAirportStationsForImc(airportStations);
      }
    }

    // --- 無線施設（NAV） ---
    const nav = await addGeoJsonOverlay(PATH_NAV, {
      style: styleNavAid,
      pointToLayer: (f, latlng) => L.circleMarker(latlng, { radius: 3 }),
      onEachFeature: (f, layer) => {
        const p = f.properties || {};
        const html = `<b>${p.name || p.ident || "NAV"}</b><br>${
          p.type || p.category || ""
        }`;
        layer.bindPopup(html);
      },
    });
    if (nav) {
      layersCtl.addOverlay(nav, "無線施設（NAV）");
      fitGroup.addLayer(nav);
    }

    if (fitGroup.getLayers().length > 0) {
      map.fitBounds(fitGroup.getBounds(), { padding: [20, 20] });
    }
  })();
})();
