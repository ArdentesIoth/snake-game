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
const DEATH_ANIMATION_DURATION = 1500;
const RESET_DELAY = 2000;

// Yılan görsel ayarları
const SNAKE_BASE_WIDTH = CELL_SIZE * 0.9; // Baş için maksimum genişlik
const CURVE_RESOLUTION = 6; // Her segment arası kaç ara nokta (performance için ayarlanabilir)

// Renkler
const COLORS = {
  background: '#1a1a2e',
  backgroundGradient: '#16213e',
  snake: '#00ff88',
  snakeHead: '#00cc6a',
  snakeTail: '#006644',
  food: '#ff0066',
  text: '#ffffff',
  scoreGlow: '#ffd700',
  fire: ['#ff0000', '#ff4500', '#ff6600', '#ff8800', '#ffaa00', '#ffdd00'],
};

interface Point {
  x: number;
  y: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
  size: number;
}

const DIRECTIONS = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [, setGameCount] = useState(1);
  const [fps, setFps] = useState(15);
  
  const gameStateRef = useRef({
    snake: [{ x: 20, y: 15 }],
    previousSnake: [{ x: 20, y: 15 }],
    food: { x: 10, y: 10 },
    direction: { x: 1, y: 0 },
    hasEaten: false,
    lastUpdateTime: 0,
    isGameOver: false,
    deathTime: 0,
    particles: [] as Particle[],
  });

  // ============= CATMULL-ROM SPLINE HESAPLAMA =============
  // Verilen kontrol noktaları arasından geçen yumuşak bir eğri oluşturur
  const catmullRomSpline = (
    p0: Point,  // Önceki nokta
    p1: Point,  // Başlangıç noktası
    p2: Point,  // Bitiş noktası
    p3: Point,  // Sonraki nokta
    segments: number = CURVE_RESOLUTION // Kaç ara nokta oluşturulacak
  ): Point[] => {
    const points: Point[] = [];
    
    // 0'dan 1'e kadar küçük adımlarla ilerle
    for (let i = 0; i <= segments; i++) {
      const t = i / segments; // 0-1 arası interpolasyon faktörü
      const t2 = t * t;
      const t3 = t2 * t;
      
      // Catmull-Rom formülü (tension = 0.5 için)
      // Her eksen için ayrı hesaplama
      const x = 0.5 * (
        2 * p1.x +
        (-p0.x + p2.x) * t +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3
      );
      
      const y = 0.5 * (
        2 * p1.y +
        (-p0.y + p2.y) * t +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3
      );
      
      points.push({ x, y });
    }
    
    return points;
  };

  // ============= YILAN İÇİN SMOOTH EĞRİ NOKTALARINI OLUŞTUR =============
  const generateSmoothCurve = (positions: Point[]): Point[] => {
    if (positions.length < 2) return positions;
    
    const curvePoints: Point[] = [];
    
    // Her segment çifti için Catmull-Rom spline hesapla
    for (let i = 0; i < positions.length - 1; i++) {
      // Catmull-Rom için 4 nokta gerekli (önceki, başlangıç, bitiş, sonraki)
      const p0 = positions[Math.max(0, i - 1)]; // Önceki (veya ilk nokta)
      const p1 = positions[i]; // Başlangıç
      const p2 = positions[i + 1]; // Bitiş
      const p3 = positions[Math.min(positions.length - 1, i + 2)]; // Sonraki (veya son nokta)
      
      const segmentCurve = catmullRomSpline(p0, p1, p2, p3);
      
      // İlk segment için tüm noktaları ekle, sonraki segmentlerde çakışmayı önlemek için ilk noktayı atla
      if (i === 0) {
        curvePoints.push(...segmentCurve);
      } else {
        curvePoints.push(...segmentCurve.slice(1));
      }
    }
    
    return curvePoints;
  };

  // ============= PERPENDİKÜLER (DİK) VEKTÖR HESAPLAMA =============
  // Bir yön vektörüne dik olan vektörü bulur (sağ tarafa işaret eden)
  const getPerpendicular = (dx: number, dy: number): Point => {
    // 2D'de dik vektör: (dx, dy) -> (-dy, dx)
    const length = Math.sqrt(dx * dx + dy * dy) || 1; // Sıfıra bölme koruması
    return {
      x: -dy / length,
      y: dx / length,
    };
  };

  // ============= NOKTA İÇİN KALINLIK HESAPLAMA (TAPERING) =============
  // Baştan kuyruğa kalınlığın kademeli azalmasını hesaplar
  const getWidthAtPosition = (index: number, totalLength: number): number => {
    // 0 (baş) ile 1 (kuyruk) arası normalleştirilmiş pozisyon
    const normalizedPos = index / Math.max(totalLength - 1, 1);
    
    // Baştan %70'lik kısımda maksimum genişlik, sonra hızla incelt
    let widthFactor: number;
    if (normalizedPos < 0.7) {
      widthFactor = 1.0; // Sabit maksimum genişlik
    } else {
      // 0.7'den sonra lineer olarak 1'den 0.4'e düş
      widthFactor = 1.0 - ((normalizedPos - 0.7) / 0.3) * 0.6;
    }
    
    return SNAKE_BASE_WIDTH * widthFactor;
  };

  // ============= TÜP ŞEKLİNDE YILAN GÖVDESİ ÇİZ =============
  const drawSnakeBody = (
    ctx: CanvasRenderingContext2D,
    curvePoints: Point[]
  ) => {
    if (curvePoints.length < 2) return;
    
    // ===== ÜST VE ALT KENAR NOKTALARI HESAPLA =====
    const topEdge: Point[] = [];
    const bottomEdge: Point[] = [];
    
    for (let i = 0; i < curvePoints.length; i++) {
      const current = curvePoints[i];
      
      // Yön vektörünü hesapla (bir sonraki noktaya doğru)
      let dx: number, dy: number;
      if (i < curvePoints.length - 1) {
        const next = curvePoints[i + 1];
        dx = next.x - current.x;
        dy = next.y - current.y;
      } else {
        // Son nokta için önceki yönü kullan
        const prev = curvePoints[i - 1];
        dx = current.x - prev.x;
        dy = current.y - prev.y;
      }
      
      // Dik vektör (perpendicular)
      const perp = getPerpendicular(dx, dy);
      
      // Bu noktadaki genişlik (tapering ile)
      const width = getWidthAtPosition(i, curvePoints.length);
      const halfWidth = width / 2;
      
      // Üst ve alt kenar noktaları
      topEdge.push({
        x: current.x + perp.x * halfWidth,
        y: current.y + perp.y * halfWidth,
      });
      
      bottomEdge.push({
        x: current.x - perp.x * halfWidth,
        y: current.y - perp.y * halfWidth,
      });
    }
    
    // ===== RENK GRADİENTİ OLUŞTUR (BAŞTAN KUYRUĞA) =====
    // Yılanın fiziksel baş ve kuyruk pozisyonlarını kullan
    const headPos = curvePoints[0];
    const tailPos = curvePoints[curvePoints.length - 1];
    
    const gradient = ctx.createLinearGradient(
      headPos.x, headPos.y,
      tailPos.x, tailPos.y
    );
    
    gradient.addColorStop(0, COLORS.snakeHead);    // Baş: parlak yeşil
    gradient.addColorStop(0.5, COLORS.snake);      // Orta: neon yeşil
    gradient.addColorStop(1, COLORS.snakeTail);    // Kuyruk: koyu yeşil
    
    // ===== GLOW EFEKTİ =====
    ctx.shadowBlur = 15;
    ctx.shadowColor = COLORS.snake;
    
    // ===== KAPALI PATH OLUŞTUR (TÜP ŞEKLİ) =====
    ctx.beginPath();
    
    // Üst kenarı çiz (baştan kuyruğa)
    ctx.moveTo(topEdge[0].x, topEdge[0].y);
    for (let i = 1; i < topEdge.length; i++) {
      ctx.lineTo(topEdge[i].x, topEdge[i].y);
    }
    
    // Alt kenarı çiz (kuyruktan başa - ters yönde)
    for (let i = bottomEdge.length - 1; i >= 0; i--) {
      ctx.lineTo(bottomEdge[i].x, bottomEdge[i].y);
    }
    
    // Path'i kapat (başlangıca dön)
    ctx.closePath();
    
    // ===== TEK BİR ŞEKİL OLARAK DOLDUR =====
    ctx.fillStyle = gradient;
    ctx.fill();
    
    ctx.shadowBlur = 0;
    
    // ===== IŞIK EFEKTİ (HIGHLIGHT) =====
    // Gövde üstünde parlak bir şerit (3D derinlik hissi)
    const highlightGradient = ctx.createLinearGradient(
      topEdge[0].x, topEdge[0].y - 5,
      topEdge[0].x, topEdge[0].y + 5
    );
    
    highlightGradient.addColorStop(0, 'rgba(255, 255, 255, 0)');
    highlightGradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.3)');
    highlightGradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    
    ctx.beginPath();
    ctx.moveTo(topEdge[0].x, topEdge[0].y);
    for (let i = 1; i < topEdge.length; i++) {
      ctx.lineTo(topEdge[i].x, topEdge[i].y);
    }
    
    ctx.strokeStyle = highlightGradient;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.stroke();
  };

  // ============= YILAN BAŞINI ÇİZ =============
  const drawSnakeHead = (
    ctx: CanvasRenderingContext2D,
    headPosition: Point,
    direction: Point
  ) => {
    // Baş boyutu (gövdeden biraz daha büyük)
    const headWidth = SNAKE_BASE_WIDTH * 1.1;
    const headHeight = SNAKE_BASE_WIDTH * 0.9;
    
    // ===== BAŞ OVAL ŞEKLİ =====
    ctx.save();
    ctx.translate(headPosition.x, headPosition.y);
    
    // Hareket yönüne göre rotasyon hesapla
    const angle = Math.atan2(direction.y, direction.x);
    ctx.rotate(angle);
    
    // Glow efekti
    ctx.shadowBlur = 20;
    ctx.shadowColor = COLORS.snakeHead;
    
    // Gradient (3D derinlik)
    const headGradient = ctx.createRadialGradient(0, -2, 0, 0, 0, headWidth / 2);
    headGradient.addColorStop(0, COLORS.snakeHead);
    headGradient.addColorStop(1, COLORS.snake);
    
    ctx.fillStyle = headGradient;
    ctx.beginPath();
    ctx.ellipse(0, 0, headWidth / 2, headHeight / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.shadowBlur = 0;
    
    // ===== GÖZLER =====
    const eyeY = -headHeight * 0.15; // Gözlerin yukarıda olması için
    const eyeSpacing = headWidth * 0.3;
    const eyeSize = headWidth * 0.12;
    
    // Sol göz
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.beginPath();
    ctx.arc(-eyeSpacing, eyeY, eyeSize, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.fillStyle = 'rgba(0, 0, 0, 0.9)';
    ctx.beginPath();
    ctx.arc(-eyeSpacing + eyeSize * 0.2, eyeY, eyeSize * 0.6, 0, Math.PI * 2);
    ctx.fill();
    
    // Sağ göz
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.beginPath();
    ctx.arc(eyeSpacing, eyeY, eyeSize, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.fillStyle = 'rgba(0, 0, 0, 0.9)';
    ctx.beginPath();
    ctx.arc(eyeSpacing + eyeSize * 0.2, eyeY, eyeSize * 0.6, 0, Math.PI * 2);
    ctx.fill();
    
    // ===== DİL (OPSIYONEL) =====
    // Küçük V şeklinde kırmızı dil
    ctx.strokeStyle = 'rgba(220, 20, 60, 0.8)';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    
    const tongueLength = headWidth * 0.4;
    const tongueSplit = headWidth * 0.15;
    
    ctx.beginPath();
    ctx.moveTo(headWidth / 2, 0);
    ctx.lineTo(headWidth / 2 + tongueLength - tongueSplit, -tongueSplit);
    ctx.moveTo(headWidth / 2, 0);
    ctx.lineTo(headWidth / 2 + tongueLength - tongueSplit, tongueSplit);
    ctx.stroke();
    
    ctx.restore();
  };

  // ============= BFS PATHFINDING =============
  const findPathBFS = (start: Point, target: Point, obstacles: Point[]): Point[] => {
    const pointToKey = (p: Point) => `${p.x},${p.y}`;
    const obstacleSet = new Set(obstacles.map(pointToKey));
    const queue: { point: Point; path: Point[] }[] = [{ point: start, path: [start] }];
    const visited = new Set<string>([pointToKey(start)]);

    while (queue.length > 0) {
      const { point, path } = queue.shift()!;
      if (point.x === target.x && point.y === target.y) return path;

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
          queue.push({ point: nextPoint, path: [...path, nextPoint] });
        }
      }
    }
    return [];
  };

  const checkCollision = (head: Point, body: Point[]): boolean => {
    if (head.x < 0 || head.x >= GRID_WIDTH || head.y < 0 || head.y >= GRID_HEIGHT) return true;
    for (let i = 1; i < body.length; i++) {
      if (head.x === body[i].x && head.y === body[i].y) return true;
    }
    return false;
  };

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

  const decreaseFps = () => setFps(prev => Math.max(MIN_FPS, prev - FPS_STEP));
  const increaseFps = () => setFps(prev => Math.min(MAX_FPS, prev + FPS_STEP));

  useEffect(() => {
    resetGame();
  }, []);

  useEffect(() => {
    const gameLogicInterval = setInterval(() => {
      const state = gameStateRef.current;

      if (state.isGameOver) {
        const timeSinceDeath = performance.now() - state.deathTime;
        if (timeSinceDeath > RESET_DELAY) resetGame();
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
        state.direction = { x: nextPosition.x - head.x, y: nextPosition.y - head.y };
      } else {
        nextPosition = { x: head.x + state.direction.x, y: head.y + state.direction.y };
      }

      const newSnake = [nextPosition, ...state.snake];

      if (checkCollision(nextPosition, state.snake)) {
        state.isGameOver = true;
        state.deathTime = performance.now();
        state.particles = createFireParticles(state.snake);
        if (score > highScore) setHighScore(score);
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

      while (state.previousSnake.length > state.snake.length) state.previousSnake.pop();
      while (state.previousSnake.length < state.snake.length) {
        state.previousSnake.push({ ...state.snake[state.snake.length - 1] });
      }
    }, 1000 / fps);

    return () => clearInterval(gameLogicInterval);
  }, [fps, score, highScore]);

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
    return () => cancelAnimationFrame(animationFrameId);
  }, [fps]);

  // ============= ÇİZİM FONKSİYONU =============
  const drawGame = (
    ctx: CanvasRenderingContext2D, 
    state: typeof gameStateRef.current,
    interpolationFactor: number,
    currentTime: number
  ) => {
    // Arka plan
    const gradient = ctx.createLinearGradient(0, 0, 0, CANVAS_HEIGHT);
    gradient.addColorStop(0, COLORS.background);
    gradient.addColorStop(1, COLORS.backgroundGradient);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Grid
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

    // Yem
    const foodX = state.food.x * CELL_SIZE;
    const foodY = state.food.y * CELL_SIZE;
    
    ctx.shadowBlur = 20;
    ctx.shadowColor = COLORS.food;
    ctx.fillStyle = COLORS.food;
    ctx.beginPath();
    ctx.arc(foodX + CELL_SIZE / 2, foodY + CELL_SIZE / 2, CELL_SIZE / 2 - 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // ========== PROFESYONEL YILAN ÇİZİMİ ==========
    if (!state.isGameOver && state.snake.length > 0) {
      
      // 1. İnterpolated grid pozisyonlarını piksel koordinatlarına çevir
      const interpolatedPositions = state.snake.map((segment, index) => {
        const prevSegment = state.previousSnake[index] || segment;
        const lerpX = prevSegment.x + (segment.x - prevSegment.x) * interpolationFactor;
        const lerpY = prevSegment.y + (segment.y - prevSegment.y) * interpolationFactor;
        return {
          x: lerpX * CELL_SIZE + CELL_SIZE / 2,
          y: lerpY * CELL_SIZE + CELL_SIZE / 2,
        };
      });

      // 2. Catmull-Rom spline ile smooth curve oluştur
      const smoothCurve = generateSmoothCurve(interpolatedPositions);

      // 3. Tüp şeklinde gövde çiz
      drawSnakeBody(ctx, smoothCurve);

      // 4. Baş çiz (en üstte, gövdeden ayrı)
      if (interpolatedPositions.length > 0) {
        drawSnakeHead(ctx, interpolatedPositions[0], state.direction);
      }
      
    } else if (state.isGameOver) {
      // ========== YANMA EFEKTİ ==========
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
        ctx.roundRect(x + offset, y + offset, CELL_SIZE * shrinkFactor, CELL_SIZE * shrinkFactor, 4);
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
          BFS Pathfinding + Catmull-Rom Spline - Profesyonel Grafik
        </p>
      </div>

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
            <span className="text-gray-400">Curve Res:</span>
            <span className="ml-2 font-bold text-green-400">{CURVE_RESOLUTION}pts</span>
          </div>
        </div>
        <div className="mt-4 text-center text-gray-400 text-xs">
          🧠 BFS pathfinding + Catmull-Rom spline ile profesyonel smooth animasyon
        </div>
        <div className="mt-2 text-center text-green-400 text-xs font-semibold">
          ✨ Tüp şeklinde tek parça gövde, tapering efekti, highlight ışığı
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
