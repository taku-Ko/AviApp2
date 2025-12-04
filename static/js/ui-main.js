// static/js/ui-main.js
console.log("[UI] init ui-main.js");

(function () {
  const map = window.navMap;

  if (!map) {
    console.error("[UI] navMap が未定義です");
    return;
  }

  // ====== タブ切替 ======
  function showTab(tab) {
    document.getElementById("inputTab").style.display =
      tab === "input" ? "block" : "none";
    document.getElementById("resultsTab").style.display =
      tab === "results" ? "block" : "none";
    document.body.classList.toggle("results-layout", tab === "results");
    setTimeout(() => map.invalidateSize(), 80);
    if (tab === "results") setTimeout(window.fitNavGrid || (() => {}), 0);
  }
  window.showTab = showTab;

  // ====== ルートモード切替 ======
  let routeMode = "text";
  function getRouteMode() {
    return routeMode;
  }
  function setRouteMode(mode) {
    routeMode = mode;

    document
      .getElementById("mode-text")
      .classList.toggle("active", mode === "text");
    document
      .getElementById("mode-pick")
      .classList.toggle("active", mode === "pick");

    document.getElementById("text-route-panel").style.display =
      mode === "text" ? "block" : "none";
    document.getElementById("pick-route-panel").style.display =
      mode === "pick" ? "block" : "none";

    document.getElementById("modeHint").textContent =
      mode === "text"
        ? "現在：地名入力モード"
        : "現在：地図クリックモード（クリックで順番登録）";

    document.getElementById("plot-button-bar").style.display =
      mode === "text" ? "block" : "none";
    document.getElementById("pick-run-bar").style.display =
      mode === "pick" ? "block" : "none";

    if (mode === "pick") map.closePopup();
  }
  window.setRouteMode = setRouteMode;
  window.getRouteMode = getRouteMode;

  // ====== 地名入力モード ======
  let markers = [];
  let routeLine = null;

  function addWaypoint() {
    const count =
      document.querySelectorAll("#waypoints input").length + 1;
    const div = document.createElement("div");
    div.className = "input-group";
    div.innerHTML = `<label>経由地 ${count}:</label>
      <input type="text" id="waypoint${count}" placeholder="例：仙台空港">`;
    document.getElementById("waypoints").appendChild(div);
  }
  window.addWaypoint = addWaypoint;

  async function geocode(q) {
    q = (q || "").trim();
    if (!q) return null;

    const fetchTO = (url, ms = 6000) => {
      const ac = new AbortController();
      const id = setTimeout(() => ac.abort(), ms);
      return fetch(url, {
        headers: { Accept: "application/json" },
        signal: ac.signal,
      }).finally(() => clearTimeout(id));
    };

    try {
      const r = await fetchTO(
        `https://nominatim.openstreetmap.org/search?format=json&accept-language=ja&limit=1&q=${encodeURIComponent(
          q
        )}`
      );
      if (r.ok) {
        const d = await r.json();
        if (Array.isArray(d) && d.length > 0) {
          return {
            latlng: [+d[0].lat, +d[0].lon],
            disp: d[0].display_name || q,
          };
        }
      }
    } catch (_) {}

    try {
      const r = await fetchTO(
        `https://photon.komoot.io/api/?q=${encodeURIComponent(
          q
        )}&lang=ja&limit=1`
      );
      if (r.ok) {
        const d = await r.json();
        if (d?.features?.length) {
          const f = d.features[0];
          const c = f.geometry?.coordinates;
          if (Array.isArray(c)) {
            return {
              latlng: [c[1], c[0]],
              disp:
                f.properties?.name ||
                f.properties?.city ||
                f.properties?.country ||
                q,
            };
          }
        }
      }
    } catch (_) {}

    alert(`位置取得失敗: ${q}`);
    return null;
  }

  // ====== 地図クリックモード ======
  const pickedSeq = []; // {latlng:[lat,lon], name:string, _marker:L.Marker}

  function updatePickList() {
    const box = document.getElementById("pickedList");
    if (!box) return;

    if (pickedSeq.length === 0) {
      box.innerHTML =
        '<div style="font-size:12px;color:#777;">まだ地点がありません。</div>';
    } else {
      const rows = pickedSeq
        .map((p, i) => {
          const tag =
            i === 0
              ? "出発地"
              : i === pickedSeq.length - 1
              ? "目的地"
              : `経由地${i}`;
          return `<div class="row"><span class="tag">${tag}</span><span>${p.name}</span></div>`;
        })
        .join("");
      box.innerHTML = rows;
    }
    updatePickButtons();
  }

  function updatePickButtons() {
    const runBtn = document.getElementById("pick-run-bar");
    if (runBtn) {
      runBtn.disabled = pickedSeq.length < 2;
    }
  }

  function undoPick() {
    const last = pickedSeq.pop();
    if (last && last._marker) {
      map.removeLayer(last._marker);
    }
    updatePickList();
  }
  window.undoPick = undoPick;

  function clearPick() {
    pickedSeq.forEach((p) => p._marker && map.removeLayer(p._marker));
    pickedSeq.length = 0;
    updatePickList();
  }
  window.clearPick = clearPick;

  // map-core.js からも使えるようにする（APTクリック時）
  function addPickedPoint(latlng, label) {
    const idx = pickedSeq.length + 1;
    const name = label || `P${idx}`;
    const m = L.marker(latlng).addTo(map).bindPopup(name);
    pickedSeq.push({ latlng, name, _marker: m });
    updatePickList();
  }
  window.addPickedPoint = addPickedPoint;

  // 地図クリック（何もない場所をクリックしたとき）
  map.on("click", (e) => {
    if (routeMode !== "pick") return;
    // 空港や空域などのレイヤ上のクリックは、それぞれの onClick で処理
    // ここでは「素の地図」のクリックだけを想定
    addPickedPoint([e.latlng.lat, e.latlng.lng], `P${pickedSeq.length + 1}`);
  });

  // ====== ルート描画（地名入力） ======
  async function plotRoute() {
    try {
      if (routeLine) {
        map.removeLayer(routeLine);
        routeLine = null;
      }
      markers.forEach((m) => m && map.removeLayer(m));
      markers = [];

      const TAS = Math.max(
        10,
        parseFloat(document.getElementById("tas").value) || 120
      );
      const seq = [];

      const sTxt = document.getElementById("start").value.trim();
      if (sTxt) {
        const s = await geocode(sTxt);
        if (s) {
          seq.push({ label: "出発地", name: sTxt, latlng: s.latlng });
          markers.push(
            L.marker(s.latlng).addTo(map).bindPopup("出発地")
          );
        }
      }

      const textWps = Array.from(
        document.querySelectorAll("#waypoints input")
      )
        .map((i) => i.value.trim())
        .filter(Boolean);

      let idx = 1;
      for (const wTxt of textWps) {
        const w = await geocode(wTxt);
        if (w) {
          const name = wTxt || `WP${idx}`;
          seq.push({ label: `WP${idx}`, name, latlng: w.latlng });
          markers.push(
            L.marker(w.latlng).addTo(map).bindPopup(name)
          );
          idx++;
        }
      }

      const eTxt = document.getElementById("end").value.trim();
      if (eTxt) {
        const e = await geocode(eTxt);
        if (e) {
          seq.push({ label: "目的地", name: eTxt, latlng: e.latlng });
          markers.push(
            L.marker(e.latlng).addTo(map).bindPopup("目的地")
          );
        }
      }

      if (seq.length < 2) {
        alert("少なくとも2地点（出発・目的地など）を指定してください。");
        return;
      }

      const latlngs = seq.map((p) => p.latlng);
      routeLine = L.polyline(latlngs, {
        color: "red",
        weight: 4,
        opacity: 0.9,
      }).addTo(map);
      map.fitBounds(routeLine.getBounds(), { padding: [20, 20] });

      await window.showNavLog(seq, TAS);
      showTab("results");
    } catch (err) {
      console.error(err);
      alert("ルート作成中にエラーが発生しました。コンソールをご確認ください。");
    }
  }
  window.plotRoute = plotRoute;

  // ====== ルート描画（クリック選択） ======
  async function plotRouteFromPicked() {
    try {
      if (pickedSeq.length < 2) {
        alert("少なくとも2地点をクリックしてください。");
        return;
      }
      if (routeLine) {
        map.removeLayer(routeLine);
        routeLine = null;
      }

      const TAS = Math.max(
        10,
        parseFloat(document.getElementById("tas").value) || 120
      );

      const seq = pickedSeq.map((p, i) => {
        const label =
          i === 0
            ? "出発地"
            : i === pickedSeq.length - 1
            ? "目的地"
            : `WP${i}`;
        const name = label + `(${p.name})`;
        return { label, name, latlng: p.latlng };
      });

      const latlngs = seq.map((p) => p.latlng);
      routeLine = L.polyline(latlngs, {
        color: "red",
        weight: 4,
        opacity: 0.9,
      }).addTo(map);
      map.fitBounds(routeLine.getBounds(), { padding: [20, 20] });

      await window.showNavLog(seq, TAS);
      showTab("results");
    } catch (err) {
      console.error(err);
      alert("クリックルート作成中にエラーが発生しました。コンソールをご確認ください。");
    }
  }
  window.plotRouteFromPicked = plotRouteFromPicked;

  // ====== リセット ======
  function resetAll() {
    markers.forEach((m) => m && map.removeLayer(m));
    markers = [];
    if (routeLine) {
      map.removeLayer(routeLine);
      routeLine = null;
    }

    clearPick();

    document.getElementById("results").innerHTML = "";
    document.getElementById("waypoints").innerHTML = "";
    document.getElementById("start").value = "";
    document.getElementById("end").value = "";
    document.getElementById("tas").value = 120;
    document.getElementById("alt").value = 3000;
    document.getElementById("etd").value = "";
    document.getElementById("windDir").value = "";
    document.getElementById("windSpd").value = "";
    document.getElementById("dev").value = "0";
    document.getElementById("burnPerHour").value = "30";
    document.getElementById("startFuel").value = "100";

    showTab("input");
    setRouteMode("text");
  }
  window.resetAll = resetAll;

  window.addEventListener("load", () => {
    setTimeout(() => map.invalidateSize(), 0);
    updatePickList();
  });
})();
