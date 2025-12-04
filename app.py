# app.py

import os
import requests
from flask import Flask, render_template, request, jsonify

app = Flask(__name__)

# ========= 画面表示 =========

@app.route("/")
def index():
    """
    航法ログ作成のメイン画面を表示。
    templates/map.html を返します。
    """
    return render_template("map.html")


# ========= AVWX プロキシ API =========

@app.route("/api/metar")
def api_metar():
    """
    フロントエンドから METAR を取得するための安全なプロキシ。

    例:
      GET /api/metar?icao=RJAF

    - フロント側は AVWX のトークンを知らない
    - ここでサーバ側から AVWX に問い合わせて結果だけ返す
    """
    icao = request.args.get("icao", "", type=str).upper().strip()
    if not icao:
        return jsonify({"error": "missing icao"}), 400

    # Render の環境変数に登録した AVWX_TOKEN を読む
    avwx_token = os.environ.get("AVWX_TOKEN")
    if not avwx_token:
        return jsonify({"error": "server misconfig: AVWX_TOKEN not set"}), 500

    url = f"https://avwx.rest/api/metar/{icao}"

    headers = {
      "Authorization": f"Bearer {avwx_token}",
      "Accept": "application/json",
    }

    params = {
        "format": "json",
        "onfail": "cache",
    }

    try:
        resp = requests.get(url, headers=headers, params=params, timeout=10)
    except requests.RequestException as e:
        return jsonify({"error": f"request_error: {e}"}), 502

    if resp.status_code != 200:
        # AVWX 側のエラーもラップして返す
        return jsonify({
            "error": "upstream_error",
            "status": resp.status_code,
            "body": resp.text[:500],
        }), 502

    try:
        data = resp.json()
    except ValueError:
        return jsonify({"error": "invalid_json_from_avwx"}), 502

    return jsonify(data)


# ========= エントリポイント =========

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
