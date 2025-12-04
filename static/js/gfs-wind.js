// static/js/gfs-wind.js
console.log("[GFS] init gfs-wind.js");

(function () {
  /**
   * points: [{ id:number, lat:number, lon:number }, ...]
   * altFt: 巡航高度(ft)
   * 戻り値: { [id]: { dir, spd } } というマップ
   */
  async function fetchGfsWindsRaw(points, altFt) {
    if (!Array.isArray(points) || points.length === 0) {
      return {};
    }

    const payload = {
      alt_ft: altFt,
      points,
    };

    const res = await fetch("/api/gfs_wind", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`gfs_wind HTTP ${res.status}: ${text}`);
    }

    const data = await res.json();
    const out = {};
    const arr = Array.isArray(data.points) ? data.points : [];

    for (const p of arr) {
      const id = typeof p.id === "number" ? p.id : null;
      if (id === null) continue;
      const dir =
        typeof p.wind_dir === "number" ? p.wind_dir : null;
      const spd =
        typeof p.wind_spd === "number" ? p.wind_spd : null;
      if (dir == null || spd == null) continue;
      out[id] = { dir, spd };
    }

    return out;
  }

  /**
   * legs: [{ mid:[lat,lon], ... }, ...]
   * altFt: 巡航高度(ft)
   * 戻り値: { [index]: { dir, spd } }
   */
  async function fetchGfsWindsForLegs(legs, altFt) {
    if (!Array.isArray(legs) || legs.length === 0) {
      return {};
    }

    const points = legs.map((leg, idx) => {
      const m = leg.mid || [];
      return {
        id: idx,
        lat: m[0],
        lon: m[1],
      };
    });

    return fetchGfsWindsRaw(points, altFt);
  }

  // グローバル公開
  window.fetchGfsWindsRaw = fetchGfsWindsRaw;
  window.fetchGfsWindsForLegs = fetchGfsWindsForLegs;
})();
