// static/js/weather-imc.js
console.log("[IMC] init weather-imc.js (AVWX Linked)");

(function() {
  const map = window.navMap;
  if (!map) return;

  // --- 1. グローバルMETAR取得関数 (map-core.jsから利用) ---
  // app.py (/api/metar) 経由で AVWX のデータを取得します
  window.avwxFetchMetar = async function(icao) {
    if (!icao) return null;
    try {
      // app.py の AVWX プロキシを叩く
      const res = await fetch(`/api/metar?icao=${icao}`);
      if (!res.ok) return null;
      const data = await res.json();
      
      // AVWXのレスポンス形式 ("flight_rules": "VFR", "raw": "...") を整形して返す
      if (data.raw) {
        return {
          flight_rules: data.flight_rules, // "VFR", "MVFR", "IFR", "LIFR"
          raw: data.raw,
          time: data.meta ? data.meta.timestamp : "" // 時刻情報など
        };
      }
      return null;
    } catch (e) {
      console.warn("METAR fetch error:", e);
      return null;
    }
  };

  // --- 2. メッシュ（矩形）描画レイヤー ---
  const meshLayer = L.layerGroup(); 
  
  // デフォルトで地図に追加（表示状態にする）
  meshLayer.addTo(map);

  // ★重要: 地図右上のレイヤーコントロールに「気象情報」として追加
  // map-core.js の初期化を待ってから追加
  const addLayerToControl = () => {
    if (window.navLayersControl) {
      window.navLayersControl.addOverlay(meshLayer, "気象情報 (IMC/MVFR)");
    } else {
      setTimeout(addLayerToControl, 500); // まだなら再トライ
    }
  };
  addLayerToControl();

  const AIRPORTS_JSON = "/static/data/jp_apt.geojson";

  // 色設定: IMC(LIFR/IFR)=赤, MVFR=紫
  function getMeshColor(rule) {
    if (!rule) return null;
    const r = rule.toUpperCase();
    if (r === "LIFR" || r === "IFR") return "#FF0000"; 
    if (r === "MVFR") return "#800080"; 
    return null; // VFRは塗らない
  }

  // メッシュ更新処理
  async function updateMeshes() {
    try {
      const res = await fetch(AIRPORTS_JSON);
      const data = await res.json();
      meshLayer.clearLayers();

      // 各空港について順次処理
      for (const f of data.features) {
        const icao = f.properties.icao;
        if (!icao) continue;

        // APIコール (window.avwxFetchMetarを利用)
        const metar = await window.avwxFetchMetar(icao);
        if (metar) {
          const color = getMeshColor(metar.flight_rules);
          if (color) {
            const lat = f.geometry.coordinates[1];
            const lon = f.geometry.coordinates[0];
            const size = 0.08; // 矩形のサイズ（約10km四方）
            
            L.rectangle(
              [[lat - size, lon - size], [lat + size, lon + size]],
              { color: color, weight: 0, fillOpacity: 0.35, stroke: false }
            ).addTo(meshLayer);
          }
        }
      }
    } catch(e) {
      console.error("Mesh update failed", e);
    }
  }

  // 初回実行 & 10分おきに更新
  updateMeshes();
  setInterval(updateMeshes, 600000);

  // --- 3. 地図上の凡例 (Legend) ---
  const legend = L.control({ position: 'bottomright' });
  legend.onAdd = function (map) {
    const div = L.DomUtil.create('div', 'map-legend');
    div.innerHTML = `
      <div style="font-weight:bold; border-bottom:1px solid #ccc; margin-bottom:4px;">Weather</div>
      <div style="display:flex; align-items:center; margin-bottom:2px;">
        <span style="background:#FF0000; width:12px; height:12px; display:inline-block; margin-right:6px; border:1px solid #ccc;"></span> IMC
      </div>
      <div style="display:flex; align-items:center;">
        <span style="background:#800080; width:12px; height:12px; display:inline-block; margin-right:6px; border:1px solid #ccc;"></span> MVFR
      </div>
    `;
    return div;
  };
  legend.addTo(map);
})();