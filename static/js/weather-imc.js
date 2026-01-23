// static/js/weather-imc.js
console.log("[IMC] init weather-imc.js (Mesh Colors & Legend)");

(function() {
  const map = window.navMap;
  if (!map) return;

  // フライトカテゴリー判定
  function getFlightCategory(ceil, vis) {
    if (ceil < 500 || vis < 1600) return 'LIFR';
    if (ceil < 1000 || vis < 5000) return 'IFR';
    if (ceil <= 3000 || vis <= 8000) return 'MVFR';
    return 'VFR';
  }

  // ★メッシュの色設定（指示通り：IMC=赤, MVFR=紫）
  function getMeshColor(cat) {
    switch (cat) {
      case 'LIFR': return '#FF0000'; // IMC (Red)
      case 'IFR':  return '#FF0000'; // IMC (Red)
      case 'MVFR': return '#800080'; // MVFR (Purple)
      default:     return null;      // VFR等は塗らない
    }
  }

  const markerGroup = L.layerGroup().addTo(map); // 空港アイコン用
  const meshGroup = L.layerGroup().addTo(map);   // メッシュ用
  const AIRPORTS_JSON = "/static/data/jp_apt.geojson";
  
  // 1. 空港マーカーの描画（色分けなし・グレー固定）
  fetch(AIRPORTS_JSON)
    .then(r => r.json())
    .then(data => {
      data.features.forEach(f => {
        const lat = f.geometry.coordinates[1];
        const lon = f.geometry.coordinates[0];
        const props = f.properties;

        // 常にグレーで描画
        const m = L.circleMarker([lat, lon], {
          radius: 5,
          fillColor: '#808080', 
          color: "#000",
          weight: 1,
          opacity: 1,
          fillOpacity: 0.8
        });

        m.icao = props.icao; // データを保持（メッシュ描画用）
        m.bindPopup(`<strong>${props.icao || ""} / ${props.name}</strong>`);

        // クリック時の地点登録連携
        m.on('click', (e) => {
          if (window.routeMode === 'pick' && typeof window.handlePointPick === 'function') {
            e.target.closePopup();
            L.DomEvent.stop(e);
            window.handlePointPick([lat, lon], props.icao || props.name || "Airport");
          }
        });

        markerGroup.addLayer(m);
      });

      // マーカー描画後にメッシュを描画
      updateImcMesh();
    })
    .catch(e => console.error("Apt load fail", e));

  // 2. メッシュの描画（空港アイコンの色は変えずに、周囲に矩形を描く）
  async function updateImcMesh() {
    meshGroup.clearLayers();

    // 各空港マーカーの位置を基準にメッシュを描く
    markerGroup.eachLayer(async (layer) => {
      const icao = layer.icao;
      if (!icao) return;

      try {
        // バックエンドからMETAR取得
        const res = await fetch(`/api/metar?icao=${icao}`);
        if (!res.ok) return;
        const metar = await res.json();
        if (!metar.raw_text) return;

        let ceiling = 99999;
        if (metar.clouds) {
            const cigs = metar.clouds
                .filter(c => c.cover === 'BKN' || c.cover === 'OVC')
                .map(c => c.base);
            if (cigs.length > 0) ceiling = Math.min(...cigs);
        }
        let vis = 99999;
        if (metar.visibility && metar.visibility.meters) {
            vis = metar.visibility.meters;
        }

        const cat = getFlightCategory(ceiling, vis);
        const color = getMeshColor(cat);

        // IMCまたはMVFRの場合のみメッシュ（矩形）を描画
        if (color) {
          const lat = layer.getLatLng().lat;
          const lon = layer.getLatLng().lng;
          const size = 0.1; // メッシュサイズ（度）
          
          L.rectangle(
            [[lat - size, lon - size], [lat + size, lon + size]],
            { color: color, weight: 0, fillOpacity: 0.3 }
          ).addTo(meshGroup);
        }

        // ※空港アイコン自体の色は変更しない

      } catch (e) { }
    });
  }

  // 3. 地図の片隅に凡例を追加 (Leaflet Control)
  const legend = L.control({ position: 'bottomright' });

  legend.onAdd = function (map) {
    const div = L.DomUtil.create('div', 'info legend map-legend');
    div.innerHTML = `
      <div style="font-weight:bold; margin-bottom:5px;">METAR</div>
      <div class="legend-item"><i style="background:#FF0000"></i> IMC</div>
      <div class="legend-item"><i style="background:#800080"></i> MVFR</div>
    `;
    return div;
  };

  legend.addTo(map);

  // 定期更新
  setInterval(updateImcMesh, 300000);
})();