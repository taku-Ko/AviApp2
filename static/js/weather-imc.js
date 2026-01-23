console.log("[IMC] init weather-imc.js (Clean Logic)");

(function() {
  const map = window.navMap;
  if (!map) return;

  const MESH_STEP = 0.16; // 約10nm (グリッドサイズ)
  const RANGE_LIMIT_M = 55560; // 30nm ≒ 55560m
  const AIRPORTS_JSON = "/static/data/jp_apt.geojson";
  
  const meshLayer = L.layerGroup().addTo(map);
  let allAirports = [];
  let metarCache = {};

  // レイヤーコントロールへ追加
  const addLayerToControl = () => {
    if (window.navLayersControl) {
      window.navLayersControl.addOverlay(meshLayer, "気象情報 (IMC/MVFR)");
    } else {
      setTimeout(addLayerToControl, 500);
    }
  };
  addLayerToControl();

  // --- 1. METAR取得 ---
  window.avwxFetchMetar = async function(icao) {
    if (!icao) return null;
    try {
      const res = await fetch(`/api/metar?icao=${icao}`);
      if (!res.ok) return null;
      const data = await res.json();
      return data.raw ? data : null;
    } catch (e) { return null; }
  };

  async function fetchAllMetars() {
    // 負荷分散のため同時リクエスト数を制限
    const queue = [...allAirports];
    const worker = async () => {
      while (queue.length) {
        const apt = queue.shift();
        if (metarCache[apt.icao]) continue; // キャッシュ済みならスキップ

        const data = await window.avwxFetchMetar(apt.icao);
        if (data && data.flight_rules) {
          metarCache[apt.icao] = data.flight_rules;
          updateGrid(); // 1件取得するたびに描画更新
        }
      }
    };
    // 4並列で実行
    for(let i=0; i<4; i++) worker();
  }

  // --- 2. データ読み込み ---
  async function init() {
    try {
      const res = await fetch(AIRPORTS_JSON);
      const data = await res.json();
      
      // GeoJSONのプロパティを確認して整形
      allAirports = data.features.map(f => {
        const p = f.properties;
        // jp_apt.geojson の構造に合わせて取得 (map-core.jsの実装を参考に icaoCode > icao > ident の順)
        const code = p.icaoCode || p.icao || p.ident;
        return {
          icao: code,
          latlng: L.latLng(f.geometry.coordinates[1], f.geometry.coordinates[0])
        };
      }).filter(a => a.icao);

      generateGrid();
      fetchAllMetars();
    } catch(e) {
      console.error("[IMC] Init failed", e);
    }
  }

  // --- 3. グリッド生成・更新 ---
  // 色決定ロジック (VFRはnull=塗らない)
  function getColor(rule) {
    if (!rule) return null;
    const r = rule.toUpperCase();
    if (r === "LIFR" || r === "IFR") return "#FF0000"; // 赤
    if (r === "MVFR") return "#800080"; // 紫
    return null;
  }

  // グリッド生成（各セルの最寄り空港を判定して描画）
  function generateGrid() {
    meshLayer.clearLayers();
    if (!allAirports.length) return;

    const bounds = map.getBounds();
    const south = Math.floor(bounds.getSouth() / MESH_STEP) * MESH_STEP;
    const north = Math.ceil(bounds.getNorth() / MESH_STEP) * MESH_STEP;
    const west = Math.floor(bounds.getWest() / MESH_STEP) * MESH_STEP;
    const east = Math.ceil(bounds.getEast() / MESH_STEP) * MESH_STEP;

    for (let lat = south; lat <= north; lat += MESH_STEP) {
      for (let lon = west; lon <= east; lon += MESH_STEP) {
        
        const cellCenter = L.latLng(lat + MESH_STEP/2, lon + MESH_STEP/2);
        
        // 最寄り空港を探索
        let nearest = null;
        let minDist = Infinity;
        
        for (const apt of allAirports) {
          const d = cellCenter.distanceTo(apt.latlng); // Leaflet標準の距離計算(m)
          if (d < minDist) {
            minDist = d;
            nearest = apt;
          }
        }

        // 30nm (55560m) 以内ならセルを作成
        if (nearest && minDist <= RANGE_LIMIT_M) {
          const rect = L.rectangle(
            [[lat, lon], [lat + MESH_STEP, lon + MESH_STEP]],
            { weight: 0, fillOpacity: 0, interactive: false }
          );
          rect.nearestIcao = nearest.icao;
          meshLayer.addLayer(rect);
        }
      }
    }
    updateGrid();
  }

  // 現在のMETAR状況に合わせて色を反映
  function updateGrid() {
    meshLayer.eachLayer(layer => {
      const rule = metarCache[layer.nearestIcao];
      const color = getColor(rule);
      if (color) {
        layer.setStyle({ color: color, fillOpacity: 0.35 });
      } else {
        layer.setStyle({ fillOpacity: 0 }); // VFR or データなしは透明
      }
    });
  }

  // イベント
  map.on('moveend', generateGrid);
  
  // 定期更新 (10分)
  setInterval(() => {
    metarCache = {};
    fetchAllMetars();
  }, 600000);

  // 開始
  init();

  // 凡例
  const legend = L.control({ position: 'bottomright' });
  legend.onAdd = () => {
    const d = L.DomUtil.create('div', 'map-legend');
    d.innerHTML = `
      <div style="font-weight:bold;font-size:11px;border-bottom:1px solid #ccc;">Weather</div>
      <div style="font-size:11px;"><i style="background:#FF0000;width:10px;height:10px;float:left;margin-right:4px;"></i>IMC</div>
      <div style="font-size:11px;"><i style="background:#800080;width:10px;height:10px;float:left;margin-right:4px;"></i>MVFR</div>
    `;
    return d;
  };
  legend.addTo(map);
})();