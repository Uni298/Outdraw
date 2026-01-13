const path = require("path");
const testHeadless = require("./cnn");

class AIBridge {
  /**
   * @param {string} modelDir - TensorFlow.js のモデルが格納されたディレクトリ
   */
  constructor(modelDir = "png_model_32") {
    this.modelDir = modelDir;
    this.isReady = false;
  }

  /**
   * モデルをロードし、Bridge を使用可能な状態にする。
   * @returns {Promise<void>}
   */
  async start() {
    console.log("[AI Bridge] Loading model...");
    const resolvedDir = path.resolve(this.modelDir);
    await testHeadless.loadModel(resolvedDir);
    this.isReady = true;
    console.log("[AI Bridge] Ready.");
  }

  /**
   * 画像ファイルに対して推論を実行する。
   * @param {string} imagePath - 推論対象の画像パス（PNG, JPEG など）
   * @returns {Promise<Object>} 推論結果
   *   {
   *      classIndex: Number,          // 予測されたクラス番号
   *      probability: Number,         // 最高確率
   *      probabilities: Number[]      // 全クラスの確率配列
   *   }
   */


  /**
   * ストロークデータに対して推論を実行する。
   * @param {Array} strokes - ストロークデータ [[x[], y[]], ...]
   * @returns {Promise<Object>} 推論結果
   */
  async predictStrokes(strokes, options = {}) {
    if (!this.isReady) {
      throw new Error("[AI Bridge] Not ready. Call start() first.");
    }
    return await testHeadless.predictStrokes(strokes, options);
  }
}

module.exports = AIBridge;
