import os
from flask import Flask, render_template

# Flask アプリケーション本体
app = Flask(__name__)

# トップページ
@app.route("/")
def index():
    """
    動作確認用のシンプルなハンドラです。
    後でテンプレートを使う場合は、
    return render_template("index.html")
    に書き換えてください。
    """
    return "Hello from AviApp2 on Render!"

# ローカル実行 & Render 実行の両方に対応
if __name__ == "__main__":
    # Render では環境変数 PORT にポート番号が入ります
    port = int(os.environ.get("PORT", 5000))
    # 0.0.0.0 で待ち受ける必要があります（外部からアクセス可能にするため）
    app.run(host="0.0.0.0", port=port)
