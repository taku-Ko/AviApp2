console.log("[IMC] init weather-imc.js (Cache Busting Fix)");

(function () {
  let map = window.navMap;
  const imcLayerGroup = L.featureGroup();
  
  // 地図レイヤーの準備待機と追加
  function addLayerToMap() {
    // map-core.js で定義された navMap と navLayersControl を探す
    if (!map && window.navMap) map = window.navMap;
    
    if (map) {
      imcLayerGroup.addTo(map);
      if(window.navLayersControl) {
        window.navLayersControl.addOverlay(imcLayerGroup, "IMC/MVFRメッシュ");
      }
    } else {
      // まだ地図がない場合は少し待って再試行
      setTimeout(addLayerToMap, 500);
    }
  }
  addLayerToMap();

  // ====== AVWX METAR 取得関数 (キャッシュ対策済み) ======
  async function fetchMetar(icao) {
    const clean = String(icao).trim().toUpperCase();
    if (!clean) return null;
    try {
      // ★修正: URL末尾に現在時刻(Date.now())を付与して、ブラウザのキャッシュを回避
      const url = `/api/metar?icao=${encodeURIComponent(clean)}&_=${Date.now()}`;
      
      // ★修正: cache: "no-store" で明示的にキャッシュしないよう指定
      const res = await fetch(url, { cache: "no-store" });
      
      if (!res.ok) return null;
      return await res.json();
    } catch(e) { 
      // console.warn(`[IMC] Fetch fail: ${icao}`, e);
      return null; 
    }
  }
  // 他のスクリプトからも呼べるように公開
  window.avwxFetchMetar = fetchMetar;

  // ====== 10NM グリッド生成（日本全域） ======
  const japanCells = [];
  (function buildGrid(){
    const south=24.0, north=46.5, west=122.5, east=146.5;
    const latStep=10/60; // 10NM
    for(let lat=south; lat<north; lat+=latStep){
      // 経度は緯度によって幅が変わるため補正
      const lonStep = 10 / (60 * Math.max(0.0001, Math.cos(lat*Math.PI/180)));
      for(let lon=west; lon<east; lon+=lonStep){
        japanCells.push({
          lat1:lat, lat2:lat+latStep, lon1:lon, lon2:lon+lonStep,
          center:[lat+latStep/2, lon+lonStep/2]
        });
      }
    }
  })();

  // ====== 距離計算 (Haversine) ======
  function haversineNM(aLat, aLon, bLat, bLon) {
    const R = 6371; 
    const dLat = (bLat-aLat)*Math.PI/180;
    const dLon = (bLon-aLon)*Math.PI/180;
    const a = Math.sin(dLat/2)**2 + Math.cos(aLat*Math.PI/180)*Math.cos(bLat*Math.PI/180)*Math.sin(dLon/2)**2;
    // km -> nm
    return (2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))) / 1.852;
  }

  // ====== データ鮮度チェック ======
  // 90分以上前のデータは「古い」とみなして表示しない
  function isDataFresh(m) {
    if(!m || !m.time || !m.time.dt) return false;
    
    const obs = new Date(m.time.dt);
    const now = new Date();
    // 差分（分）
    const diff = (now - obs) / 60000; 
    
    // 未来の日付(時計ズレ -10分まで許容) や 90分経過したものは false
    if (diff < -10 || diff > 90) return false; 
    
    return true; 
  }

  // map-core.js から渡される空港リスト
  let airportStations = [];

  // ====== メイン更新処理 ======
  async function updateImcLayerFromMetar() {
    if (!airportStations.length) return;
    console.log("[IMC] Updating METAR Mesh & Markers...");

    const metarMap = new Map();
    // 並列取得（負荷軽減のため適宜調整）
    await Promise.allSettled(
      airportStations.map(async (s) => {
        const m = await fetchMetar(s.icao);
        if (m) metarMap.set(s.icao, m);
      })
    );

    // 1. マーカーの色更新 (map-core.js のレイヤーを操作)
    if (window.layerAirports) updateMarkers(window.layerAirports, metarMap);
    if (window.layerHeliports) updateMarkers(window.layerHeliports, metarMap);

    // 2. グリッド(メッシュ)更新
    imcLayerGroup.clearLayers();
    const usableStations = airportStations.filter(s => metarMap.has(s.icao));
    
    let count = 0;
    for (const c of japanCells) {
      // グリッド中心から最も近い空港を探す
      let best = null, bestNM = 9999;
      for (const s of usableStations) {
        const d = haversineNM(c.center[0], c.center[1], s.lat, s.lon);
        if (d < bestNM) { bestNM = d; best = s; }
      }

      // 参照距離: 30NM以内 (以前のご指定)
      if (!best || bestNM > 30) continue;

      const m = metarMap.get(best.icao);
      
      // 鮮度チェック: 古いデータなら塗らない
      if (!isDataFresh(m)) continue; 

      const fr = (m.flight_rules || "").toUpperCase();
      let color = null;
      // IFR/LIFR=赤, MVFR=青 (VFRは塗らない)
      if (fr === "IFR" || fr === "LIFR") color = "#c62828"; 
      else if (fr === "MVFR") color = "#1565c0"; 
      
      if (color) {
        L.rectangle([[c.lat1,c.lon1],[c.lat2,c.lon2]], {
          color: "transparent", // 枠線なし
          fillColor: color, 
          fillOpacity: 0.35, 
          interactive: false
        }).addTo(imcLayerGroup);
        count++;
      }
    }
    console.log(`[IMC] Mesh Updated: Painted ${count} cells.`);
  }

  // マーカー(空港ピン)の色を更新する関数
  function updateMarkers(layerGroup, metarMap) {
    layerGroup.eachLayer(l => {
      const p = l.feature.properties;
      const icao = p.icao || p.ident;
      if (!icao) return;

      const m = metarMap.get(icao);
      if (m) {
        // ポップアップ用にデータを保存
        l.metarData = { rule: m.flight_rules, raw: m.raw, time: m.time?.dt };
        
        // 鮮度チェック: 古いデータなら白(デフォルト)に戻す
        if (!isDataFresh(m)) {
           l.setStyle({ fillColor: "#ffffff", color:"#555", weight: 1.5 });
           return;
        }

        const fr = m.flight_rules;
        let c = "#ffffff";
        let w = 1.5;
        let border = "#555";

        if (fr === "IFR" || fr === "LIFR") {
          c = "#c62828"; // 赤
          w = 2; 
          border = "#333";
        } else if (fr === "MVFR") {
          c = "#1565c0"; // 青
          w = 2;
          border = "#333";
        }
        
        l.setStyle({ fillColor: c, color: border, weight: w });
      }
    });
  }

  // ====== 外部公開インターフェース ======
  // map-core.js から呼ばれる
  window.setAirportStationsForImc = function (stations) {
    airportStations = stations || [];
    // 初回実行
    updateImcLayerFromMetar();
    
    // 定期更新タイマー (10分ごと)
    if(window.imcTimer) clearInterval(window.imcTimer);
    window.imcTimer = setInterval(updateImcLayerFromMetar, 10 * 60 * 1000);
  };

})();
