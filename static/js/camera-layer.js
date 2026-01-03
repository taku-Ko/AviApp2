// static/js/camera-layer.js
console.log("[CAM] init camera-layer.js");

(function () {
  // -------------------------------------------------
  // カメラ定義（ご提示のデータ）
  // -------------------------------------------------
  const cameras = [
    // --- 霞ヶ浦（北浦 / 西浦）系 ---
    {
      id: "kasumigaura-jingu",
      name: "霞ヶ浦 北浦：神宮橋",
      note: "茨城県鹿嶋市大船津（左岸0.2k）",
      lat: 35.955041,
      lng: 140.605467,
      bearing: 320,
      imageUrl: "https://www.ktr.mlit.go.jp/river/cctv/C03145.jpg"
    },
    {
      id: "kasumigaura-oyama",
      name: "霞ヶ浦 西浦：大山(下)",
      note: "茨城県稲敷郡美浦村大山（右岸27.4k）",
      lat: 36.009345,
      lng: 140.372863,
      bearing: 290,
      imageUrl: "https://www.ktr.mlit.go.jp/river/cctv/C03161.jpg"
    },
    {
      id: "kasumigaura-asao",
      name: "霞ヶ浦 西浦：麻生沖",
      note: "茨城県行方市麻生沖（湖上）",
      lat: 35.965137,
      lng: 140.488645,
      bearing: 100,
      imageUrl: "https://www.ktr.mlit.go.jp/river/cctv/C03120.jpg"
    },

    // --- 荒川・高麗川・入間川系 ---
    {
      id: "arakawa-minamihata",
      name: "荒川：南畑水質観測所",
      note: "埼玉県富士見市南畑新田",
      lat: 35.86310,
      lng: 139.57791,
      bearing: 90,
      imageUrl: "https://www.ktr.mlit.go.jp/arajo/realtime/cam/cam01.jpg"
    },
    {
      id: "komagawa-koma",
      name: "高麗川：高麗川橋",
      note: "埼玉県坂戸市中里",
      lat: 35.961407,
      lng: 139.381936,
      bearing: 90,
      imageUrl: "https://www.ktr.mlit.go.jp/arajo/realtime/cam/cam27.jpg"
    },
    {
      id: "arakawa-kawagoe-line",
      name: "荒川：JR川越線",
      note: "埼玉県川越市古谷本郷",
      lat: 35.903834,
      lng: 139.551376,
      bearing: 100,
      imageUrl: "https://www.ktr.mlit.go.jp/arajo/realtime/cam/cam03.jpg"
    },
    {
      id: "iruma-ohashi",
      name: "入間川：入間大橋",
      note: "埼玉県川越市中老袋",
      lat: 35.942889,
      lng: 139.533654,
      bearing: 170,
      imageUrl: "https://www.ktr.mlit.go.jp/arajo/realtime/cam/cam09.jpg"
    },

    // --- 江戸川河川事務所エリア ---
    {
      id: "sekijuku-jo",
      name: "江戸川：関宿城",
      note: "千葉県野田市関宿三軒家",
      lat: 36.112721,
      lng: 139.777169,
      bearing: 170,
      imageUrl: "https://www.ktr.mlit.go.jp/edogawa/saigai/live/camera/img/p_sekiyado.jpg"
    },
    {
      id: "edogawa-inarigi",
      name: "江戸川：市川市稲荷木",
      note: "千葉県市川市稲荷木",
      lat: 35.711757,
      lng: 139.914804,
      bearing: 280,
      imageUrl: "https://www.ktr.mlit.go.jp/edogawa/saigai/live/camera/img/p_3.5hidari.jpg"
    },

    // --- 小貝川（上郷水位観測所） ---
    {
      id: "kokai-kamigo",
      name: "小貝川：上郷水位観測所",
      note: "茨城県（上郷付近）",
      lat: 36.10704,
      lng: 139.99879,
      bearing: 90,
      imageUrl: "https://www.ktr.mlit.go.jp/shimodate/livecamera/campicture/06_A.jpg?1766482193175"
    }
  ];

  // 安全に初期化する関数
  function initCamera() {
    // 地図(navMap)の準備を待機（これがエラー回避の鍵です）
    if (typeof window.navMap === "undefined") {
      setTimeout(initCamera, 500);
      return;
    }

    const map = window.navMap;
    const layersControl = window.navLayersControl;
    const TAB_WIDTH = 320;
    const TAB_HEIGHT = 240;

    const markers = cameras.map((cam) => {
      // 矢印の回転角度 (0=北)
      const rotation = cam.bearing || 0;

      // CSSで二等辺三角形（黒矢印）を作成
      const arrowHtml = `
        <div style="
          width: 0; 
          height: 0; 
          border-left: 6px solid transparent;
          border-right: 6px solid transparent;
          border-bottom: 16px solid black; 
          transform: rotate(${rotation}deg);
          transform-origin: center center;
          opacity: 0.9;
          filter: drop-shadow(0px 0px 2px rgba(255,255,255,1));
        "></div>
      `;

      const arrowIcon = L.divIcon({
        className: "camera-arrow-icon",
        html: arrowHtml,
        iconSize: [12, 16], // アイコンサイズ
        iconAnchor: [6, 8], // 中心点
      });

      const marker = L.marker([cam.lat, cam.lng], { icon: arrowIcon });

      marker.on("click", () => {
        const ts = new Date().getTime();
        const separator = cam.imageUrl.includes("?") ? "&" : "?";
        const urlWithTs = `${cam.imageUrl}${separator}_=${ts}`;

        const popupHtml = `
          <div class="cam-popup-content" style="width:${TAB_WIDTH}px;">
            <div style="
              display:flex; justify-content:space-between; align-items:center;
              margin-bottom:6px; border-bottom:1px solid #ccc; padding-bottom:4px;
            ">
              <span style="font-weight:bold; font-size:14px;">${cam.name}</span>
              <button class="cam-popup-close" style="cursor:pointer; border:1px solid #999; background:#fff; border-radius:4px;">×</button>
            </div>
            
            <div style="
              width: 100%;
              height: ${TAB_HEIGHT}px;
              display: flex; align-items: center; justify-content: center;
              background: #000; margin-bottom: 4px;
            ">
              <img src="${urlWithTs}" alt="${cam.name}" 
                   style="max-width: 100%; max-height: 100%; object-fit: contain;">
            </div>
            
            ${cam.note ? `<div style="font-size:11px; color:#555;">${cam.note}</div>` : ""}
          </div>
        `;

        const popup = L.popup({
          maxWidth: TAB_WIDTH + 20,
          closeButton: false,
          autoPan: true,
          className: "cam-popup",
        })
        .setLatLng([cam.lat, cam.lng])
        .setContent(popupHtml)
        .openOn(map);

        setTimeout(() => {
          const container = popup.getElement();
          if (!container) return;
          const btn = container.querySelector(".cam-popup-close");
          if (btn) {
            btn.addEventListener("click", () => {
              map.closePopup(popup);
            });
          }
        }, 100);
      });

      return marker;
    });

    const cameraLayer = L.layerGroup(markers);

    if (layersControl) {
      layersControl.addOverlay(cameraLayer, "Live Cameras");
    } else {
      cameraLayer.addTo(map);
    }
    console.log("[CAM] camera layer added");
  }

  // 読み込み完了後に初期化開始
  window.addEventListener("load", initCamera);
})();