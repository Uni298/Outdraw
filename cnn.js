const fs = require('fs');
const path = require('path');
const ort = require('onnxruntime-node');

// -----------------------------------------------------
// Bresenham / normalizeStrokes / rasterizeStrokes は元のまま
// -----------------------------------------------------
function drawLine(grid, x0, y0, x1, y1, size) {
    let dx = Math.abs(x1 - x0);
    let dy = Math.abs(y1 - y0);
    let sx = (x0 < x1) ? 1 : -1;
    let sy = (y0 < y1) ? 1 : -1;
    let err = dx - dy;

    while (true) {
        if (x0 >= 0 && x0 < size && y0 >= 0 && y0 < size) {
            grid[y0][x0] = 0; // Black stroke
        }

        if (x0 === x1 && y0 === y1) break;
        let e2 = 2 * err;
        if (e2 > -dy) {
            err -= dy;
            x0 += sx;
        }
        if (e2 < dx) {
            err += dx;
            x0 += 0;
            y0 += sy;
        }
    }
}

// 元の normalizeStrokes と同じ
function normalizeStrokes(strokes, size = 32) {
    let xs = [];
    let ys = [];

    for (const stroke of strokes) {
        xs.push(...stroke[0]);
        ys.push(...stroke[1]);
    }

    if (xs.length === 0 || ys.length === 0) return [];

    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    const w = (maxX - minX) + 1e-5;
    const h = (maxY - minY) + 1e-5;

    const normalized = strokes.map(stroke => [
        stroke[0].map(x => Math.floor(((x - minX) / w) * (size - 1))),
        stroke[1].map(y => Math.floor(((y - minY) / h) * (size - 1)))
    ]);

    return normalized;
}

// 元の rasterizeStrokes（返り値は 0〜1 の 32*32）
function rasterizeStrokes(strokes, size = 32) {
    const normalizedStrokes = normalizeStrokes(strokes, size);
    const grid = Array(size).fill().map(() => Array(size).fill(255));

    for (const stroke of normalizedStrokes) {
        const xs = stroke[0];
        const ys = stroke[1];
        for (let i = 0; i < xs.length - 1; i++) {
            drawLine(grid, xs[i], ys[i], xs[i + 1], ys[i + 1], size);
        }
    }

    const data = [];
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            data.push(1.0 - (grid[y][x] / 255.0));
        }
    }
    return data; // 長さ 1024 の 0〜1 float
}

// -----------------------------------------------------
// CNN モデル状態
// -----------------------------------------------------
let session = null;
let modelNames = [];

// API: getModelNames はそのまま
function getModelNames() {
    return modelNames;
}

// -----------------------------------------------------
// loadModel: 今は ONNX モデルと categories.txt を読む
// 署名はそのまま: async function loadModel(modelDir = "png_model_32")
// -----------------------------------------------------
async function loadModel(modelDir = "png_model_32") {
    const onnxPath = path.join(modelDir, "model.onnx");
    const catPath = path.join(modelDir, "categories.txt");

    if (!fs.existsSync(onnxPath)) {
        throw new Error(`ONNX model not found at ${onnxPath}`);
    }
    if (!fs.existsSync(catPath)) {
        throw new Error(`categories.txt not found at ${catPath}`);
    }

    // カテゴリ読み込み
    const txt = fs.readFileSync(catPath, "utf-8");
    modelNames = txt.split(/\r?\n/).map(s => s.trim()).filter(s => s.length > 0);

    // ONNX Runtime セッション作成
    session = await ort.InferenceSession.create(onnxPath);

    console.log(`[CNN] Loaded ONNX model from ${onnxPath}`);
    console.log(`[CNN] Categories: ${modelNames.length}`);
}

// -----------------------------------------------------
// predictStrokes: API 互換 + 内部は CNN 推論
// -----------------------------------------------------
async function predictStrokes(strokes, options = {}) {
    if (!session) {
        throw new Error("Model not loaded. Call loadModel() first.");
    }

    const size = 32;
    const absoluteThreshold = options.absoluteThreshold || 70; // 互換用
    const relativeThreshold = options.relativeThreshold || 2;
    const topNCount = options.topN || 10;

    // 入力画像（0〜1, 長さ 1024）
    const imgArray = rasterizeStrokes(strokes, size); // JS版のまま
    const inputTensor = new ort.Tensor(
        'float32',
        Float32Array.from(imgArray),
        [1, 1, size, size]
    );

    const results = await session.run({ input: inputTensor });
    const logits = results.logits.data; // Float32Array, 長さ num_classes

    // ソフトマックスではなく、そのままスコアとして扱う
    const numClasses = logits.length;
    const scored = [];
    for (let i = 0; i < numClasses; i++) {
        scored.push({
            index: i,
            score: logits[i],
            name: modelNames[i] || `class_${i}`
        });
    }

    // スコアの降順（高い方が良い）
    scored.sort((a, b) => b.score - a.score);

    const topN = scored.slice(0, topNCount);

    const best = scored[0];
    const second = scored.length > 1 ? scored[1] : { score: -Infinity };

    const bestScore = best.score;
    const secondScore = second.score;
    const relativeGap = bestScore - secondScore;

    // もともとの distance ベースのしきい値と整合を取るための
    // ダミー距離変換（score が高いほど distance 小さいという扱い）
    function scoreToDistance(s) {
        return -s; // 符号を反転して distance っぽくする
    }

    const isConfident = (scoreToDistance(bestScore) < absoluteThreshold) &&
                        (relativeGap > relativeThreshold);

    const confidence = {
        absoluteDistance: scoreToDistance(bestScore),
        relativeGap: relativeGap,
        isConfident: isConfident,
        thresholds: {
            absolute: absoluteThreshold,
            relative: relativeThreshold
        }
    };

    return {
        classIndex: best.index,
        className: best.name,
        distance: scoreToDistance(bestScore), // 互換目的
        topN: topN.map(t => ({
            index: t.index,
            distance: scoreToDistance(t.score),
            name: t.name,
            score: t.score
        })),
        confidence: confidence,
        rawDistances: scored.map(s => scoreToDistance(s.score)),
        input: Array.from(imgArray)
    };
}


module.exports = {
    loadModel,
    predictStrokes,
    normalizeStrokes,
    getModelNames
};

