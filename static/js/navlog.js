// static/js/navlog.js

// ... (前半のコードは変更なし) ...

  // ====== GFS から中心1点だけ風を取得し、全レグに適用 ======
  async function fetchLegWinds(legs, altFt, allPoints) {
    const uiDirEl = document.getElementById("windDir");
    const uiSpdEl = document.getElementById("windSpd");
    
    // 現在のUI入力値を取得（フォールバック用）
    const uiDir = parseFloat(uiDirEl?.value);
    const uiSpd = parseFloat(uiSpdEl?.value);

    // フォールバック：UI に入力された風を全レグに適用する関数
    const fallbackAll = () => {
      const out = {};
      if (Number.isFinite(uiDir) && Number.isFinite(uiSpd)) {
        legs.forEach((_, i) => {
          out[i] = { dir: uiDir, spd: uiSpd };
        });
      }
      return out;
    };

    if (typeof window.fetchGfsWindAt !== "function") {
      console.warn("[NAVLOG] fetchGfsWindAt not found, using UI wind only");
      return fallbackAll();
    }

    try {
      // 出発地・経由地・目的地を含む全地点から「中心」を計算
      let sumLat = 0;
      let sumLon = 0;
      let count = 0;

      if (Array.isArray(allPoints) && allPoints.length > 0) {
        allPoints.forEach((p) => {
          const ll = p.latlng;
          if (Array.isArray(ll) && typeof ll[0] === "number" && typeof ll[1] === "number") {
            sumLat += ll[0];
            sumLon += ll[1];
            count++;
          }
        });
      }

      // allPoints が空だった場合の保険
      if (count === 0 && Array.isArray(legs) && legs.length > 0) {
        legs.forEach((leg) => {
          const m = leg.mid;
          if (Array.isArray(m) && typeof m[0] === "number" && typeof m[1] === "number") {
            sumLat += m[0];
            sumLon += m[1];
            count++;
          }
        });
      }

      if (count === 0) {
        // ポイントが無ければ取得できないのでUI値を使用
        return fallbackAll();
      }

      const centerLat = sumLat / count;
      const centerLon = sumLon / count;

      // ★ここで 1 回だけ /api/gfs_wind を叩いて、中心1点の風を取得
      const gfs = await window.fetchGfsWindAt(centerLat, centerLon, altFt);

      const out = {};
      if (gfs && Number.isFinite(gfs.dir) && Number.isFinite(gfs.spd)) {
        
        // 【追加修正】 取得成功時、UIの入力欄に自動入力（反映）する
        if (uiDirEl && uiSpdEl) {
          uiDirEl.value = Math.round(gfs.dir); // 整数に丸めて表示
          uiSpdEl.value = Math.round(gfs.spd);
        }

        // 全レグにこの風を適用
        legs.forEach((_, i) => {
          out[i] = { dir: gfs.dir, spd: gfs.spd };
        });
        return out;
      }

      // GFS が取れなければ UI フォールバック
      return fallbackAll();

    } catch (e) {
      console.warn("[NAVLOG] GFS wind fetch failed, using UI wind only:", e);
      return fallbackAll();
    }
  }

// ... (後半の showNavLog 等のコードは変更なし) ...
