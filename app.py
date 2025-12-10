# app.py
import os
from flask import Flask, render_template, request, jsonify
import requests

app = Flask(__name__)

# ====== 設定 ======
# AVWX トークンは Render / ローカルの環境変数 AVWX_TOKEN から読む
AVWX_TOKEN = os.environ.get("AVWX_TOKEN", "").strip()

# Open-Meteo のベースURL（GFSベースの高層風）
OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"


# ====== ルート：メイン画面 ======
@app.route("/")
def index():
    # templates/map.html を表示
    return render_template("map.html")


# ====== ルート：出典ページ ======
@app.route("/credits")
def credits():
    # templates/credits.html を表示
    return render_template("credits.html")


# ====== AVWX METAR プロキシ API ======
@app.route("/api/metar")
def api_metar():
    """
    フロントからは /api/metar?icao=RJTT のように呼ぶ。
    ここから AVWX REST API にサーバ側でアクセスする。
    """
    icao = (request.args.get("icao") or "").strip().upper()
    if not icao:
        return jsonify({"error": "icao is required"}), 400

    url = f"https://avwx.rest/api/metar/{icao}"
    headers = {"Accept": "application/json"}
    if AVWX_TOKEN:
        headers["Authorization"] = f"Bearer {AVWX_TOKEN}"  # トークンはサーバ側だけで保持

    params = {
        "format": "json",
        "onfail": "cache",
    }

    try:
        r = requests.get(url, headers=headers, params=params, timeout=8)
        r.raise_for_status()
        data = r.json()
        return jsonify(data)
    except requests.RequestException as e:
        return jsonify({"error": f"AVWX request failed: {e}"}), 502


# ====== 高度(ft) → 等圧面(hPa) の簡易対応表 ======
def alt_ft_to_level(alt_ft: float) -> str:
    """
    入力された巡航高度(ft) に最も近い等圧面をざっくり対応させる。
    必要であればあとでテーブルを調整すればOK。
    """
    if alt_ft is None:
        alt_ft = 3000.0
    try:
        alt_ft = float(alt_ft)
    except ValueError:
        alt_ft = 3000.0

    table = [
        (1500, "975hPa"),
        (3000, "950hPa"),
        (4500, "925hPa"),
        (6500, "900hPa"),
        (8500, "850hPa"),
        (10500, "800hPa"),
        (13500, "700hPa"),
        (17500, "600hPa"),
        (24500, "500hPa"),
        (32500, "400hPa"),
        (39000, "300hPa"),
        (45000, "250hPa"),
    ]
    for limit_ft, level in table:
        if alt_ft <= limit_ft:
            return level
    return "200hPa"


# ====== GFS（Open-Meteo）風向風速 API ======
@app.route("/api/gfs_wind", methods=["POST"])
def api_gfs_wind():
    """
    フロント（navlog.js / gfs-wind.js）からは、
      POST /api/gfs_wind
      JSON: {
        "alt_ft": 3000,
        "points": [
          {"id": 0, "lat": 35.6, "lon": 139.8},
          {"id": 1, "lat": 38.0, "lon": 140.9},
          ...
        ]
      }

    各ポイントに対して、その地点＋指定高度に最も近い等圧面の
    風向・風速(kn) を返す。
    """
    payload = request.get_json(silent=True) or {}
    points = payload.get("points") or []
    alt_ft = payload.get("alt_ft", 3000)

    if not points:
        return jsonify({"error": "points is required"}), 400

    level = alt_ft_to_level(alt_ft)
    var_speed = f"wind_speed_{level}"
    var_dir = f"wind_direction_{level}"

    # Open-Meteo は複数座標をカンマ区切りで投げられる
    lats = []
    lons = []
    for p in points:
        try:
            lats.append(str(float(p["lat"])))
            lons.append(str(float(p["lon"])))
        except Exception:
            # 無効な座標はスキップ
            continue

    if not lats or not lons or len(lats) != len(lons):
        return jsonify({"error": "invalid coordinates"}), 400

    params = {
        "latitude": ",".join(lats),
        "longitude": ",".join(lons),
        "hourly": f"{var_speed},{var_dir}",
        "windspeed_unit": "kn",  # ノットで返してもらう
        "models": "ncep_gfs013",  # GFS を明示
        "forecast_days": 1,
        "timezone": "UTC",
    }

    try:
        r = requests.get(OPEN_METEO_URL, params=params, timeout=8)
        r.raise_for_status()
        js = r.json()
    except requests.RequestException as e:
        return jsonify({"error": f"Open-Meteo request failed: {e}"}), 502

    # 単一地点 → dict, 複数地点 → list[dict] という仕様なので両方対応
    if isinstance(js, list):
        locations = js
    else:
        locations = [js]

    out_points = []
    for idx, loc in enumerate(locations):
        hourly = (loc or {}).get("hourly") or {}
        spd_arr = hourly.get(var_speed) or []
        dir_arr = hourly.get(var_dir) or []
        if not spd_arr or not dir_arr:
            continue

        try:
            spd = float(spd_arr[0])
            direc = float(dir_arr[0])
        except Exception:
            continue

        if idx >= len(points):
            continue
        pt = points[idx]

        out_points.append(
            {
                "id": pt.get("id", idx),
                "lat": pt.get("lat"),
                "lon": pt.get("lon"),
                "wind_spd": spd,
                "wind_dir": direc,
            }
        )

    return jsonify(
        {
            "level": level,
            "var_speed": var_speed,
            "var_dir": var_dir,
            "units": {"speed": "kn", "direction": "deg"},
            "points": out_points,
        }
    )


# ====== ヘルスチェック用（任意） ======
@app.route("/health")
def health():
    return jsonify({"status": "ok"})


if __name__ == "__main__":
    # ローカル開発用。Render では gunicorn app:app が使われる。
    port = int(os.environ.get("PORT", "10000"))
    app.run(host="0.0.0.0", port=port, debug=True)
