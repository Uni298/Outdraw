// Physics-based waiting animation using Matter.js
let physicsEngine = null;
let physicsRender = null;
let isPhysicsRunning = false;

function startPhysicsAnimation() {
  if (isPhysicsRunning) return;
  
  // Check if Matter exists
  if (typeof Matter === 'undefined') {
      console.warn('Matter.js is not loaded');
      return;
  }
  
  const { Engine, Render, World, Bodies, Body } = Matter;
  
  const canvas = document.getElementById('physics-world');
  if (!canvas) return;

  // Ensure canvas is visible/sized correctly handled by CSS usually, 
  // but we set render options below.
  
  // Create engine
  physicsEngine = Engine.create();
  
  // Create renderer
  physicsRender = Render.create({
    canvas: canvas,
    engine: physicsEngine,
    options: {
      width: 500, // Even larger
      height: 500, // Even larger
      wireframes: false,
      background: 'transparent',
      hasBounds: false // Allow drawing outside if possible (render usually doesn't, but canvas size helps)
    }
  });
  
  // Center view on the box
  const wallThickness = 6;
  const boxSize = 300; 
  const centerX = 250; // Center of 500
  const centerY = 250; // Center of 500
  
  // Wall style
  const wallRender = { 
    fillStyle: 'rgba(255, 148, 70, 0.9)',
    strokeStyle: '#330634',
    lineWidth: 1
  };
  
  // Create walls
  // Using parts for the box to rotate it easily as a composite? 
  // No, rotating individual bodies around a center is fine.
  
  const ground = Bodies.rectangle(centerX, centerY + boxSize/2, boxSize, wallThickness, { isStatic: true, render: wallRender });
  const leftWall = Bodies.rectangle(centerX - boxSize/2, centerY, wallThickness, boxSize, { isStatic: true, render: wallRender });
  const rightWall = Bodies.rectangle(centerX + boxSize/2, centerY, wallThickness, boxSize, { isStatic: true, render: wallRender });
  const ceiling = Bodies.rectangle(centerX, centerY - boxSize/2, boxSize, wallThickness, { isStatic: true, render: wallRender });
  
  const walls = [ground, leftWall, rightWall, ceiling];
  
  // Create 6 cubes
  const cubeSize = 36; // 3x size
  const chamfer = { radius: 6 }; // Larger radius
  
  const cubes = [];
  for (let i = 0; i < 6; i++) {
    addCube(cubes, centerX, centerY, cubeSize, chamfer);
  }
  
  // Add to world
  World.add(physicsEngine.world, [...walls, ...cubes]);
  
  // Run engine and renderer
  Engine.run(physicsEngine);
  Render.run(physicsRender);
  
  // Click handler to add objects
  if (!canvas.getAttribute('data-listener-added')) {
      canvas.addEventListener('mousedown', (e) => {
        if (!isPhysicsRunning) return;
        addCubeToWorld(physicsEngine.world, centerX, centerY, cubeSize, chamfer);
      });
      
      // Also handle touch for mobile
      canvas.addEventListener('touchstart', (e) => {
        if (!isPhysicsRunning) return;
        e.preventDefault(); // Prevent scrolling
        addCubeToWorld(physicsEngine.world, centerX, centerY, cubeSize, chamfer);
      });
      canvas.setAttribute('data-listener-added', 'true');
  }
  
  // Rotate box endlessly
  let angle = 0;
  const rotationSpeed = 0.0005; // Adjusted for delta time (rad/ms)
  let lastTime = performance.now();
  
  function rotateBox(currentTime) {
    if (!isPhysicsRunning) return;
    
    const delta = currentTime - lastTime;
    lastTime = currentTime;
    
    // Avoid huge jumps if tab was inactive
    if (delta < 100) {
        angle += rotationSpeed * delta;
        
        // Rotate walls around center
        Matter.Composite.rotate(physicsEngine.world, rotationSpeed * delta, { x: centerX, y: centerY }, walls);
    }
    
    requestAnimationFrame(rotateBox);
  }
  
  isPhysicsRunning = true;
  lastTime = performance.now();
  requestAnimationFrame(rotateBox);
}

function addCube(array, centerX, centerY, size, chamfer) {
  const x = centerX + (Math.random() - 0.5) * 120; // Increased spread
  const y = centerY + (Math.random() - 0.5) * 120; // Increased spread
  const isWhite = Math.random() > 0.5;
  
  const cube = Matter.Bodies.rectangle(x, y, size, size, {
    chamfer: chamfer,
    restitution: 0.5,
    friction: 0.1,
    render: { 
      fillStyle: isWhite ? '#ffffff' : '#330634',
      strokeStyle: isWhite ? '#330634' : '#ff9446',
      lineWidth: 2 // Thicker line
    }
  });
  
  if (array) {
    array.push(cube);
  }
  return cube;
}

function addCubeToWorld(world, centerX, centerY, size, chamfer) {
  const cube = addCube(null, centerX, centerY, size, chamfer);
  Matter.World.add(world, cube);
}

function stopPhysicsAnimation() {
  isPhysicsRunning = false;
  
  if (physicsEngine) {
    Matter.Engine.clear(physicsEngine);
    physicsEngine = null;
  }
  
  if (physicsRender) {
    Matter.Render.stop(physicsRender);
    // Keep canvas element but clear it? 
    // Matter.Render.stop just stops the loop. Canvas content remains.
    // We can clean it.
    const canvas = physicsRender.canvas;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    physicsRender = null;
  }
}


// Export for use in client.js
window.startPhysicsAnimation = startPhysicsAnimation;
window.stopPhysicsAnimation = stopPhysicsAnimation;
