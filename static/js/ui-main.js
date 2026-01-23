// static/js/ui-main.js
console.log("[UI] init ui-main.js (FIXED: NaN & Mode)");

(function () {
  const map = window.navMap;
  if (!map) return;

  // 初期モード
  window.routeMode = "text"; 

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

  window.setRouteMode = function(mode) {
    window.routeMode = mode;
    console.log("Mode switched to:", mode); // Debug log

    const btnText = document.getElementById("mode-text");
    const btnPick = document.getElementById("mode-pick");
    if(btnText) btnText.classList.toggle("active", mode === "text");
    if(btnPick) btnPick.classList.toggle("active", mode === "pick");
    
    const panelText = document.getElementById("text-route-panel");
    const panelPick = document.getElementById("pick-route-panel");
    if(panelText) panelText.style.display = mode === "text" ? "block" : "none";
    if(panelPick) panelPick.style.display = mode === "pick" ? "block" : "none";
    
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
      b.innerHTML = '<div style="font-size:12px;color:#777">地図をクリックして地点を登録</div>';
    } else {
      b.innerHTML = pickedSeq.map((p,i) => {
        let t = `WP${i}`;
        if(i===0) t="出発"; else if(i===pickedSeq.length-1) t="目的";
        return `<div class="row"><span class="tag">${t}</span><span>${p.name}</span></div>`;
      }).join("");
    }
    const btn = document.getElementById("pick-run-bar");
    if(btn) btn.disabled = pickedSeq.length < 2;
  }

  // ★重要修正: NaN防止のため座標を確実に数値化
  window.handlePointPick = function(latlng, name) {
    if (window.routeMode !== "pick") return false;
    
    let lat, lng;
    if (Array.isArray(latlng)) {
      lat = latlng[0];
      lng = latlng[1];
    } else {
      lat = latlng.lat;
      lng = latlng.lng;
    }
    
    // 文字列の場合があるため変換
    lat = parseFloat(lat);
    lng = parseFloat(lng);

    if (isNaN(lat) || isNaN(lng)) {
      console.error("Invalid latlng:", latlng);
      return false;
    }

    const m = L.marker([lat, lng]).addTo(map).bindPopup(name).openPopup();
    
    // 数値配列として保存
    pickedSeq.push({ latlng: [lat, lng], name: name, _marker: m });
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

  map.on("click", (e) => {
    if(window.routeMode !== "pick") return;
    window.handlePointPick(e.latlng, `P${pickedSeq.length+1}`);
  });

  async function runNavLog(seq, TAS) {
    if(routeLine) { map.removeLayer(routeLine); routeLine=null; }
    if(seq.length>1) {
      const ll = seq.map(p=>p.latlng);
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
          if(d&&d.length>0) return {latlng:[parseFloat(d[0].lat), parseFloat(d[0].lon)], name:d[0].display_name.split(",")[0]||q};
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
    // 念押しマッピング
    const seq = pickedSeq.map(p=>({ name:p.name, latlng:[parseFloat(p.latlng[0]), parseFloat(p.latlng[1])] }));
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
    document.getElementById("results").innerHTML="";
    const wp = document.getElementById("waypoints"); if(wp) wp.innerHTML="";
    document.getElementById("start").value="";
    document.getElementById("end").value="";
    window.showTab("input");
    window.setRouteMode("text");
  };

  setTimeout(() => {
    window.showTab("input");
    window.setRouteMode("text");
  }, 200);
})();