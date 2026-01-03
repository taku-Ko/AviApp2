// static/js/camera-layer.js
console.log("[CAM] init camera-layer.js");

(function() {
  function initCamera() {
    // 地図がまだ無ければ少し待つ
    if (typeof window.navMap === "undefined") {
      console.log("[CAM] waiting for navMap...");
      setTimeout(initCamera, 500);
      return;
    }

    const map = window.navMap;
    const layersControl = window.navLayersControl;

    // Webカメラレイヤ定義 (以下変更なし)
    const cameraIcon = L.divIcon({
      className: "camera-icon",
      html: "📷",
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    });

    // 簡易的なカメラデータ（実際は外部JSONなどから読む想定）
    const cameras = [
      { lat: 35.549, lon: 139.779, name: "Haneda Live Cam" },
      { lat: 42.775, lon: 141.692, name: "New Chitose Live Cam" },
    ];

    const markers = cameras.map(c => {
      return L.marker([c.lat, c.lon], { icon: cameraIcon })
        .bindPopup(`<b>${c.name}</b><br><a href="#" onclick="alert('Demo: open camera url');return false;">View</a>`);
    });

    const cameraLayer = L.layerGroup(markers);

    if (layersControl) {
      layersControl.addOverlay(cameraLayer, "Web Cameras");
    } else {
      cameraLayer.addTo(map);
    }
    console.log("[CAM] camera layer added");
  }

  // ページ読み込み完了後に実行
  window.addEventListener("load", initCamera);
})();
