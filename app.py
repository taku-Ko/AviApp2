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
        # 修正: タイムアウトを 8秒 -> 30秒 に延長
        r = requests.get(url, headers=headers, params=params, timeout=30)
        r.raise_for_status()
        data = r.json()
        return jsonify(data)
    except requests.RequestException as e:
        # 502 Bad Gateway を返すことで、フロント側は取得失敗を知る
        return jsonify({"error": f"AVWX request failed: {e}"}), 502


# ====== 高度(ft) → 等圧面(hPa) の簡易対応表 ======
def alt_ft_to_level(alt_ft: float) -> str:
    """
    入力された巡航高度(ft) に最も近い等圧面をざっくり対応させる。
    Open-Meteo GFS で確実に取れる標準気圧面 (1000, 925, 850...) に合わせる。
    """
    if alt_ft is None:
        alt_ft = 3000.0
    try:
        alt_ft = float(alt_ft)
    except ValueError:
        alt_ft = 3000.0

    # 修正: 950hPa は欠損の可能性があるため、925hPa を優先する構成に変更
    table = [
        (1500,  "975hPa"), # 地表付近
        (3500,  "925hPa"), # 3000ft付近 (以前は950だったが925に変更)
        (6000,  "850hPa"), # 5000-6000ft
        (10000, "700hPa"), # 9000-10000ft
        (14000, "600hPa"),
        (18000, "500hPa"), # FL180
        (24000, "400hPa"),
        (30000, "300hPa"), # FL300
        (34000, "250hPa"),
        (39000, "200hPa"),
        (45000, "150hPa"),
    ]
    for limit_ft, level in table:
        if alt_ft <= limit_ft:
            return level
    return "100hPa"


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
          ...
        ]
      }
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
            continue

    if not lats or not lons or len(lats) != len(lons):
        return jsonify({"error": "invalid coordinates"}), 400

    params = {
        "latitude": ",".join(lats),
        "longitude": ",".join(lons),
        "hourly": f"{var_speed},{var_dir}",
        "windspeed_unit": "kn",  # ノット
        "models": "gfs_seamless",  # 修正: ncep_gfs013 -> gfs_seamless (より安定)
        "forecast_days": 1,
        "timezone": "UTC",
    }

    try:
        # 修正: タイムアウトを 8秒 -> 30秒 に延長
        r = requests.get(OPEN_METEO_URL, params=params, timeout=30)
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
        
        # 配列が空、またはデータがない場合はスキップ
        if not spd_arr or not dir_arr:
            continue

        try:
            # 0番目（現在時刻または開始時刻）を取得
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