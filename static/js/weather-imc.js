// static/js/weather-imc.js
console.log("[IMC] init weather-imc.js (Overlay integrated)");

(function() {
  const map = window.navMap;
  if (!map) return;

  // 1. グローバルMETAR取得関数
  window.avwxFetchMetar = async function(icao) {
    if (!icao) return null;
    try {
      const res = await fetch(`/api/metar?icao=${icao}`);
      if (!res.ok) return null;
      const data = await res.json();
      
      if (data.raw_text) {
        let rule = "VFR";
        let ceiling = 99999;
        let vis = 99999;

        if (data.clouds) {
          const cigs = data.clouds
            .filter(c => c.cover === 'BKN' || c.cover === 'OVC')
            .map(c => c.base);
          if (cigs.length > 0) ceiling = Math.min(...cigs);
        }
        if (data.visibility && data.visibility.meters) {
          vis = parseFloat(data.visibility.meters);
        }

        if (ceiling < 500 || vis < 1600) rule = "LIFR";
        else if (ceiling < 1000 || vis < 5000) rule = "IFR";
        else if (ceiling <= 3000 || vis <= 8000) rule = "MVFR";

        return {
          flight_rules: rule,
          raw: data.raw_text,
          time: data.observation_time
        };
      }
      return null;
    } catch (e) {
      return null;
    }
  };

  // 2. メッシュレイヤー作成
  const meshGroup = L.layerGroup();
  
  // デフォルトで地図に追加（表示状態にする）
  meshGroup.addTo(map);

  // ★重要: 地図右上のレイヤーコントロールに「気象情報」として追加
  // map-core.js で window.navLayersControl が作られている前提
  // 少し遅延させて、map-core.jsの処理完了を待つと確実です
  setTimeout(() => {
    if (window.navLayersControl) {
      window.navLayersControl.addOverlay(meshGroup, "気象情報 (IMC/MVFR)");
    }
  }, 500);

  const AIRPORTS_JSON = "/static/data/jp_apt.geojson";

  function getMeshColor(rule) {
    if (rule === "LIFR" || rule === "IFR") return "#FF0000"; 
    if (rule === "MVFR") return "#800080"; 
    return null;
  }

  async function updateMeshes() {
    try {
      const res = await fetch(AIRPORTS_JSON);
      const data = await res.json();
      meshGroup.clearLayers();

      for (const f of data.features) {
        const icao = f.properties.icao;
        if (!icao) continue;

        const metar = await window.avwxFetchMetar(icao);
        if (metar) {
          const color = getMeshColor(metar.flight_rules);
          if (color) {
            const lat = f.geometry.coordinates[1];
            const lon = f.geometry.coordinates[0];
            
            L.rectangle(
              [[lat - 0.08, lon - 0.08], [lat + 0.08, lon + 0.08]],
              { color: color, weight: 0, fillOpacity: 0.35, stroke: false }
            ).addTo(meshGroup);
          }
        }
      }
    } catch(e) {}
  }

  updateMeshes();
  setInterval(updateMeshes, 300000);

  // 3. 地図上の凡例
  const legend = L.control({ position: 'bottomright' });
  legend.onAdd = function (map) {
    const div = L.DomUtil.create('div', 'map-legend');
    div.innerHTML = `
      <div style="font-weight:bold; border-bottom:1px solid #ccc; margin-bottom:4px;">Weather</div>
      <div><i style="background:#FF0000"></i> IMC</div>
      <div><i style="background:#800080"></i> MVFR</div>
    `;
    return div;
  };
  legend.addTo(map);
})();