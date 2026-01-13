const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');

const {
    loadModel,
    predictStrokes,
    getModelNames
} = require('./cnn'); // ← ここはファイル名に合わせて

const app = express();
const PORT = 3000;

// JSON ボディと静的ファイル
app.use(bodyParser.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'web_test')));

// モデル読み込み（起動時に一度だけ）
(async () => {
    try {
        await loadModel(path.join(__dirname, 'png_model_32'));
        console.log('[server] Model loaded. Categories:', getModelNames().length);
    } catch (err) {
        console.error('[server] Failed to load model:', err);
        process.exit(1);
    }
})();

// ストローク推論エンドポイント
// strokes: [ [xs...], [ys...] ] の配列（QuickDraw形式）
app.post('/api/predict', async (req, res) => {
    try {
        const strokes = req.body.strokes;
        if (!Array.isArray(strokes)) {
            return res.status(400).json({ error: 'Invalid strokes format' });
        }

        const result = await predictStrokes(strokes, { topN: 5 });

        res.json({
            ok: true,
            result
        });
    } catch (err) {
        console.error('[server] predict error:', err);
        res.status(500).json({ ok: false, error: 'Internal error' });
    }
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});

