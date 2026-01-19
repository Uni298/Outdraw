// Canvas drawing functionality
class DrawingCanvas {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    this.isDrawing = false;
    this.currentStroke = null;
    this.strokes = [];
    this.enabled = false;

    this.setupCanvas();
    this.attachEvents();
  }

  setupCanvas() {
    this.ctx.strokeStyle = '#000000';
    this.ctx.lineWidth = 10;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
  }

  attachEvents() {
    // Mouse events
    this.canvas.addEventListener('mousedown', (e) => this.startDrawing(e));
    this.canvas.addEventListener('mousemove', (e) => this.draw(e));
    this.canvas.addEventListener('mouseup', () => this.stopDrawing());
    this.canvas.addEventListener('mouseleave', () => this.stopDrawing());

    // Touch events
    this.canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      this.startDrawing(e.touches[0]);
    });
    this.canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      this.draw(e.touches[0]);
    });
    this.canvas.addEventListener('touchend', () => this.stopDrawing());
  }

  getCoordinates(event) {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;

    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY
    };
  }

  startDrawing(event) {
    if (!this.enabled) return;

    this.isDrawing = true;
    const coords = this.getCoordinates(event);
    
    this.currentStroke = {
      xs: [coords.x],
      ys: [coords.y]
    };

    this.ctx.beginPath();
    this.ctx.moveTo(coords.x, coords.y);
  }

  draw(event) {
    if (!this.isDrawing || !this.enabled) return;

    const coords = this.getCoordinates(event);
    
    this.currentStroke.xs.push(coords.x);
    this.currentStroke.ys.push(coords.y);

    this.ctx.lineTo(coords.x, coords.y);
    this.ctx.stroke();
  }

  stopDrawing() {
    if (!this.isDrawing) return;

    this.isDrawing = false;

    if (this.currentStroke && this.currentStroke.xs.length > 1) {
      // Convert to QuickDraw format: [[x1, x2, ...], [y1, y2, ...]]
      const stroke = [
        this.currentStroke.xs.map(Math.round),
        this.currentStroke.ys.map(Math.round)
      ];
      
      this.strokes.push(stroke);
      
      // Emit stroke event
      if (this.onStrokeComplete) {
        this.onStrokeComplete(stroke);
      }
    }

    this.currentStroke = null;
  }

  addStroke(stroke) {
    // Draw a stroke from another player
    const [xs, ys] = stroke;
    
    if (xs.length < 2) return;

    this.ctx.beginPath();
    this.ctx.moveTo(xs[0], ys[0]);
    
    for (let i = 1; i < xs.length; i++) {
      this.ctx.lineTo(xs[i], ys[i]);
    }
    
    this.ctx.stroke();
    this.strokes.push(stroke);
  }

  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.strokes = [];
    this.currentStroke = null;
  }

  enable() {
    this.enabled = true;
    this.canvas.style.cursor = 'crosshair';
  }

  disable() {
    this.enabled = false;
    this.canvas.style.cursor = 'default';
    this.stopDrawing();
  }

  getStrokes() {
    return this.strokes;
  }

  setStrokes(strokes) {
    this.clear();
    strokes.forEach(stroke => this.addStroke(stroke));
  }
}

// Export for use in other scripts
window.DrawingCanvas = DrawingCanvas;
