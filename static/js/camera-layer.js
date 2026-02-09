// static/js/camera-layer.js
console.log("[CAM] init camera-layer.js (Merged)");

(function () {
  // -------------------------------------------------
  // カメラ定義
  // -------------------------------------------------
  const cameras = [
    
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
      id: "kasumigaura-asao",
      name: "霞ヶ浦 西浦：麻生沖",
      note: "茨城県行方市麻生沖（湖上）",
      lat: 35.965137,
      lng: 140.488645,
      bearing: 100,
      imageUrl: "https://www.ktr.mlit.go.jp/river/cctv/C03120.jpg"
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
      imageUrl: "https://www.ktr.mlit.go.jp/shimodate/livecamera/campicture/06_A.jpg"
    },
    {
      id: "r17-shinpuni",
      name: "R17 新三国トンネル新潟県側",
      note: "新潟県南魚沼郡湯沢町三国（立岩橋）",
      lat: 36.837,
      lng: 138.805,
      bearing: 160, 
      imageUrl: "https://www.ktr.mlit.go.jp/river/cctv/C01926.jpg"
    },
    {
      id: "r1-hakone-ibaragadaira",
      name: "R1 箱根 茨ヶ平",
      note: "箱根峠〜三島",
      lat: 35.158,
      lng: 139.006,
      bearing: 220, 
      imageUrl: "https://www.cbr.mlit.go.jp/numazu/kanogawa/cctv/snapshot/302.jpg"
    },
    {
      id: "r18-usui-karuizawa",
      name: "R18 碓氷バイパス 軽井沢橋",
      note: "長野県北佐久郡軽井沢町",
      lat: 36.329,
      lng: 138.647,
      bearing: 70, 
      imageUrl: "https://www.ktr.mlit.go.jp/river/cctv/C02000.jpg"
    },
    // --- 追加分 (夜叉神峠) ---
    {
      id: "yashajin-pass",
      name: "夜叉神峠 南アルプスライブカメラ",
      note: "山梨県南アルプス市芦安芦倉",
      lat: 35.6315,
      lng: 138.3585,
      bearing: 270, // 西向き（白峰三山方面）と推測
      imageUrl: "https://www.minamialps-net.jp/wp-content/themes/malps2019/images/top/Yashajin.jpg"
    },// --- 追加分 (大垂水峠) ---
    {
      id: "r20-otarumi",
      name: "R20 大垂水峠",
      note: "東京都八王子市〜神奈川県相模原市",
      lat: 35.623,
      lng: 139.273,
      bearing: 270, // 西向き（峠方向）と推測
      imageUrl: "http://www.ktr.mlit.go.jp/river/cctv/C01671.jpg"
    },
  ];

  // 安全に初期化する関数
  function initCamera() {
    // 地図(navMap)の準備を待機
    if (typeof window.navMap === "undefined") {
      setTimeout(initCamera, 500);
      return;
    }

    const map = window.navMap;
    const layersControl = window.navLayersControl;
    const TAB_WIDTH = 320;
    const TAB_HEIGHT = 240;
    
    // アイコン作成用の共通関数
    function createArrowIcon(rotation) {
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
        return L.divIcon({
            className: "camera-arrow-icon",
            html: arrowHtml,
            iconSize: [12, 16],
            iconAnchor: [6, 8],
        });
    }

    const markers = [];
    
    cameras.forEach((cam) => {
      // 矢印の回転角度 (0=北)
      const rotation = cam.bearing || 0;
      const arrowIcon = createArrowIcon(rotation);
      const marker = L.marker([cam.lat, cam.lng], { icon: arrowIcon });

      marker.on("click", (e) => {
        // 既存のポップアップがあれば閉じる
        map.closePopup();

        const ts = new Date().getTime();
        // URLにクエリパラメータがすでにあるかチェック
        const separator = cam.imageUrl.includes("?") ? "&" : "?";
        // キャッシュバスティング
        const urlWithTs = `${cam.imageUrl}${separator}_=${ts}`;

        const popupHtml = `
          <div class="cam-popup-content" style="width:${TAB_WIDTH}px; font-family: sans-serif;">
            <div style="
              display:flex; justify-content:space-between; align-items:center;
              margin-bottom:6px; border-bottom:1px solid #ccc; padding-bottom:4px;
            ">
              <span style="font-weight:bold; font-size:14px;">${cam.name}</span>
              <button class="cam-popup-close" style="cursor:pointer; border:1px solid #999; background:#fff; border-radius:4px; font-weight:bold; padding:0 4px;">×</button>
            </div>
            
            <div style="
              width: 100%;
              min-height: ${TAB_HEIGHT}px;
              display: flex; align-items: center; justify-content: center;
              background: #000; margin-bottom: 4px;
            ">
              <img src="${urlWithTs}" alt="${cam.name}" 
                   style="max-width: 100%; max-height: 100%; object-fit: contain; display:block;"
                   onerror="this.onerror=null;this.parentElement.innerHTML='<span style=\'color:white;font-size:12px\'>Image Load Error</span>';">
            </div>
            
            ${cam.note ? `<div style="font-size:11px; color:#555;">${cam.note}</div>` : ""}
          </div>
        `;

        const popup = L.popup({
          maxWidth: TAB_WIDTH + 20,
          closeButton: false,
          autoPan: true,
          className: "cam-popup",
          offset: [0, -10]
        })
        .setLatLng([cam.lat, cam.lng])
        .setContent(popupHtml)
        .openOn(map);

        // ポップアップが開いた後のイベント処理（閉じるボタン）
        // Leafletのpopupopenイベント、またはsetTimeoutでDOM取得
        setTimeout(() => {
          const container = popup.getElement();
          if (!container) return;
          const btn = container.querySelector(".cam-popup-close");
          if (btn) {
            btn.addEventListener("click", (ev) => {
              ev.stopPropagation(); // マップクリックへの伝播防止
              map.closePopup();
            });
          }
        }, 50);
      });

      markers.push(marker);
    });

    const cameraLayer = L.layerGroup(markers);

    if (layersControl) {
      // 名称をシンプルに「ライブカメラ」としました
      layersControl.addOverlay(cameraLayer, "ライブカメラ");
    } else {
      cameraLayer.addTo(map);
    }
    console.log("[CAM] camera layer added (" + markers.length + " cameras)");
  }

  // 読み込み完了後に初期化開始
  if (document.readyState === "complete" || document.readyState === "interactive") {
      setTimeout(initCamera, 100);
  } else {
      window.addEventListener("load", initCamera);
  }
})();