import os
import json
import numpy as np
from typing import List

from PIL import Image
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import Dataset, DataLoader

from tqdm import tqdm   # ★ 追加


# ---------------------------------------------------------
# JS と同じ normalizeStrokes / rasterizeStrokes
# ---------------------------------------------------------
def normalize_strokes(strokes, size=32):
    xs = []
    ys = []
    for stroke in strokes:
        xs.extend(stroke[0])
        ys.extend(stroke[1])

    if len(xs) == 0 or len(ys) == 0:
        return []

    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)

    w = (max_x - min_x) + 1e-5
    h = (max_y - min_y) + 1e-5

    normalized = []
    for stroke in strokes:
        nx = [int(((x - min_x) / w) * (size - 1)) for x in stroke[0]]
        ny = [int(((y - min_y) / h) * (size - 1)) for y in stroke[1]]
        normalized.append([nx, ny])

    return normalized


def draw_line(grid, x0, y0, x1, y1, size):
    dx = abs(x1 - x0)
    dy = abs(y1 - y0)
    sx = 1 if x0 < x1 else -1
    sy = 1 if y0 < y1 else -1
    err = dx - dy

    while True:
        if 0 <= x0 < size and 0 <= y0 < size:
            grid[y0, x0] = 0

        if x0 == x1 and y0 == y1:
            break

        e2 = 2 * err
        if e2 > -dy:
            err -= dy
            x0 += sx
        if e2 < dx:
            err += dx
            y0 += sy


def rasterize_strokes(strokes, size=32):
    norm = normalize_strokes(strokes, size)
    grid = np.full((size, size), 255, dtype=np.uint8)

    for stroke in norm:
        xs, ys = stroke
        for i in range(len(xs) - 1):
            draw_line(grid, xs[i], ys[i], xs[i + 1], ys[i + 1], size)

    img = 1.0 - (grid.astype(np.float32) / 255.0)
    return img


# ---------------------------------------------------------
# QuickDraw Dataset
# ---------------------------------------------------------
class QuickDrawDataset(Dataset):
    def __init__(self, ndjson_dir: str, categories: List[str], size: int = 32,
                 max_per_class: int = None):
        self.samples = []
        self.size = size
        self.categories = categories
        self.label_map = {c: i for i, c in enumerate(categories)}

        print(f"[INFO] Loading ndjson from {ndjson_dir} ...")

        for cat in tqdm(categories, desc="Categories"):
            path = os.path.join(ndjson_dir, f"{cat}.ndjson")
            if not os.path.exists(path):
                print(f"[WARN] Missing: {cat}.ndjson")
                continue

            count = 0
            with open(path, "r", encoding="utf-8") as f:
                for line in f:
                    data = json.loads(line)
                    strokes = data["drawing"]
                    img = rasterize_strokes(strokes, size)
                    label = self.label_map[cat]
                    self.samples.append((img, label))

                    count += 1
                    if max_per_class is not None and count >= max_per_class:
                        break

        print(f"[INFO] Total samples loaded: {len(self.samples)}")

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        img, label = self.samples[idx]
        img = torch.tensor(img, dtype=torch.float32).unsqueeze(0)
        label = torch.tensor(label, dtype=torch.long)
        return img, label


# ---------------------------------------------------------
# CNN
# ---------------------------------------------------------
class SmallCNN(nn.Module):
    def __init__(self, num_classes: int):
        super().__init__()
        self.features = nn.Sequential(
            nn.Conv2d(1, 32, 3, padding=1),
            nn.ReLU(),
            nn.Conv2d(32, 64, 3, padding=1),
            nn.ReLU(),
            nn.MaxPool2d(2),
            nn.Conv2d(64, 128, 3, padding=1),
            nn.ReLU(),
            nn.MaxPool2d(2),
        )
        self.classifier = nn.Sequential(
            nn.Flatten(),
            nn.Linear(128 * 8 * 8, 512),
            nn.ReLU(),
            nn.Linear(512, num_classes),
        )

    def forward(self, x):
        x = self.features(x)
        x = self.classifier(x)
        return x


# ---------------------------------------------------------
# Train & Export
# ---------------------------------------------------------
def train_and_export(
    ndjson_dir="quickdraw_ndjson",
    categories_file="categories.txt",
    out_dir="png_model_32",
    size=32,
    batch_size=128,
    epochs=5,
    max_per_class=200,
):
    # カテゴリ読み込み
    with open(categories_file, "r", encoding="utf-8") as f:
        categories = [l.strip() for l in f if l.strip()]
    num_classes = len(categories)

    # データセット
    dataset = QuickDrawDataset(ndjson_dir, categories, size=size,
                               max_per_class=max_per_class)
    loader = DataLoader(dataset, batch_size=batch_size, shuffle=True, num_workers=2)

    # モデル
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = SmallCNN(num_classes).to(device)

    optimizer = optim.Adam(model.parameters(), lr=1e-3)
    criterion = nn.CrossEntropyLoss()

    # 学習
    print("[INFO] Training CNN...")
    for epoch in range(epochs):
        total_loss = 0.0

        for imgs, labels in tqdm(loader, desc=f"Epoch {epoch+1}/{epochs}"):
            imgs, labels = imgs.to(device), labels.to(device)

            optimizer.zero_grad()
            logits = model(imgs)
            loss = criterion(logits, labels)
            loss.backward()
            optimizer.step()

            total_loss += loss.item() * imgs.size(0)

        avg_loss = total_loss / len(dataset)
        print(f"[EPOCH {epoch+1}] loss = {avg_loss:.4f}")

    # 出力
    os.makedirs(out_dir, exist_ok=True)

    # カテゴリ保存
    with open(os.path.join(out_dir, "categories.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(categories))

    # ONNX 出力
    dummy = torch.randn(1, 1, size, size).to(device)
    onnx_path = os.path.join(out_dir, "model.onnx")
    torch.onnx.export(
        model,
        dummy,
        onnx_path,
        input_names=["input"],
        output_names=["logits"],
        opset_version=11,
    )

    print(f"[INFO] Saved ONNX model to {onnx_path}")


if __name__ == "__main__":
    train_and_export()

