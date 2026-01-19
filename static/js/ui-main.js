// static/js/ui-main.js
console.log("[UI] init ui-main.js (Full Restore)");

(function () {
  const map = window.navMap;
  if (!map) return;

  // タブ切り替え (Input <-> Results)
  function showTab(tab) {
    const inputTab = document.getElementById("inputTab");
    const resultsTab = document.getElementById("resultsTab");
    
    if (tab === "input") {
      inputTab.style.display = "block";
      resultsTab.style.display = "none";
      document.body.classList.remove("results-layout");
    } else {
      inputTab.style.display = "none";
      resultsTab.style.display = "flex"; // Flex layout for toolbar
      document.body.classList.add("results-layout");
      // 結果表示時にサイズ調整を実行
      if (window.fitNavPaper) setTimeout(window.fitNavPaper, 100);
    }
    setTimeout(() => map.invalidateSize(), 100);
  }
  window.showTab = showTab;

  // モード切り替え (Text <-> Pick)
  let routeMode = "text";
  function setRouteMode(mode) {
    routeMode = mode;
    // ボタンのスタイル
    document.getElementById("mode-text").classList.toggle("active", mode === "text");
    document.getElementById("mode-pick").classList.toggle("active", mode === "pick");
    
    // パネルの表示
    document.getElementById("text-route-panel").style.display = mode === "text" ? "block" : "none";
    document.getElementById("pick-route-panel").style.display = mode === "pick" ? "block" : "none";
    
    // 実行ボタンの切り替え
    const pb = document.getElementById("plot-button-bar");
    const pr = document.getElementById("pick-run-bar");
    if(pb) pb.style.display = mode === "text" ? "block" : "none";
    if(pr) pr.style.display = mode === "pick" ? "block" : "none";

    // ヒント更新
    const h = document.getElementById("modeHint");
    if(h) h.innerText = mode === "text" ? "地名を入力してルート作成" : "地図をクリックして地点を追加";

    if (mode === "pick") map.closePopup();
  }
  window.setRouteMode = setRouteMode;

  let markers = [];
  let routeLine = null;

  // 経由地入力欄の追加
  window.addWaypoint = function() {
    const c = document.getElementById("waypoints");
    const n = c.children.length + 1;
    const d = document.createElement("div");
    d.className = "input-group";
    d.innerHTML = `<label>経由地 ${n}:</label><input type="text" class="waypoint-input" placeholder="経由地">`;
    c.appendChild(d);
  };

  // ジオコーディング
  async function geocode(q) {
    q = (q||"").trim();
    if (!q) return null;
    try {
      const u = `https://nominatim.openstreetmap.org/search?format=json&accept-language=ja&limit=1&q=${encodeURIComponent(q)}`;
      const r = await fetch(u);
      if (r.ok) {
        const d = await r.json();
        if (d && d.length>0) return { latlng:[+d[0].lat, +d[0].lon], name:d[0].display_name.split(",")[0]||q };
      }
    } catch(_){}
    return null;
  }

  // 地図クリック機能
  let pickedSeq = [];
  function updatePickList() {
    const b = document.getElementById("pickedList");
    if(!b) return;
    if(pickedSeq.length===0) {
      b.innerHTML = '<div style="font-size:12px;color:#777">地図をクリックして地点を追加</div>';
    } else {
      b.innerHTML = pickedSeq.map((p,i) => {
        let t = `WP${i}`;
        if(i===0) t="出発";
        else if(i===pickedSeq.length-1) t="目的";
        return `<div class="row"><span class="tag">${t}</span><span>${p.name}</span></div>`;
      }).join("");
    }
    const btn = document.getElementById("pick-run-bar");
    if(btn) btn.disabled = pickedSeq.length < 2;
  }

  window.clearPick = function(){
    pickedSeq.forEach(p=>map.removeLayer(p._marker));
    pickedSeq=[];
    updatePickList();
  };
  window.undoPick = function(){
    const p = pickedSeq.pop();
    if(p) map.removeLayer(p._marker);
    updatePickList();
  };

  map.on("click", (e) => {
    if(routeMode!=="pick") return;
    const ll = [e.latlng.lat, e.latlng.lng];
    const m = L.marker(ll).addTo(map).bindPopup(`P${pickedSeq.length+1}`);
    pickedSeq.push({ latlng:ll, name:`P${pickedSeq.length+1}`, _marker:m });
    updatePickList();
  });

  // 共通実行処理
  async function runNavLog(seq, TAS) {
    if(routeLine) { map.removeLayer(routeLine); routeLine=null; }
    if(seq.length>1) {
      const ll = seq.map(p=>p.latlng);
      routeLine = L.polyline(ll, {color:"blue", weight:5, opacity:0.7}).addTo(map);
      map.fitBounds(routeLine.getBounds(), {padding:[50,50]});
    }
    // navlog.jsの関数を呼び出し
    if(window.showNavLog) {
      await window.showNavLog(seq, TAS);
      showTab("results");
    } else {
      alert("Error: navlog.js not loaded");
    }
  }

  // 地名モード実行
  window.plotRoute = async function() {
    markers.forEach(m=>map.removeLayer(m)); markers=[];
    if(routeLine) { map.removeLayer(routeLine); routeLine=null; }
    
    const TAS = parseFloat(document.getElementById("tas").value)||120;
    const seq = [];
    
    const sTxt = document.getElementById("start").value;
    if(sTxt) {
      const r = await geocode(sTxt);
      if(r) { seq.push(r); markers.push(L.marker(r.latlng).addTo(map).bindPopup("S")); }
    }
    const wis = document.querySelectorAll("#waypoints .waypoint-input");
    for(const i of wis) {
      if(i.value) {
        const r = await geocode(i.value);
        if(r) { seq.push(r); markers.push(L.marker(r.latlng).addTo(map).bindPopup("W")); }
      }
    }
    const eTxt = document.getElementById("end").value;
    if(eTxt) {
      const r = await geocode(eTxt);
      if(r) { seq.push(r); markers.push(L.marker(r.latlng).addTo(map).bindPopup("E")); }
    }

    if(seq.length<2) return alert("2地点以上必要です");
    await runNavLog(seq, TAS);
  };

  // クリックモード実行
  window.plotRouteFromPicked = async function() {
    if(pickedSeq.length<2) return alert("2地点以上必要です");
    const TAS = parseFloat(document.getElementById("tas").value)||120;
    const seq = pickedSeq.map(p=>({ name:p.name, latlng:p.latlng }));
    await runNavLog(seq, TAS);
  };

  // リセット
  window.resetAll = function() {
    markers.forEach(m=>map.removeLayer(m)); markers=[];
    window.clearPick();
    if(routeLine) { map.removeLayer(routeLine); routeLine=null; }
    document.getElementById("results").innerHTML="";
    document.getElementById("waypoints").innerHTML="";
    document.getElementById("start").value="";
    document.getElementById("end").value="";
    showTab("input");
    setRouteMode("text");
  };

  // リサイズ監視
  window.addEventListener("resize", () => {
    if (window.fitNavPaper && document.body.classList.contains("results-layout")) {
      window.fitNavPaper();
    }
  });
})();