// static/js/weather-imc.js
console.log("[IMC] init weather-imc.js");

// ====== AVWX 設定 ======
// ★ここを自分のトークンに置き換えてください
const AVWX_TOKEN = "wAGbpDpafyuVP9YV_JT4rGofqkpe_pprXhiD4l8Twnw";

(function () {
  const map = window.navMap;
  const layersCtl = window.navLayersCtl;

  if (!map || !layersCtl) {
    console.warn(
      "[IMC] navMap / navLayersCtl が未定義です（map-core.js の読み込み順を確認してください）"
    );
    return;
  }

  // ====== AVWX METAR 取得共通関数 ======
  async function fetchMetar(icao) {
    const url = `https://avwx.rest/api/metar/${icao}?format=json&onfail=cache`;
    const headers = { Accept: "application/json" };
    if (AVWX_TOKEN && AVWX_TOKEN !== "YOUR_AVWX_TOKEN_HERE") {
      headers["Authorization"] = `Bearer ${AVWX_TOKEN}`;
    }
    const r = await fetch(url, { headers });
    if (!r.ok) throw new Error(`${icao} METAR ${r.status}`);
    const text = await r.text();
    if (!text.trim()) throw new Error(`${icao} empty body`);
    return JSON.parse(text);
  }

  // グローバル公開：空港クリック時の METAR 表示用
  window.avwxFetchMetar = fetchMetar;

  // ====== 10NM グリッド（日本全域） ======
  function buildJapanCells10nm() {
    const cells = [];
    const south = 24.0,
      north = 46.5,
      west = 122.5,
      east = 146.5;
    const latStep = 10 / 60; // 10NM

    for (let lat = south; lat < north; lat += latStep) {
      const lonStep = 10 / (60 * Math.max(0.0001, Math.cos((lat * Math.PI) / 180)));
      for (let lon = west; lon < east; lon += lonStep) {
        cells.push({
          lat1: lat,
          lat2: lat + latStep,
          lon1: lon,
          lon2: lon + lonStep,
          center: [lat + latStep / 2, lon + lonStep / 2],
        });
      }
    }
    console.log("[IMC] japan cells built:", cells.length);
    return cells;
  }

  const japanCells = buildJapanCells10nm();

  // ====== Haversine NM ======
  function haversineNM(aLat, aLon, bLat, bLon) {
    const R = 6371,
      rad = (x) => (x * Math.PI) / 180;
    const dLat = rad(bLat - aLat),
      dLon = rad(bLon - aLon);
    const la1 = rad(aLat),
      la2 = rad(bLat);
    const x =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
    const km = 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
    return km / 1.852;
  }

  const imcLayerGroup = L.featureGroup().addTo(map);
  layersCtl.addOverlay(imcLayerGroup, "IMC/MVFR（METAR）");

  let airportStations = [];

  async function updateImcLayerFromMetar() {
    try {
      if (!airportStations.length) {
        console.warn(
          "[IMC] airportStations が未定義か空です。APT GeoJSON 読み込み前に呼び出されました。"
        );
        return;
      }

      console.log("[IMC] stations extracted:", airportStations.length);

      const metarMap = new Map();
      await Promise.allSettled(
        airportStations.map(async (s) => {
          try {
            const m = await fetchMetar(s.icao);
            metarMap.set(s.icao, m);
          } catch (e) {
            console.warn("[IMC] METAR取得失敗:", s.icao, e.message);
          }
        })
      );

      const usableStations = airportStations.filter((s) =>
        metarMap.has(s.icao)
      );
      console.log("[IMC] usable stations:", usableStations.length);

      imcLayerGroup.clearLayers();

      let painted = 0;
      for (const c of japanCells) {
        const [clat, clon] = c.center;

        // 最近傍観測点
        let best = null,
          bestNM = 1e9;
        for (const st of usableStations) {
          const d = haversineNM(clat, clon, st.lat, st.lon);
          if (d < bestNM) {
            bestNM = d;
            best = st;
          }
        }

        // 観測点が遠すぎる場合は塗らない
        if (!best || bestNM > 60) continue;

        const metar = metarMap.get(best.icao);
        const fr = (metar?.flight_rules || "").toUpperCase();

        let fill = null;
        if (fr === "IFR" || fr === "LIFR") {
          fill = "#ff0000"; // IMC 赤
        } else if (fr === "MVFR") {
          fill = "#fb8c00"; // MVFR オレンジ
        } else {
          fill = null; // VFR は塗らない
        }

        if (fill) {
          const rect = L.rectangle(
            [
              [c.lat1, c.lon1],
              [c.lat2, c.lon2],
            ],
            {
              color: "#000000",
              weight: 1,
              fillColor: fill,
              fillOpacity: 0.35,
            }
          );
          rect.addTo(imcLayerGroup);
          painted++;
        }
      }
      console.log("[IMC] cells painted (Japan wide):", painted);
    } catch (e) {
      console.error("[IMC] layer update error:", e);
    }
  }

  // map-core.js から空港リスト受け取り
  window.setAirportStationsForImc = function (stations) {
    airportStations = stations || [];
    console.log("[IMC] stations extracted:", airportStations.length);
    updateImcLayerFromMetar();
    // 10分毎に更新
    setInterval(updateImcLayerFromMetar, 10 * 60 * 1000);
  };
})();
