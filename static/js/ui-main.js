// static/js/ui-main.js
console.log("[UI] init ui-main.js (Red Route & Pick Support)");

(function () {
  const map = window.navMap;
  if (!map) return;

  window.routeMode = "text"; 

  // タブ切り替え
  window.showTab = function(tab) {
    const inputTab = document.getElementById("inputTab");
    const resultsTab = document.getElementById("resultsTab");
    
    if (tab === "input") {
      if(inputTab) inputTab.style.display = "block";
      if(resultsTab) resultsTab.style.display = "none";
      document.body.classList.remove("results-layout");
    } else {
      if(inputTab) inputTab.style.display = "none";
      if(resultsTab) resultsTab.style.display = "flex";
      document.body.classList.add("results-layout");
      if (window.fitNavPaper) setTimeout(window.fitNavPaper, 100);
    }
    setTimeout(() => map.invalidateSize(), 100);
  };

  // モード切り替え
  window.setRouteMode = function(mode) {
    window.routeMode = mode;
    document.getElementById("mode-text").classList.toggle("active", mode === "text");
    document.getElementById("mode-pick").classList.toggle("active", mode === "pick");
    
    document.getElementById("text-route-panel").style.display = mode === "text" ? "block" : "none";
    document.getElementById("pick-route-panel").style.display = mode === "pick" ? "block" : "none";
    
    const pb = document.getElementById("plot-button-bar");
    const pr = document.getElementById("pick-run-bar");
    if(pb) pb.style.display = mode === "text" ? "block" : "none";
    if(pr) pr.style.display = mode === "pick" ? "block" : "none";

    const h = document.getElementById("modeHint");
    if(h) h.innerText = mode === "text" ? "地名を入力してルート作成" : "地図上の地点をクリックして追加";

    if (mode === "pick") map.closePopup();
  };

  let markers = [];
  let routeLine = null;
  let pickedSeq = [];

  function updatePickList() {
    const b = document.getElementById("pickedList");
    if(!b) return;
    if(pickedSeq.length===0) {
      b.innerHTML = '<div style="font-size:12px;color:#777">地図上の地点をクリックして追加</div>';
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

  // ★外部から地点登録を行う関数
  window.handlePointPick = function(latlng, name) {
    if (window.routeMode !== "pick") return false;
    
    // 青ピンを追加
    const m = L.marker(latlng).addTo(map).bindPopup(name).openPopup();
    
    pickedSeq.push({ latlng: latlng, name: name, _marker: m });
    updatePickList();
    return true;
  };

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

  // 地図の余白クリック
  map.on("click", (e) => {
    if(window.routeMode !== "pick") return;
    const name = `P${pickedSeq.length+1}`;
    window.handlePointPick([e.latlng.lat, e.latlng.lng], name);
  });

  // NavLog実行
  async function runNavLog(seq, TAS) {
    if(routeLine) { map.removeLayer(routeLine); routeLine=null; }
    if(seq.length>1) {
      const ll = seq.map(p=>p.latlng);
      // ★線を赤色に変更
      routeLine = L.polyline(ll, {color:"red", weight:5, opacity:0.8}).addTo(map);
      map.fitBounds(routeLine.getBounds(), {padding:[50,50]});
    }
    if(window.showNavLog) {
      await window.showNavLog(seq, TAS);
      window.showTab("results");
    } else {
      alert("Error: navlog.js not loaded");
    }
  }

  window.plotRoute = async function() {
    markers.forEach(m=>map.removeLayer(m)); markers=[];
    if(routeLine) { map.removeLayer(routeLine); routeLine=null; }
    const TAS = parseFloat(document.getElementById("tas").value)||120;
    const seq = [];
    
    async function geocode(q) {
      try {
        const u = `https://nominatim.openstreetmap.org/search?format=json&accept-language=ja&limit=1&q=${encodeURIComponent(q)}`;
        const r = await fetch(u);
        if(r.ok){
          const d = await r.json();
          if(d&&d.length>0) return {latlng:[+d[0].lat,+d[0].lon], name:d[0].display_name.split(",")[0]||q};
        }
      }catch(_){} return null;
    }

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

  window.plotRouteFromPicked = async function() {
    if(pickedSeq.length<2) return alert("2地点以上必要です");
    const TAS = parseFloat(document.getElementById("tas").value)||120;
    const seq = pickedSeq.map(p=>({ name:p.name, latlng:p.latlng }));
    await runNavLog(seq, TAS);
  };

  window.addWaypoint = function() {
    const c = document.getElementById("waypoints");
    const n = c.children.length + 1;
    const d = document.createElement("div");
    d.className = "input-group";
    d.innerHTML = `<label>経由地 ${n}:</label><input type="text" class="waypoint-input" placeholder="経由地">`;
    c.appendChild(d);
  };

  window.resetAll = function() {
    markers.forEach(m=>map.removeLayer(m)); markers=[];
    window.clearPick();
    if(routeLine) { map.removeLayer(routeLine); routeLine=null; }
    
    const res = document.getElementById("results"); if(res) res.innerHTML="";
    const wp = document.getElementById("waypoints"); if(wp) wp.innerHTML="";
    const s = document.getElementById("start"); if(s) s.value="";
    const e = document.getElementById("end"); if(e) e.value="";
    
    window.showTab("input");
    window.setRouteMode("text");
  };
  
  // 初期化時にTextモードをセット
  setTimeout(() => {
    window.setRouteMode("text");
  }, 100);
})();