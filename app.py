import os
from flask import Flask, render_template, request, jsonify
import requests

app = Flask(__name__)

# ====== 設定 ======
# ★ローカル確認用: ここにAVWXのトークンを直接貼り付けてください
# (本番環境では環境変数 AVWX_TOKEN が優先されます)
LOCAL_AVWX_TOKEN = ""

# 環境変数があればそれを使い、なければ直書きトークンを使う
AVWX_TOKEN = os.environ.get("AVWX_TOKEN", LOCAL_AVWX_TOKEN).strip()

# Open-Meteo のベースURL（GFSベースの高層風）
OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"


# ====== ルート：メイン画面 ======
@app.route("/")
def index():
    return render_template("map.html")


# ====== ルート：出典ページ ======
@app.route("/credits")
def credits():
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

    # AVWXトークンのチェック
    if not AVWX_TOKEN or "あなたのAVWXトークン" in AVWX_TOKEN:
        print("Warning: AVWX Token is missing or placeholder.")
        # トークンがない場合でも、モックデータ等を返さずエラーにして気づかせる
        # return jsonify({"error": "AVWX Token missing"}), 500

    url = f"https://avwx.rest/api/metar/{icao}"
    headers = {"Accept": "application/json"}
    
    if AVWX_TOKEN:
        headers["Authorization"] = f"Bearer {AVWX_TOKEN}"

    params = {
        "format": "json",
        "onfail": "cache",
    }

    try:
        # タイムアウトを30秒に設定
        r = requests.get(url, headers=headers, params=params, timeout=30)
        r.raise_for_status()
        data = r.json()
        return jsonify(data)
    except requests.RequestException as e:
        return jsonify({"error": f"AVWX request failed: {e}"}), 502


# ====== 高度(ft) → 等圧面(hPa) の簡易対応表 ======
def alt_ft_to_level(alt_ft: float) -> str:
    if alt_ft is None:
        alt_ft = 3000.0
    try:
        alt_ft = float(alt_ft)
    except ValueError:
        alt_ft = 3000.0

    table = [
        (1500,  "975hPa"),
        (3500,  "925hPa"),
        (6000,  "850hPa"),
        (10000, "700hPa"),
        (14000, "600hPa"),
        (18000, "500hPa"),
        (24000, "400hPa"),
        (30000, "300hPa"),
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
    payload = request.get_json(silent=True) or {}
    points = payload.get("points") or []
    alt_ft = payload.get("alt_ft", 3000)

    if not points:
        return jsonify({"error": "points is required"}), 400

    level = alt_ft_to_level(alt_ft)
    var_speed = f"wind_speed_{level}"
    var_dir = f"wind_direction_{level}"

    lats = []
    lons = []
    for p in points:
        try:
            lats.append(str(float(p["lat"])))
            lons.append(str(float(p["lon"])))
        except Exception:
            continue

    if not lats or not lons:
        return jsonify({"error": "invalid coordinates"}), 400

    params = {
        "latitude": ",".join(lats),
        "longitude": ",".join(lons),
        "hourly": f"{var_speed},{var_dir}",
        "windspeed_unit": "kn",
        "models": "gfs_seamless",
        "forecast_days": 1,
        "timezone": "UTC",
    }

    try:
        r = requests.get(OPEN_METEO_URL, params=params, timeout=10)
        r.raise_for_status()
        js = r.json()
    except requests.RequestException as e:
        return jsonify({"error": f"Open-Meteo request failed: {e}"}), 502

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

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "10000"))
    app.run(host="0.0.0.0", port=port, debug=True)