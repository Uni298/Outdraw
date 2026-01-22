const fs = require('fs');
const path = require('path');
const ort = require('onnxruntime-node');
const { createCanvas } = require('canvas');

// -----------------------------------------------------
// 軽量アンチエイリアシング描画
// -----------------------------------------------------
function rasterizeStrokesAA(strokes, size = 32) {
    // 2倍解像度で描画してダウンサンプリング
    const highRes = size * 2;
    
    const canvas = createCanvas(highRes, highRes);
    const ctx = canvas.getContext('2d');
    
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, highRes, highRes);
    
    let xs = [];
    let ys = [];
    for (const stroke of strokes) {
        xs.push(...stroke[0]);
        ys.push(...stroke[1]);
    }
    
    if (xs.length === 0 || ys.length === 0) {
        return new Array(size * size).fill(0);
    }
    
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    
    const w = (maxX - minX) + 1e-5;
    const h = (maxY - minY) + 1e-5;
    
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    for (const stroke of strokes) {
        const points = stroke[0].map((x, i) => ({
            x: ((x - minX) / w) * (highRes - 1),
            y: ((stroke[1][i] - minY) / h) * (highRes - 1)
        }));
        
        if (points.length > 1) {
            ctx.beginPath();
            ctx.moveTo(points[0].x, points[0].y);
            for (let i = 1; i < points.length; i++) {
                ctx.lineTo(points[i].x, points[i].y);
            }
            ctx.stroke();
        }
    }
    
    // ダウンサンプリング
    const lowResCanvas = createCanvas(size, size);
    const lowResCtx = lowResCanvas.getContext('2d');
    
    lowResCtx.imageSmoothingEnabled = true;
    lowResCtx.imageSmoothingQuality = 'high';
    lowResCtx.drawImage(canvas, 0, 0, highRes, highRes, 0, 0, size, size);
    
    const imageData = lowResCtx.getImageData(0, 0, size, size);
    const pixels = imageData.data;
    
    const data = [];
    for (let i = 0; i < pixels.length; i += 4) {
        const gray = pixels[i];
        data.push(1.0 - (gray / 255.0));
    }
    
    return data;
}

// -----------------------------------------------------
// 元の高速描画 (AA無効用)
// -----------------------------------------------------
function drawLine(grid, x0, y0, x1, y1, size) {
    let dx = Math.abs(x1 - x0);
    let dy = Math.abs(y1 - y0);
    let sx = (x0 < x1) ? 1 : -1;
    let sy = (y0 < y1) ? 1 : -1;
    let err = dx - dy;

    while (true) {
        if (x0 >= 0 && x0 < size && y0 >= 0 && y0 < size) {
            grid[y0][x0] = 0;
        }
        if (x0 === x1 && y0 === y1) break;
        let e2 = 2 * err;
        if (e2 > -dy) {
            err -= dy;
            x0 += sx;
        }
        if (e2 < dx) {
            err += dx;
            y0 += sy;
        }
    }
}

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

    return strokes.map(stroke => [
        stroke[0].map(x => Math.floor(((x - minX) / w) * (size - 1))),
        stroke[1].map(y => Math.floor(((y - minY) / h) * (size - 1)))
    ]);
}

function rasterizeStrokesFast(strokes, size = 32) {
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
    return data;
}

// -----------------------------------------------------
// CNNモデル状態
// -----------------------------------------------------
let session = null;
let modelNames = [];
let useAA = true;

function getModelNames() {
    return modelNames;
}

function setAntialiasing(enabled) {
    useAA = enabled;
    console.log(`[CNN] Anti-aliasing: ${enabled ? '有効' : '無効'}`);
}

// -----------------------------------------------------
// loadModel
// -----------------------------------------------------
async function loadModel(modelDir = "png_model_32", categoriesFilePath = null) {
    console.log(`[CNN] Loading model from: ${modelDir}`);
    
    let onnxPath = path.join(modelDir, "model_fixed.onnx");
    if (!fs.existsSync(onnxPath)) {
        // Fallback to original if fixed version doesn't exist
        onnxPath = path.join(modelDir, "model.onnx");
        if (!fs.existsSync(onnxPath)) {
             throw new Error(`ONNX model not found at ${onnxPath}`);
        }
    }

    const catPath = categoriesFilePath || path.join(modelDir, "categories.txt");
    if (!fs.existsSync(catPath)) {
        throw new Error(`categories file not found at ${catPath}`);
    }

    const txt = fs.readFileSync(catPath, "utf-8");
    modelNames = txt.split(/\r?\n/).map(s => s.trim()).filter(s => s.length > 0);

    console.log(`[CNN] ✅ Loaded ${modelNames.length} categories`);

    session = await ort.InferenceSession.create(onnxPath, {
        executionProviders: ['cpu'],
        graphOptimizationLevel: 'all'
    });

    console.log(`[CNN] ✅ Model loaded`);
    console.log(`[CNN] 🖥️  Provider: ${(session.executionProviders || ['unknown']).join(', ')}`);
}

// -----------------------------------------------------
// TTA (Test-Time Augmentation) - 軽量版
// -----------------------------------------------------
function augmentStrokes(strokes, angle = 0, scale = 1.0) {
    if (angle === 0 && scale === 1.0) return strokes;
    
    const cos_a = Math.cos(angle * Math.PI / 180);
    const sin_a = Math.sin(angle * Math.PI / 180);
    
    return strokes.map(stroke => {
        const xs = stroke[0];
        const ys = stroke[1];
        const new_xs = [];
        const new_ys = [];
        
        for (let i = 0; i < xs.length; i++) {
            const x = xs[i] - 127.5;
            const y = ys[i] - 127.5;
            
            const x_r = x * cos_a - y * sin_a;
            const y_r = x * sin_a + y * cos_a;
            
            new_xs.push(x_r * scale + 127.5);
            new_ys.push(y_r * scale + 127.5);
        }
        
        return [new_xs, new_ys];
    });
}

