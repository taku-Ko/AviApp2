console.log("[IMC] init weather-imc.js (Grid Paint Restored)");

(function () {
  // マップオブジェクトの取得（読み込み順によってはまだない可能性があるため、チェックは行うが即returnはしない）
  let map = window.navMap;
  let layersCtl = window.navLayersControl; // 変数名をmap-core.jsと合わせる

  // レイヤーグループ作成（マップがあれば即追加、なければ後で追加）
  const imcLayerGroup = L.featureGroup();
  if (map) {
    imcLayerGroup.addTo(map);
    if (layersCtl) {
      layersCtl.addOverlay(imcLayerGroup, "IMC/MVFRメッシュ");
    }
  }

  // ====== AVWX METAR 取得関数 ======
  async function fetchMetar(icao) {
    const clean = String(icao || "").trim().toUpperCase();
    if (!clean) throw new Error("icao empty");

    // サーバー経由でAVWX APIを叩く想定
    const url = `/api/metar?icao=${encodeURIComponent(clean)}`;
    const r = await fetch(url, { headers: { Accept: "application/json" } });
    
    if (!r.ok) {
      // エラー時はnullを返すなどして処理を止めない
      return null;
    }
    return await r.json();
  }

  // map-core.js等から利用できるように公開
  window.avwxFetchMetar = fetchMetar;

  // ====== 10NM グリッド生成（日本全域） ======
  function buildJapanCells10nm() {
    const cells = [];
    const south = 24.0, north = 46.5;
    const west = 122.5, east = 146.5;
    const latStep = 10 / 60; // 10NM approx 0.166 deg

    for (let lat = south; lat < north; lat += latStep) {
      // 緯度に応じた経度方向の10NMステップ補正
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
    // console.log("[IMC] japan cells built:", cells.length);
    return cells;
  }

  const japanCells = buildJapanCells10nm();

  // ====== 距離計算 (Haversine) ======
  function haversineNM(aLat, aLon, bLat, bLon) {
    const R = 6371; 
    const rad = (x) => (x * Math.PI) / 180;
    const dLat = rad(bLat - aLat);
    const dLon = rad(bLon - aLon);
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return (R * c) / 1.852; // km -> nm
  }

  // ====== メイン処理: メッシュ更新 ======
  // map-core.js から空港リスト(stations)を受け取って実行される
  let airportStations = [];

  async function updateImcLayerFromMetar() {
    if (!airportStations.length) return;
    
    // マップオブジェクトの再取得（初期化時に無かった場合のため）
    if (!map && window.navMap) {
      map = window.navMap;
      imcLayerGroup.addTo(map);
      if (window.navLayersControl) {
        window.navLayersControl.addOverlay(imcLayerGroup, "IMC/MVFRメッシュ");
      }
    }
    if (!map) return; // まだマップがない場合は次回の更新で

    console.log("[IMC] Updating METAR Mesh...");

    // 1. 全空港のMETAR取得
    const metarMap = new Map();
    // 並列取得（負荷軽減のため適宜調整してください）
    await Promise.allSettled(
      airportStations.map(async (s) => {
        try {
          const m = await fetchMetar(s.icao);
          if (m) metarMap.set(s.icao, m);
        } catch (e) { /* ignore */ }
      })
    );

    const usableStations = airportStations.filter((s) => metarMap.has(s.icao));
    imcLayerGroup.clearLayers();

    // 2. メッシュごとに最近傍空港を探して色分け
    let painted = 0;
    for (const c of japanCells) {
      const [clat, clon] = c.center;

      // 最近傍探索
      let best = null;
      let bestNM = 9999;

      for (const st of usableStations) {
        const d = haversineNM(clat, clon, st.lat, st.lon);
        if (d < bestNM) {
          bestNM = d;
          best = st;
        }
      }

      // 60NM以上離れていたら塗らない（データなし）
      if (!best || bestNM > 60) continue;

      // METAR判定
      const metar = metarMap.get(best.icao);
      const fr = (metar?.flight_rules || "").toUpperCase();

      let fill = null;
      if (fr === "IFR" || fr === "LIFR") {
        fill = "#ff0000"; // 赤 (IMC)
      } else if (fr === "MVFR") {
        fill = "#fb8c00"; // オレンジ (Marginal VFR)
      } 
      // VFRは fill = null (塗らない)

      // 描画
      if (fill) {
        L.rectangle(
          [[c.lat1, c.lon1], [c.lat2, c.lon2]],
          {
            color: "transparent", // 枠線なし
            weight: 0,
            fillColor: fill,
            fillOpacity: 0.35,
            interactive: false // クリック判定等は不要
          }
        ).addTo(imcLayerGroup);
        painted++;
      }
    }
    console.log(`[IMC] Mesh Updated: ${painted} cells painted.`);
  }

  // ====== 外部公開インターフェース ======
  // map-core.js で空港データを読み込んだ後にこれを呼んでもらう
  window.setAirportStationsForImc = function (stations) {
    airportStations = stations || [];
    // 初回実行
    updateImcLayerFromMetar();
    
    // 定期更新タイマー (10分ごと)
    if (window.imcTimer) clearInterval(window.imcTimer);
    window.imcTimer = setInterval(updateImcLayerFromMetar, 10 * 60 * 1000);
  };

})();