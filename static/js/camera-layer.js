// static/js/camera-layer.js
console.log("[CAM] init camera-layer.js");

(function () {
  // ====== 前提：map-core.js で navMap / navLayersControl を公開済み ======
  const map = window.navMap;
  const layersCtl = window.navLayersControl;

  if (!map || !layersCtl) {
    console.warn("[CAM] navMap または navLayersControl が未定義です。map-core.js の読み込み順を確認してください。");
    return;
  }

  // ====== ライブカメラ定義 ======
  // lat / lng と imageUrl は必要に応じて修正してください。
  // imageUrl は静止画(JPEG/PNG)が直接取得できる URL を想定しています。
  const cameras = [
    // --- 霞ヶ浦（北浦 / 西浦）系 ---
    {
      id: "kasumigaura-jingu",
      name: "霞ヶ浦 北浦：神宮橋",
      note: "茨城県鹿嶋市大船津（左岸0.2k）",
      lat: 35.956,      // ★必要に応じて修正してください
      lng: 140.640,     // ★必要に応じて修正してください
      bearing: 180,     // カメラの向き（°）南向きイメージ
      imageUrl: "https://example.com/kasumigaura/jingu.jpg" // ★実際の静止画URLに変更してください
    },
    {
      id: "kasumigaura-oyama",
      name: "霞ヶ浦 西浦：大山(下)",
      note: "茨城県稲敷郡美浦村大山（右岸27.4k）",
      lat: 36.000,      // ★要修正
      lng: 140.300,     // ★要修正
      bearing: 135,
      imageUrl: "https://example.com/kasumigaura/oyama.jpg"
    },
    {
      id: "kasumigaura-asao",
      name: "霞ヶ浦 西浦：麻生沖",
      note: "茨城県行方市麻生沖（湖上）",
      lat: 36.030,      // ★要修正
      lng: 140.450,     // ★要修正
      bearing: 225,
      imageUrl: "https://example.com/kasumigaura/asao.jpg"
    },

    // --- 荒川・高麗川・入間川系 ---
    {
      id: "arakawa-minamihata",
      name: "荒川：南畑水質観測所",
      note: "埼玉県富士見市南畑新田",
      lat: 35.870,      // ★要修正
      lng: 139.550,     // ★要修正
      bearing: 90,
      imageUrl: "https://example.com/arakawa/minamihata.jpg"
    },
    {
      id: "komagawa-koma",
      name: "高麗川：高麗川橋",
      note: "埼玉県坂戸市中里",
      lat: 35.970,      // ★要修正
      lng: 139.390,     // ★要修正
      bearing: 120,
      imageUrl: "https://example.com/komagawa/koma.jpg"
    },
    {
      id: "arakawa-kawagoe-line",
      name: "荒川：JR川越線",
      note: "埼玉県川越市古谷本郷",
      lat: 35.920,      // ★要修正
      lng: 139.480,     // ★要修正
      bearing: 150,
      imageUrl: "https://example.com/arakawa/kawagoe-line.jpg"
    },
    {
      id: "iruma-ohashi",
      name: "入間川：入間大橋",
      note: "埼玉県川越市中老袋",
      lat: 35.910,      // ★要修正
      lng: 139.510,     // ★要修正
      bearing: 160,
      imageUrl: "https://example.com/iruma/ohashi.jpg"
    },

    // --- 江戸川河川事務所エリア（代表的な数点のみ例示） ---
    {
      id: "sekijuku-jo",
      name: "江戸川：関宿城",
      note: "千葉県野田市関宿三軒家",
      lat: 36.040,      // ★要修正
      lng: 139.800,     // ★要修正
      bearing: 210,
      imageUrl: "https://example.com/edogawa/sekijuku-jo.jpg"
    },
    {
      id: "edogawa-koyama",
      name: "江戸川：流山市小屋",
      note: "千葉県流山市小屋",
      lat: 35.880,      // ★要修正
      lng: 139.880,     // ★要修正
      bearing: 180,
      imageUrl: "https://example.com/edogawa/koyama.jpg"
    },
    {
      id: "edogawa-inarigi",
      name: "江戸川：市川市稲荷木",
      note: "千葉県市川市稲荷木",
      lat: 35.710,      // ★要修正
      lng: 139.930,     // ★要修正
      bearing: 170,
      imageUrl: "https://example.com/edogawa/inarigi.jpg"
    },

    // --- 小貝川（上郷水位観測所） ---
    {
      id: "kokai-kamigo",
      name: "小貝川：上郷水位観測所",
      note: "茨城県（上郷付近）",
      lat: 36.230,      // ★要修正
      lng: 140.030,     // ★要修正
      bearing: 200,
      imageUrl: "https://example.com/kokai/kamigo.jpg"
    }
  ];

  // ====== カメラレイヤ作成 ======
  const cameraLayer = L.layerGroup();

  // 簡易アイコンの共通スタイル（CSSクラスを使わず inline style で完結させる）
  function createCameraIcon(bearingDeg) {
    const rot = (typeof bearingDeg === "number") ? bearingDeg : 0;

    const html =
      `<div style="
        width: 26px;
        height: 26px;
        border-radius: 50%;
        background: rgba(0,0,0,0.75);
        display: flex;
        align-items: center;
        justify-content: center;
        color: #fff;
        font-size: 14px;
        transform: rotate(${rot}deg);
      ">
        ▲
      </div>`;

    return L.divIcon({
      className: "camera-marker",
      html: html,
      iconSize: [26, 26],
      iconAnchor: [13, 13],
      popupAnchor: [0, -16]
    });
  }

  // ====== マーカー生成 ======
  cameras.forEach((cam) => {
    if (typeof cam.lat !== "number" || typeof cam.lng !== "number") {
      console.warn("[CAM] lat/lng 未設定のカメラをスキップ:", cam);
      return;
    }

    const icon = createCameraIcon(cam.bearing);

    const marker = L.marker([cam.lat, cam.lng], { icon });

    marker.on("click", () => {
      // 最新画像取得のためキャッシュバスターを付与
      let imgHtml = "";
      if (cam.imageUrl && cam.imageUrl.trim() !== "") {
        const base = cam.imageUrl.trim();
        const ts = Date.now();
        const url = base + (base.includes("?") ? "&" : "?") + "t=" + ts;

        imgHtml =
          `<img src="${url}"
                alt="${cam.name}"
                style="max-width:240px; max-height:160px; display:block; border-radius:4px; border:1px solid #ccc;">`;
      } else {
        imgHtml =
          `<div style="font-size:11px; color:#666;">
             画像URLが設定されていません（camera-layer.js 内 imageUrl を設定してください）。
           </div>`;
      }

      const popupHtml = `
        <div style="font-size:12px; max-width:260px;">
          <div style="font-weight:bold; margin-bottom:2px;">${cam.name}</div>
          ${cam.note ? `<div style="color:#555; margin-bottom:4px;">${cam.note}</div>` : ""}
          ${imgHtml}
        </div>
      `;

      marker.bindPopup(popupHtml, {
        maxWidth: 260,
        closeButton: true,
        autoPan: true
      }).openPopup();
    });

    marker.addTo(cameraLayer);
  });

  // デフォルト ON にする場合は addTo(map)
  cameraLayer.addTo(map);

  // レイヤーコントロールへ登録
  layersCtl.addOverlay(cameraLayer, "ライブカメラ");

  console.log("[CAM] camera-layer.js loaded. cameras:", cameras.length);
})();
