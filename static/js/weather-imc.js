// static/js/weather-imc.js
console.log("[IMC] init weather-imc.js (30nm Cells)");

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

  // 2. メッシュ描画レイヤー
  const meshLayer = L.layerGroup();
  meshLayer.addTo(map);

  // レイヤーコントロールへの追加
  const addLayerToControl = () => {
    if (window.navLayersControl) {
      window.navLayersControl.addOverlay(meshLayer, "気象情報 (IMC/MVFR)");
    } else {
      setTimeout(addLayerToControl, 200);
    }
  };
  addLayerToControl();

  const AIRPORTS_JSON = "/static/data/jp_apt.geojson";

  function getMeshColor(rule) {
    if (!rule) return null;
    const r = rule.toUpperCase();
    if (r === "LIFR" || r === "IFR") return "#FF0000"; 
    if (r === "MVFR") return "#800080"; 
    return null;
  }

  async function updateMeshes() {
    try {
      const res = await fetch(AIRPORTS_JSON);
      const data = await res.json();
      meshLayer.clearLayers();

      for (const f of data.features) {
        const icao = f.properties.icao;
        if (!icao) continue;

        const metar = await window.avwxFetchMetar(icao);
        if (metar) {
          const color = getMeshColor(metar.flight_rules);
          if (color) {
            const lat = f.geometry.coordinates[1];
            const lon = f.geometry.coordinates[0];
            
            // ★変更箇所: 30nm ≒ 0.5度
            const size = 0.5; 
            
            L.rectangle(
              [[lat - size, lon - size], [lat + size, lon + size]],
              { color: color, weight: 0, fillOpacity: 0.35, stroke: false }
            ).addTo(meshLayer);
          }
        }
      }
    } catch(e) {
      console.error("Mesh update error", e);
    }
  }

  updateMeshes();
  setInterval(updateMeshes, 300000);

  // 3. 凡例
  const legend = L.control({ position: 'bottomright' });
  legend.onAdd = function (map) {
    const div = L.DomUtil.create('div', 'map-legend');
    div.innerHTML = `
      <div style="font-weight:bold; border-bottom:1px solid #ccc; margin-bottom:4px; font-size:11px;">Weather</div>
      <div style="font-size:11px; margin-bottom:2px;"><i style="background:#FF0000; width:10px; height:10px; float:left; margin-right:6px; border:1px solid #ccc;"></i> IMC</div>
      <div style="font-size:11px;"><i style="background:#800080; width:10px; height:10px; float:left; margin-right:6px; border:1px solid #ccc;"></i> MVFR</div>
    `;
    return div;
  };
  legend.addTo(map);
})();