from flask import Flask, render_template

app = Flask(__name__)


@app.route("/")
def index():
    return render_template("map.html")


if __name__ == "__main__":
    # 開発用。本番では適宜変更してください
    app.run(host="0.0.0.0", port=5000, debug=True)
