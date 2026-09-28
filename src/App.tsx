import { useEffect, useRef, useState } from 'react';

// ============= AYARLAR =============
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;
const CELL_SIZE = 20; // 20x20 piksel hücreler
const GRID_WIDTH = CANVAS_WIDTH / CELL_SIZE; // 40
const GRID_HEIGHT = CANVAS_HEIGHT / CELL_SIZE; // 30

// FPS limitleri
const MIN_FPS = 1;
const MAX_FPS = 60;
const FPS_STEP = 5;

// Oyun ayarları
const DEATH_ANIMATION_DURATION = 1500; // Yanma efekti süresi (ms)
const RESET_DELAY = 2000; // Yanma sonrası reset bekleme süresi (ms)

// Renkler
const COLORS = {
  background: '#1a1a2e',
  backgroundGradient: '#16213e',
  snake: '#00ff88',
  snakeHead: '#00cc6a',
  snakeTail: '#006644', // Kuyruk için daha koyu ton
  food: '#ff0066',
  text: '#ffffff',
  scoreGlow: '#ffd700',
  // Yanma efekti renkleri
  fire: ['#ff0000', '#ff4500', '#ff6600', '#ff8800', '#ffaa00', '#ffdd00'],
};

interface Point {
  x: number;
  y: number;
}

// Parçacık sistemi için
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
  size: number;
}