async function predictWithTTA(strokes, size, useAA) {
    // 5パターンの軽量TTA
    const augmentations = [
        { angle: 0, scale: 1.0 },
        { angle: -5, scale: 1.0 },
        { angle: 5, scale: 1.0 },
        { angle: 0, scale: 0.95 },
        { angle: 0, scale: 1.05 }
    ];
    
    const allLogits = [];
    
    for (const aug of augmentations) {
        const augStrokes = augmentStrokes(strokes, aug.angle, aug.scale);
        const imgArray = useAA 
            ? rasterizeStrokesAA(augStrokes, size)
            : rasterizeStrokesFast(augStrokes, size);
        
        const inputTensor = new ort.Tensor(
            'float32',
            Float32Array.from(imgArray),
            [1, 1, size, size]
        );
        
        const results = await session.run({ input: inputTensor });
        allLogits.push(Array.from(results.logits.data));
    }
    
    // 平均
    const numClasses = allLogits[0].length;
    const avgLogits = new Array(numClasses).fill(0);
    
    for (let i = 0; i < numClasses; i++) {
        for (let j = 0; j < allLogits.length; j++) {
            avgLogits[i] += allLogits[j][i];
        }
        avgLogits[i] /= allLogits.length;
    }
    
    return avgLogits;
}

// -----------------------------------------------------
// predictStrokes
// -----------------------------------------------------
async function predictStrokes(strokes, options = {}) {
    if (!session) {
        throw new Error("Model not loaded. Call loadModel() first.");
    }

    const size = 32;
    const absoluteThreshold = options.absoluteThreshold || 70;
    const relativeThreshold = options.relativeThreshold || 2;
    const topNCount = options.topN || 10;
    const useTTA = options.useTTA !== false;  // デフォルト有効
    const currentUseAA = options.useAntialiasing !== undefined 
        ? options.useAntialiasing 
        : useAA;

    let logits;
    
    if (useTTA) {
        logits = await predictWithTTA(strokes, size, currentUseAA);
    } else {
        const imgArray = currentUseAA 
            ? rasterizeStrokesAA(strokes, size)
            : rasterizeStrokesFast(strokes, size);
        
        const inputTensor = new ort.Tensor(
            'float32',
            Float32Array.from(imgArray),
            [1, 1, size, size]
        );
        const results = await session.run({ input: inputTensor });
        logits = Array.from(results.logits.data);
    }

    // Softmax
    const numClasses = logits.length;
    const expScores = [];
    let sumExp = 0;
    
    for (let i = 0; i < numClasses; i++) {
        const expVal = Math.exp(logits[i]);
        expScores.push(expVal);
        sumExp += expVal;
    }
    
    const probabilities = expScores.map(exp => exp / sumExp);
    
    const scored = [];
    const allowList = options.allowedCategories;

    for (let i = 0; i < numClasses; i++) {
        let score = logits[i];
        let prob = probabilities[i];
        const name = modelNames[i];

        if (allowList && Array.isArray(allowList) && allowList.length > 0) {
            if (!allowList.includes(name)) {
                score = -Infinity;
                prob = 0;
            }
        }

        scored.push({ index: i, score: score, name: name, probability: prob });
    }

    // 再正規化
    if (allowList && Array.isArray(allowList) && allowList.length > 0) {
        const allowedScored = scored.filter(s => s.score > -Infinity);
        let sumAllowed = 0;
        allowedScored.forEach(s => sumAllowed += s.probability);
        
        if (sumAllowed > 0) {
            allowedScored.forEach(s => {
                s.probability = s.probability / sumAllowed;
            });
        }
    }

    scored.sort((a, b) => b.probability - a.probability);

    const topN = scored.slice(0, topNCount);
    const best = scored[0];
    const second = scored.length > 1 ? scored[1] : { probability: 0 };

    const confidencePercent = Math.round(best.probability * 100);

    function scoreToDistance(s) {
        return -s;
    }

    const bestScore = best.score;
    const secondScore = second.score || -Infinity;
    const relativeGap = bestScore - secondScore;

    const isConfident = (confidencePercent >= 70) && (relativeGap > relativeThreshold);

    const confidence = {
        absoluteDistance: scoreToDistance(bestScore),
        relativeGap: relativeGap,
        isConfident: isConfident,
        confidencePercent: confidencePercent,
        thresholds: {
            absolute: absoluteThreshold,
            relative: relativeThreshold
        }
    };

    return {
        classIndex: best.index,
        className: best.name,
        distance: scoreToDistance(bestScore),
        confidencePercent: confidencePercent,
        topN: topN.map(t => ({
            index: t.index,
            distance: scoreToDistance(t.score),
            name: t.name,
            score: t.score,
            probability: t.probability,
            confidencePercent: Math.round(t.probability * 100)
        })),
        confidence: confidence,
        rawDistances: scored.map(s => scoreToDistance(s.score))
    };
}

// 高速モード
async function predictStrokesFast(strokes, options = {}) {
    return predictStrokes(strokes, { 
        ...options, 
        useTTA: false, 
        useAntialiasing: false 
    });
}

module.exports = {
    loadModel,
    predictStrokes,
    predictStrokesFast,
    normalizeStrokes,
    getModelNames,
    setAntialiasing,
    rasterizeStrokesAA,
    rasterizeStrokesFast
};