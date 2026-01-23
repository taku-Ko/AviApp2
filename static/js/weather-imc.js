// static/js/weather-imc.js
console.log("[IMC] init weather-imc.js (Parallel Fetch & 30nm Cells)");

(function() {
  const map = window.navMap;
  if (!map) return;

  // --- 1. グローバルMETAR取得関数 ---
  // app.py の /api/metar (AVWX経由) を利用
  window.avwxFetchMetar = async function(icao) {
    if (!icao) return null;
    try {
      // キャッシュ回避用のタイムスタンプ付与も検討できますが、まずは標準で
      const res = await fetch(`/api/metar?icao=${icao}`);
      if (!res.ok) return null;
      const data = await res.json();
      
      if (data.raw) {
        return {
          flight_rules: data.flight_rules, // "VFR", "MVFR", "IFR", "LIFR"
          raw: data.raw,
          time: data.meta ? data.meta.timestamp : ""
        };
      }
      return null;
    } catch (e) {
      // エラー時は静かに無視（コンソールが汚れるのを防ぐためwarn程度に）
      console.warn(`METAR fetch failed for ${icao}`, e);
      return null;
    }
  };

  // --- 2. メッシュ（矩形）レイヤー ---
  const meshLayer = L.layerGroup();
  meshLayer.addTo(map); // デフォルト表示

  // 地図右上のレイヤーコントロールに追加 (map-core.jsのロード待ちリトライ付き)
  const addLayerToControl = () => {
    if (window.navLayersControl) {
      window.navLayersControl.addOverlay(meshLayer, "気象情報 (IMC/MVFR)");
    } else {
      setTimeout(addLayerToControl, 500);
    }
  };
  addLayerToControl();

  const AIRPORTS_JSON = "/static/data/jp_apt.geojson";

  // 色設定
  function getMeshColor(rule) {
    if (!rule) return null;
    const r = rule.toUpperCase();
    if (r === "LIFR" || r === "IFR") return "#FF0000"; // 赤 (IMC)
    if (r === "MVFR") return "#800080"; // 紫 (MVFR)
    if (r === "VFR") return "#00FF00";  // 緑 (VMC) - 読み込み確認用
    return null;
  }

  // 並列処理用のヘルパー関数
  async function fetchAllMetars(features) {
    // 同時リクエスト数制限（ブラウザ負荷軽減のため5-10程度に）
    const CONCURRENCY = 6; 
    const queue = [...features]; // コピーを作成
    let activeCount = 0;

    // 1つのワーカー処理
    const worker = async () => {
      while (queue.length > 0) {
        const f = queue.shift();
        const icao = f.properties.icao;
        if (!icao) continue;

        // METAR取得
        const metar = await window.avwxFetchMetar(icao);
        
        // 取得でき次第、即座に描画（ユーザーへのフィードバックを早くする）
        if (metar) {
          const color = getMeshColor(metar.flight_rules);
          if (color) {
            const lat = f.geometry.coordinates[1];
            const lon = f.geometry.coordinates[0];
            
            // ★変更: 30nm ≒ 0.5度 (半径)
            // 中心から±0.5度 = 一辺1.0度(60nm)のボックスになります
            const size = 0.5; 
            
            // VFRの場合は邪魔にならないよう透明度を下げる
            const opacity = (metar.flight_rules === "VFR") ? 0.1 : 0.35;

            L.rectangle(
              [[lat - size, lon - size], [lat + size, lon + size]],
              { 
                color: color, 
                weight: 0, 
                fillOpacity: opacity, 
                stroke: false 
              }
            ).addTo(meshLayer);
          }
        }
      }
    };

    // ワーカーを並列起動
    const workers = [];
    for (let i = 0; i < CONCURRENCY; i++) {
      workers.push(worker());
    }
    await Promise.all(workers);
  }

  // メッシュ更新メイン処理
  async function updateMeshes() {
    try {
      console.log("Starting weather update...");
      const res = await fetch(AIRPORTS_JSON);
      const data = await res.json();
      
      meshLayer.clearLayers(); // 更新時はクリア

      // 並列フェッチ実行
      await fetchAllMetars(data.features);
      console.log("Weather update completed.");

    } catch(e) {
      console.error("Mesh update error", e);
    }
  }

  // 初回実行 & 10分ごとに更新
  updateMeshes();
  setInterval(updateMeshes, 600000);

  // --- 3. 凡例 (Legend) ---
  const legend = L.control({ position: 'bottomright' });
  legend.onAdd = function (map) {
    const div = L.DomUtil.create('div', 'map-legend');
    // VMC(緑)も凡例に追加
    div.innerHTML = `
      <div style="font-weight:bold; border-bottom:1px solid #ccc; margin-bottom:4px; font-size:11px;">Weather</div>
      <div style="font-size:11px; margin-bottom:2px;"><i style="background:#FF0000; width:10px; height:10px; float:left; margin-right:6px; border:1px solid #ccc;"></i> IMC</div>
      <div style="font-size:11px; margin-bottom:2px;"><i style="background:#800080; width:10px; height:10px; float:left; margin-right:6px; border:1px solid #ccc;"></i> MVFR</div>
      <div style="font-size:11px;"><i style="background:#00FF00; width:10px; height:10px; float:left; margin-right:6px; border:1px solid #ccc; opacity:0.5;"></i> VMC</div>
    `;
    return div;
  };
  legend.addTo(map);
})();