// Yön vektörleri (yukarı, sağ, aşağı, sol)
const DIRECTIONS = [
  { x: 0, y: -1 }, // Yukarı
  { x: 1, y: 0 },  // Sağ
  { x: 0, y: 1 },  // Aşağı
  { x: -1, y: 0 }, // Sol
];

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // State'ler korunuyor ama UI'da gösterilmeyecek
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [, setGameCount] = useState(1);
  const [fps, setFps] = useState(15);
  
  // Oyun state'i
  const gameStateRef = useRef({
    snake: [{ x: 20, y: 15 }],
    previousSnake: [{ x: 20, y: 15 }],
    food: { x: 10, y: 10 },
    direction: { x: 1, y: 0 }, // Başlangıç yönü: sağa
    hasEaten: false,
    lastUpdateTime: 0,
    isGameOver: false,
    deathTime: 0,
    particles: [] as Particle[],
  });

  // ============= BFS PATHFINDING ALGORİTMASI =============
  const findPathBFS = (start: Point, target: Point, obstacles: Point[]): Point[] => {
    const pointToKey = (p: Point) => `${p.x},${p.y}`;

    const obstacleSet = new Set(obstacles.map(pointToKey));
    const queue: { point: Point; path: Point[] }[] = [{ point: start, path: [start] }];
    const visited = new Set<string>([pointToKey(start)]);

    while (queue.length > 0) {
      const { point, path } = queue.shift()!;

      if (point.x === target.x && point.y === target.y) {
        return path;
      }

      for (const dir of DIRECTIONS) {
        const nextPoint = { x: point.x + dir.x, y: point.y + dir.y };
        const nextKey = pointToKey(nextPoint);

        if (
          nextPoint.x >= 0 &&
          nextPoint.x < GRID_WIDTH &&
          nextPoint.y >= 0 &&
          nextPoint.y < GRID_HEIGHT &&
          !visited.has(nextKey) &&
          !obstacleSet.has(nextKey)
        ) {
          visited.add(nextKey);
          queue.push({
            point: nextPoint,
            path: [...path, nextPoint],
          });
        }
      }
    }

    return [];
  };

  // ============= ÇARPIŞMA KONTROLÜ =============
  const checkCollision = (head: Point, body: Point[]): boolean => {
    if (head.x < 0 || head.x >= GRID_WIDTH || head.y < 0 || head.y >= GRID_HEIGHT) {
      return true;
    }

    for (let i = 1; i < body.length; i++) {
      if (head.x === body[i].x && head.y === body[i].y) {
        return true;
      }
    }

    return false;
  };

  // ============= YANMA EFEKTİ PARÇACIK OLUŞTURMA =============
  const createFireParticles = (snakeBody: Point[]): Particle[] => {
    const particles: Particle[] = [];

    snakeBody.forEach((segment) => {
      const particleCount = 8;
      for (let i = 0; i < particleCount; i++) {
        const angle = (Math.PI * 2 * i) / particleCount + Math.random() * 0.5;
        const speed = 2 + Math.random() * 3;
        particles.push({
          x: segment.x * CELL_SIZE + CELL_SIZE / 2,
          y: segment.y * CELL_SIZE + CELL_SIZE / 2,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 2,
          life: 1.0,
          color: COLORS.fire[Math.floor(Math.random() * COLORS.fire.length)],
          size: 4 + Math.random() * 6,
        });
      }
    });

    return particles;
  };

  // ============= RASTGELE YEM KONUMU =============
  const generateFood = (snake: Point[]): Point => {
    let newFood: Point;
    let attempts = 0;
    const maxAttempts = 1000;
    
    do {
      newFood = {
        x: Math.floor(Math.random() * GRID_WIDTH),
        y: Math.floor(Math.random() * GRID_HEIGHT),
      };
      attempts++;
    } while (
      attempts < maxAttempts &&
      snake.some(segment => segment.x === newFood.x && segment.y === newFood.y)
    );
    
    return newFood;
  };

  // ============= OYUNU SIFIRLAMA =============
  const resetGame = () => {
    const startX = Math.floor(GRID_WIDTH / 4 + Math.random() * (GRID_WIDTH / 2));
    const startY = Math.floor(GRID_HEIGHT / 4 + Math.random() * (GRID_HEIGHT / 2));
    
    const initialSnake = [{ x: startX, y: startY }];
    
    gameStateRef.current = {
      snake: initialSnake,
      previousSnake: [...initialSnake],
      food: generateFood(initialSnake),
      direction: { x: 1, y: 0 },
      hasEaten: false,
      lastUpdateTime: performance.now(),
      isGameOver: false,
      deathTime: 0,
      particles: [],
    };

    setScore(0);
    setGameCount(prev => prev + 1);
  };

  // FPS kontrol fonksiyonları
  const decreaseFps = () => {
    setFps(prev => Math.max(MIN_FPS, prev - FPS_STEP));
  };

  const increaseFps = () => {
    setFps(prev => Math.min(MAX_FPS, prev + FPS_STEP));
  };

  // ============= OYUNU BAŞLAT =============
  useEffect(() => {
    resetGame();
  }, []);

  // ============= OYUN MANTIĞI DÖNGÜSÜ =============
  useEffect(() => {
    const gameLogicInterval = setInterval(() => {
      const state = gameStateRef.current;

      if (state.isGameOver) {
        const timeSinceDeath = performance.now() - state.deathTime;
        if (timeSinceDeath > RESET_DELAY) {
          resetGame();
        }
        return;
      }

      state.previousSnake = state.snake.map(segment => ({ ...segment }));
      state.lastUpdateTime = performance.now();

      const head = state.snake[0];
      const body = state.snake.slice(1);

      const path = findPathBFS(head, state.food, body);

      let nextPosition: Point;

      if (path.length > 1) {
        nextPosition = path[1];
        state.direction = {
          x: nextPosition.x - head.x,
          y: nextPosition.y - head.y,
        };
      } else {
        nextPosition = {
          x: head.x + state.direction.x,
          y: head.y + state.direction.y,
        };
      }

      const newSnake = [nextPosition, ...state.snake];

      if (checkCollision(nextPosition, state.snake)) {
        state.isGameOver = true;
        state.deathTime = performance.now();
        state.particles = createFireParticles(state.snake);
        
        if (score > highScore) {
          setHighScore(score);
        }
        
        return;
      }

      if (nextPosition.x === state.food.x && nextPosition.y === state.food.y) {
        state.hasEaten = true;
        setScore(prev => prev + 1);
        state.food = generateFood(newSnake);
      } else {
        newSnake.pop();
      }

      state.snake = newSnake;

      if (state.hasEaten) {
        state.previousSnake = [...state.previousSnake, state.previousSnake[state.previousSnake.length - 1]];
        state.hasEaten = false;
      }

      while (state.previousSnake.length > state.snake.length) {
        state.previousSnake.pop();
      }
      while (state.previousSnake.length < state.snake.length) {
        state.previousSnake.push({ ...state.snake[state.snake.length - 1] });
      }
      
    }, 1000 / fps);

    return () => clearInterval(gameLogicInterval);
  }, [fps, score, highScore]);

  // ============= RENDER DÖNGÜSÜ (60 FPS) =============
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    
    const renderLoop = () => {
      const state = gameStateRef.current;
      const now = performance.now();

      if (state.isGameOver && state.particles.length > 0) {
        state.particles = state.particles
          .map(p => ({
            ...p,
            x: p.x + p.vx,
            y: p.y + p.vy,
            vy: p.vy + 0.2,
            life: p.life - 0.02,
            size: p.size * 0.97,
          }))
          .filter(p => p.life > 0);
      }

      const timeSinceUpdate = now - state.lastUpdateTime;
      const updateInterval = 1000 / fps;
      const interpolationFactor = Math.min(timeSinceUpdate / updateInterval, 1);
      
      drawGame(ctx, state, interpolationFactor, now);
      
      animationFrameId = requestAnimationFrame(renderLoop);
    };
    
    renderLoop();
    
    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [fps]);

  // ============= ÇİZİM FONKSİYONU =============
  const drawGame = (
    ctx: CanvasRenderingContext2D, 
    state: typeof gameStateRef.current,
    interpolationFactor: number,
    currentTime: number
  ) => {
    // Arka plan gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, CANVAS_HEIGHT);
    gradient.addColorStop(0, COLORS.background);
    gradient.addColorStop(1, COLORS.backgroundGradient);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Grid çizgileri
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= CANVAS_WIDTH; x += CELL_SIZE) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, CANVAS_HEIGHT);
      ctx.stroke();
    }
    for (let y = 0; y <= CANVAS_HEIGHT; y += CELL_SIZE) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(CANVAS_WIDTH, y);
      ctx.stroke();
    }

    // Yem çiz
    const foodX = state.food.x * CELL_SIZE;
    const foodY = state.food.y * CELL_SIZE;
    
    ctx.shadowBlur = 20;
    ctx.shadowColor = COLORS.food;
    ctx.fillStyle = COLORS.food;
    ctx.beginPath();
    ctx.arc(
      foodX + CELL_SIZE / 2,
      foodY + CELL_SIZE / 2,
      CELL_SIZE / 2 - 2,
      0,
      Math.PI * 2
    );
    ctx.fill();
    ctx.shadowBlur = 0;

    // ========== YENİ YILAN ÇİZİMİ - TEK PARÇA AKICI GÖVDE ==========
    if (!state.isGameOver && state.snake.length > 0) {
      
      // Interpolated pozisyonları hesapla
      const interpolatedPositions = state.snake.map((segment, index) => {
        const prevSegment = state.previousSnake[index] || segment;
        const lerpX = prevSegment.x + (segment.x - prevSegment.x) * interpolationFactor;
        const lerpY = prevSegment.y + (segment.y - prevSegment.y) * interpolationFactor;
        return {
          x: lerpX * CELL_SIZE + CELL_SIZE / 2, // Merkez nokta
          y: lerpY * CELL_SIZE + CELL_SIZE / 2,
        };
      });

      // ===== YILAN GÖVDESİNİ ÇİZ (Smooth Path ile) =====
      const bodyWidth = CELL_SIZE * 0.9; // Gövde kalınlığı
      
      // Her segment için daire çiz (örtüşmeli)
      for (let i = state.snake.length - 1; i >= 0; i--) {
        const pos = interpolatedPositions[i];
        
        // Baştan kuyruğa renk gradient'i
        const colorProgress = i / Math.max(state.snake.length - 1, 1);
        const r1 = parseInt(COLORS.snakeHead.slice(1, 3), 16);
        const g1 = parseInt(COLORS.snakeHead.slice(3, 5), 16);
        const b1 = parseInt(COLORS.snakeHead.slice(5, 7), 16);
        
        const r2 = parseInt(COLORS.snakeTail.slice(1, 3), 16);
        const g2 = parseInt(COLORS.snakeTail.slice(3, 5), 16);
        const b2 = parseInt(COLORS.snakeTail.slice(5, 7), 16);
        
        const r = Math.round(r1 + (r2 - r1) * colorProgress);
        const g = Math.round(g1 + (g2 - g1) * colorProgress);
        const b = Math.round(b1 + (b2 - b1) * colorProgress);
        
        const segmentColor = `rgb(${r}, ${g}, ${b})`;
        
        // Glow efekti
        ctx.shadowBlur = i === 0 ? 15 : 8;
        ctx.shadowColor = i === 0 ? COLORS.snakeHead : COLORS.snake;
        
        // Segment dairesi
        ctx.fillStyle = segmentColor;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, bodyWidth / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      
      ctx.shadowBlur = 0;
      
      // ===== SEGMENTLER ARASI BAĞLANTI ÇİZGİLERİ =====
      // Segmentler arası boşlukları doldur
      for (let i = 0; i < interpolatedPositions.length - 1; i++) {
        const pos1 = interpolatedPositions[i];
        const pos2 = interpolatedPositions[i + 1];
        
        // Renk gradient'i
        const colorProgress = i / Math.max(state.snake.length - 1, 1);
        const r1 = parseInt(COLORS.snakeHead.slice(1, 3), 16);
        const g1 = parseInt(COLORS.snakeHead.slice(3, 5), 16);
        const b1 = parseInt(COLORS.snakeHead.slice(5, 7), 16);
        
        const r2 = parseInt(COLORS.snakeTail.slice(1, 3), 16);
        const g2 = parseInt(COLORS.snakeTail.slice(3, 5), 16);
        const b2 = parseInt(COLORS.snakeTail.slice(5, 7), 16);
        
        const r = Math.round(r1 + (r2 - r1) * colorProgress);
        const g = Math.round(g1 + (g2 - g1) * colorProgress);
        const b = Math.round(b1 + (b2 - b1) * colorProgress);
        
        ctx.strokeStyle = `rgb(${r}, ${g}, ${b})`;
        ctx.lineWidth = bodyWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        
        ctx.beginPath();
        ctx.moveTo(pos1.x, pos1.y);
        ctx.lineTo(pos2.x, pos2.y);
        ctx.stroke();
      }
      
      // ===== PUL DESENİ (Scale Pattern) =====
      // Hafif çizgiler ile pul efekti
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.lineWidth = 1.5;
      for (let i = 0; i < interpolatedPositions.length; i++) {
        const pos = interpolatedPositions[i];
        
        // Her segment için 2-3 küçük çizgi (pul görünümü)
        const scaleSize = bodyWidth * 0.3;
        for (let j = 0; j < 3; j++) {
          const angle = (Math.PI * 2 / 3) * j + i * 0.5;
          const x1 = pos.x + Math.cos(angle) * scaleSize * 0.5;
          const y1 = pos.y + Math.sin(angle) * scaleSize * 0.5;
          const x2 = pos.x + Math.cos(angle) * scaleSize;
          const y2 = pos.y + Math.sin(angle) * scaleSize;
          
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }
      }
      
      // ===== YILAN BAŞINA GÖZLER EKLE =====
      if (interpolatedPositions.length > 0) {
        const headPos = interpolatedPositions[0];
        const direction = state.direction;
        
        // Gözlerin pozisyonunu hareket yönüne göre ayarla
        const eyeDistance = bodyWidth * 0.35;
        
        // Yön vektörüne dik vektör (gözler yan yana olsun)
        const perpX = -direction.y;
        const perpY = direction.x;
        
        // İlerleme yönünde gözleri biraz öne al
        const forwardOffset = bodyWidth * 0.15;
        
        // İki göz pozisyonu
        const eye1X = headPos.x + direction.x * forwardOffset + perpX * eyeDistance;
        const eye1Y = headPos.y + direction.y * forwardOffset + perpY * eyeDistance;
        const eye2X = headPos.x + direction.x * forwardOffset - perpX * eyeDistance;
        const eye2Y = headPos.y + direction.y * forwardOffset - perpY * eyeDistance;
        
        // Göz çiz (beyaz dış, siyah iç)
        const eyeSize = bodyWidth * 0.15;
        
        // Sol göz
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.beginPath();
        ctx.arc(eye1X, eye1Y, eyeSize, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
        ctx.beginPath();
        ctx.arc(eye1X, eye1Y, eyeSize * 0.6, 0, Math.PI * 2);
        ctx.fill();
        
        // Sağ göz
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.beginPath();
        ctx.arc(eye2X, eye2Y, eyeSize, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
        ctx.beginPath();
        ctx.arc(eye2X, eye2Y, eyeSize * 0.6, 0, Math.PI * 2);
        ctx.fill();
      }
      
    } else if (state.isGameOver) {
      // ========== YANMA EFEKTİ ÇİZİMİ ==========
      const timeSinceDeath = currentTime - state.deathTime;
      const deathProgress = Math.min(timeSinceDeath / DEATH_ANIMATION_DURATION, 1);

      state.snake.forEach((segment) => {
        const x = segment.x * CELL_SIZE;
        const y = segment.y * CELL_SIZE;

        const fireColorIndex = Math.floor((1 - deathProgress) * (COLORS.fire.length - 1));
        ctx.fillStyle = COLORS.fire[fireColorIndex];
        
        ctx.shadowBlur = 30 * (1 - deathProgress);
        ctx.shadowColor = '#ff4500';
        
        const shrinkFactor = 1 - deathProgress * 0.5;
        const offset = CELL_SIZE * (1 - shrinkFactor) / 2;

        ctx.beginPath();
        ctx.roundRect(
          x + offset, 
          y + offset, 
          CELL_SIZE * shrinkFactor, 
          CELL_SIZE * shrinkFactor, 
          4
        );
        ctx.fill();
      });

      ctx.shadowBlur = 0;

      state.particles.forEach(particle => {
        ctx.fillStyle = particle.color;
        ctx.globalAlpha = particle.life;
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
        ctx.fill();
      });

      ctx.globalAlpha = 1;

      // GAME OVER YAZISI
      if (timeSinceDeath < 1000) {
        ctx.save();
        
        const scale = Math.min(timeSinceDeath / 200, 1);
        const opacity = 1 - Math.max((timeSinceDeath - 800) / 200, 0);
        
        ctx.globalAlpha = opacity;
        ctx.translate(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
        ctx.scale(scale, scale);
        
        ctx.shadowBlur = 40;
        ctx.shadowColor = '#ff0000';
        
        ctx.fillStyle = '#ff0000';
        ctx.font = 'bold 80px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('💥 ÇARPTI!', 0, 0);
        
        ctx.restore();
      }
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 py-8">
      <div className="mb-6 text-center">
        <h1 className="text-4xl font-bold text-white mb-2">
          🤖 AI Yılan Oyunu
        </h1>
        <p className="text-gray-300 text-sm">
          BFS Pathfinding Algoritması ile Akıllı Yol Bulma
        </p>
      </div>

      {/* ÜST BİLGİ KUTULARI KALDIRILDI - State'ler arka planda çalışmaya devam ediyor */}

      {/* HIZ KONTROL PANELİ */}
      <div className="mb-4 bg-gradient-to-r from-purple-600 via-purple-500 to-pink-500 p-1 rounded-xl shadow-2xl">
        <div className="bg-gray-900 bg-opacity-90 backdrop-blur-sm px-8 py-4 rounded-lg">
          <div className="flex items-center gap-6">
            <button
              onClick={decreaseFps}
              disabled={fps <= MIN_FPS}
              className={`
                px-6 py-3 rounded-lg font-bold text-lg
                transition-all duration-200 transform
                ${fps <= MIN_FPS 
                  ? 'bg-gray-700 text-gray-500 cursor-not-allowed' 
                  : 'bg-gradient-to-r from-blue-500 to-blue-600 text-white hover:from-blue-600 hover:to-blue-700 hover:scale-105 hover:shadow-lg hover:shadow-blue-500/50 active:scale-95'
                }
              `}
            >
              ⏪ Yavaşlat
            </button>

            <div className="flex flex-col items-center min-w-[140px]">
              <div className="text-gray-400 text-xs uppercase tracking-wider mb-1">
                Oyun Hızı
              </div>
              <div className="bg-gradient-to-r from-yellow-400 to-orange-500 text-transparent bg-clip-text">
                <div className="text-5xl font-black tracking-tight">
                  {fps}
                </div>
              </div>
              <div className="text-gray-400 text-xs uppercase tracking-wider mt-1">
                FPS
              </div>
            </div>

            <button
              onClick={increaseFps}
              disabled={fps >= MAX_FPS}
              className={`
                px-6 py-3 rounded-lg font-bold text-lg
                transition-all duration-200 transform
                ${fps >= MAX_FPS 
                  ? 'bg-gray-700 text-gray-500 cursor-not-allowed' 
                  : 'bg-gradient-to-r from-green-500 to-green-600 text-white hover:from-green-600 hover:to-green-700 hover:scale-105 hover:shadow-lg hover:shadow-green-500/50 active:scale-95'
                }
              `}
            >
              Hızlandır ⏩
            </button>
          </div>

          <div className="mt-3 flex justify-center">
            <div className="bg-gray-800 px-4 py-1 rounded-full text-xs text-gray-400">
              Min: {MIN_FPS} • Max: {MAX_FPS} • Adım: ±{FPS_STEP}
            </div>
          </div>
        </div>
      </div>

      {/* Oyun Canvas */}
      <div className="relative shadow-2xl rounded-lg overflow-hidden border-4 border-purple-500">
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          className="block"
        />
      </div>

      {/* Bilgi Paneli */}
      <div className="mt-6 bg-gray-800 bg-opacity-50 backdrop-blur-sm px-6 py-4 rounded-lg max-w-2xl">
        <div className="grid grid-cols-2 gap-4 text-white text-sm">
          <div>
            <span className="text-gray-400">Yılan Uzunluğu:</span>
            <span className="ml-2 font-bold">{score + 1}</span>
          </div>
          <div>
            <span className="text-gray-400">Maksimum Alan:</span>
            <span className="ml-2 font-bold">{GRID_WIDTH * GRID_HEIGHT}</span>
          </div>
          <div>
            <span className="text-gray-400">Hız (FPS):</span>
            <span className="ml-2 font-bold text-yellow-400">{fps}</span>
          </div>
          <div>
            <span className="text-gray-400">Algoritma:</span>
            <span className="ml-2 font-bold text-green-400">BFS</span>
          </div>
        </div>
        <div className="mt-4 text-center text-gray-400 text-xs">
          🧠 BFS (Breadth-First Search) algoritması ile yılan yeme giden en kısa yolu bulur
        </div>
        <div className="mt-2 text-center text-green-400 text-xs font-semibold">
          ✨ Smooth animasyon: Oyun mantığı {fps} FPS, çizim 60 FPS
        </div>
        <div className="mt-2 text-center text-orange-400 text-xs">
          💥 Duvara veya kendi gövdesine çarparsa otomatik yeniden başlar
        </div>
      </div>

      {/* Kontroller */}
      <div className="mt-4 text-gray-400 text-xs text-center max-w-md">
        <p>🎮 Oyun tamamen otomatik - AI kendi yolunu bulur!</p>
        <p className="mt-1">⚡ Yukarıdaki butonlarla oyun hızını canlı olarak değiştirin</p>
      </div>
    </div>
  );
}

export default App;
