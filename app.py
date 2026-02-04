import os
from flask import Flask, render_template, request, jsonify
import requests

app = Flask(__name__)

# 環境変数設定
LOCAL_AVWX_TOKEN = ""
AVWX_TOKEN = os.environ.get("AVWX_TOKEN", LOCAL_AVWX_TOKEN).strip()
OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"

@app.route("/")
def index():
    return render_template("map.html")

@app.route("/credits")
def credits():
    return render_template("credits.html")

@app.route("/api/metar")
def api_metar():
    icao = (request.args.get("icao") or "").strip().upper()
    if not icao: return jsonify({"error": "icao required"}), 400
    url = f"https://avwx.rest/api/metar/{icao}"
    headers = {"Accept": "application/json"}
    if AVWX_TOKEN: headers["Authorization"] = f"Bearer {AVWX_TOKEN}"
    try:
        r = requests.get(url, headers=headers, params={"format": "json", "onfail": "cache"}, timeout=10)
        if r.status_code == 404: return jsonify({"error": "Not Found"}), 404
        return jsonify(r.json())
    except Exception as e: return jsonify({"error": str(e)}), 502

# 風情報API (重要)
def alt_ft_to_level(alt_ft: float) -> str:
    if alt_ft is None: alt_ft = 3000.0
    try:
        alt_ft = float(alt_ft)
    except ValueError:
        alt_ft = 3000.0
    table = [
        (1500, "975hPa"), (3500, "925hPa"), (6000, "850hPa"), (10000, "700hPa"),
        (14000, "600hPa"), (18000, "500hPa"), (24000, "400hPa"), (30000, "300hPa"),
        (34000, "250hPa"), (39000, "200hPa"), (45000, "150hPa"),
    ]
    for limit_ft, level in table:
        if alt_ft <= limit_ft: return level
    return "100hPa"

@app.route("/api/gfs_wind", methods=["POST"])
def api_gfs_wind():
    payload = request.get_json(silent=True) or {}
    points = payload.get("points") or []
    alt_ft = payload.get("alt_ft", 3000)
    if not points: return jsonify({"error": "points required"}), 400

    level = alt_ft_to_level(alt_ft)
    var_speed = f"wind_speed_{level}"
    var_dir = f"wind_direction_{level}"
    lats = [str(float(p["lat"])) for p in points if "lat" in p]
    lons = [str(float(p["lon"])) for p in points if "lon" in p]
    if not lats: return jsonify({"error": "invalid coords"}), 400

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
    except Exception as e: return jsonify({"error": str(e)}), 502

    if isinstance(js, list): locations = js
    else: locations = [js]

    out_points = []
    for idx, loc in enumerate(locations):
        hourly = (loc or {}).get("hourly") or {}
        spd_arr = hourly.get(var_speed) or []
        dir_arr = hourly.get(var_dir) or []
        if not spd_arr or not dir_arr: continue
        if idx >= len(points): continue
        out_points.append({
            "id": points[idx].get("id", idx),
            "lat": points[idx].get("lat"),
            "lon": points[idx].get("lon"),
            "wind_spd": float(spd_arr[0]),
            "wind_dir": float(dir_arr[0]),
        })
    return jsonify({"level": level, "points": out_points})

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "10000"))
    app.run(host="0.0.0.0", port=port, debug=True)