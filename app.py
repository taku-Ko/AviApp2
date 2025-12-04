import os
from flask import Flask, render_template

# Flask アプリ本体
# static フォルダはデフォルトで 'static' が使われます
app = Flask(__name__)


@app.route("/")
def index():
    """
    航法ログ作成のメイン画面を表示する。
    templates/map.html をそのまま返します。
    """
    return render_template("map.html")


# ローカル実行 & Render 実行の両方に対応
if __name__ == "__main__":
    # Render では PORT 環境変数にポート番号が入っています
    port = int(os.environ.get("PORT", 5000))
    # 0.0.0.0 で待ち受けないと外からアクセスできません
    app.run(host="0.0.0.0", port=port)
