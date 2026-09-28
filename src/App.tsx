import { useEffect, useRef, useState } from 'react';

// ============= AYARLAR =============
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;
const CELL_SIZE = 20;
const GRID_WIDTH = CANVAS_WIDTH / CELL_SIZE; // 40
const GRID_HEIGHT = CANVAS_HEIGHT / CELL_SIZE; // 30

const MIN_FPS = 1;
const MAX_FPS = 60;
const FPS_STEP = 5;

const DEATH_ANIMATION_DURATION = 1500;
const RESET_DELAY = 2000;

const SNAKE_BASE_WIDTH = CELL_SIZE * 0.9;
const CURVE_RESOLUTION = 6;

// ============= GÜVENLİK SİSTEMİ AYARLARI =============
const TAIL_SAFE_DISTANCE = 5; // Kuyruğun son kaç segmentine ulaşabilse yeterli
const MIN_SAFE_SPACE_RATIO = 0.25; // En az grid alanının %25'ine erişebilmeli (biraz gevşetildi)
const MAX_TAIL_CHASE_TICKS = 45; // Maksimum kaç tick kesintisiz kuyruk takibi yapılabilir (SONSUZ DÖNGÜ ÖNLEYİCİ)

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
    consecutiveTailChaseCount: 0, // YENİ: Kaç tick'tir kuyruk takibi yapılıyor
  });

  // ============= CATMULL-ROM SPLINE =============
  const catmullRomSpline = (
    p0: Point,
    p1: Point,
    p2: Point,
    p3: Point,
    segments: number = CURVE_RESOLUTION
  ): Point[] => {
    const points: Point[] = [];
    
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const t2 = t * t;
      const t3 = t2 * t;
      
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

  const generateSmoothCurve = (positions: Point[]): Point[] => {
    if (positions.length < 2) return positions;
    
    const curvePoints: Point[] = [];
    
    for (let i = 0; i < positions.length - 1; i++) {
      const p0 = positions[Math.max(0, i - 1)];
      const p1 = positions[i];
      const p2 = positions[i + 1];
      const p3 = positions[Math.min(positions.length - 1, i + 2)];
      
      const segmentCurve = catmullRomSpline(p0, p1, p2, p3);
      
      if (i === 0) {
        curvePoints.push(...segmentCurve);
      } else {
        curvePoints.push(...segmentCurve.slice(1));
      }
    }
    
    return curvePoints;
  };

  const getPerpendicular = (dx: number, dy: number): Point => {
    const length = Math.sqrt(dx * dx + dy * dy) || 1;
    return {
      x: -dy / length,
      y: dx / length,
    };
  };

  const getWidthAtPosition = (index: number, totalLength: number): number => {
    const normalizedPos = index / Math.max(totalLength - 1, 1);
    
    let widthFactor: number;
    if (normalizedPos < 0.7) {
      widthFactor = 1.0;
    } else {
      widthFactor = 1.0 - ((normalizedPos - 0.7) / 0.3) * 0.6;
    }
    
    return SNAKE_BASE_WIDTH * widthFactor;
  };

  const drawSnakeBody = (
    ctx: CanvasRenderingContext2D,
    curvePoints: Point[]
  ) => {
    if (curvePoints.length < 2) return;
    
    const topEdge: Point[] = [];
    const bottomEdge: Point[] = [];
    
    for (let i = 0; i < curvePoints.length; i++) {
      const current = curvePoints[i];
      
      let dx: number, dy: number;
      if (i < curvePoints.length - 1) {
        const next = curvePoints[i + 1];
        dx = next.x - current.x;
        dy = next.y - current.y;
      } else {
        const prev = curvePoints[i - 1];
        dx = current.x - prev.x;
        dy = current.y - prev.y;
      }
      
      const perp = getPerpendicular(dx, dy);
      const width = getWidthAtPosition(i, curvePoints.length);
      const halfWidth = width / 2;
      
      topEdge.push({
        x: current.x + perp.x * halfWidth,
        y: current.y + perp.y * halfWidth,
      });
      
      bottomEdge.push({
        x: current.x - perp.x * halfWidth,
        y: current.y - perp.y * halfWidth,
      });
    }
    
    const headPos = curvePoints[0];
    const tailPos = curvePoints[curvePoints.length - 1];
    
    const gradient = ctx.createLinearGradient(
      headPos.x, headPos.y,
      tailPos.x, tailPos.y
    );
    
    gradient.addColorStop(0, COLORS.snakeHead);
    gradient.addColorStop(0.5, COLORS.snake);
    gradient.addColorStop(1, COLORS.snakeTail);
    
    ctx.shadowBlur = 15;
    ctx.shadowColor = COLORS.snake;
    
    ctx.beginPath();
    ctx.moveTo(topEdge[0].x, topEdge[0].y);
    for (let i = 1; i < topEdge.length; i++) {
      ctx.lineTo(topEdge[i].x, topEdge[i].y);
    }
    for (let i = bottomEdge.length - 1; i >= 0; i--) {
      ctx.lineTo(bottomEdge[i].x, bottomEdge[i].y);
    }
    ctx.closePath();
    
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.shadowBlur = 0;
    
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

  const drawSnakeHead = (
    ctx: CanvasRenderingContext2D,
    headPosition: Point,
    direction: Point
  ) => {
    const headWidth = SNAKE_BASE_WIDTH * 1.1;
    const headHeight = SNAKE_BASE_WIDTH * 0.9;
    
    ctx.save();
    ctx.translate(headPosition.x, headPosition.y);
    
    const angle = Math.atan2(direction.y, direction.x);
    ctx.rotate(angle);
    
    ctx.shadowBlur = 20;
    ctx.shadowColor = COLORS.snakeHead;
    
    const headGradient = ctx.createRadialGradient(0, -2, 0, 0, 0, headWidth / 2);
    headGradient.addColorStop(0, COLORS.snakeHead);
    headGradient.addColorStop(1, COLORS.snake);
    
    ctx.fillStyle = headGradient;
    ctx.beginPath();
    ctx.ellipse(0, 0, headWidth / 2, headHeight / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    
    const eyeY = -headHeight * 0.15;
    const eyeSpacing = headWidth * 0.3;
    const eyeSize = headWidth * 0.12;
    
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.beginPath();
    ctx.arc(-eyeSpacing, eyeY, eyeSize, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.fillStyle = 'rgba(0, 0, 0, 0.9)';
    ctx.beginPath();
    ctx.arc(-eyeSpacing + eyeSize * 0.2, eyeY, eyeSize * 0.6, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.beginPath();
    ctx.arc(eyeSpacing, eyeY, eyeSize, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.fillStyle = 'rgba(0, 0, 0, 0.9)';
    ctx.beginPath();
    ctx.arc(eyeSpacing + eyeSize * 0.2, eyeY, eyeSize * 0.6, 0, Math.PI * 2);
    ctx.fill();
    
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

  // ============= TEMEL BFS PATHFINDING =============
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

  // ============= FLOOD-FILL: ERİŞİLEBİLİR BOŞ ALAN SAYMA =============
  const countReachableSpaces = (start: Point, obstacles: Point[]): number => {
    const pointToKey = (p: Point) => `${p.x},${p.y}`;
    const obstacleSet = new Set(obstacles.map(pointToKey));
    
    const queue: Point[] = [start];
    const visited = new Set<string>([pointToKey(start)]);
    let count = 0;

    while (queue.length > 0) {
      const current = queue.shift()!;
      count++;

      for (const dir of DIRECTIONS) {
        const next = { x: current.x + dir.x, y: current.y + dir.y };
        const nextKey = pointToKey(next);

        if (
          next.x >= 0 &&
          next.x < GRID_WIDTH &&
          next.y >= 0 &&
          next.y < GRID_HEIGHT &&
          !visited.has(nextKey) &&
          !obstacleSet.has(nextKey)
        ) {
          visited.add(nextKey);
          queue.push(next);
        }
      }
    }

    return count;
  };

  // ============= KATMAN 1: GELİŞTİRİLMİŞ GÜVENLİ YOL KONTROLÜ =============
  // YENİ: ADIM ADIM GERÇEK SİMÜLASYON
  const isSafeToEatFood = (
    foodPath: Point[],
    currentSnake: Point[]
  ): boolean => {
    if (foodPath.length < 2) return false;

    // ===== ADIM ADIM SİMÜLASYON =====
    // Yılanın yeme giderken her adımda nasıl değişeceğini gerçekçi şekilde simüle et
    let simulatedSnake = [...currentSnake.map(p => ({ ...p }))];

    // pathToFood dizisindeki her adımı takip et (ilk eleman mevcut konum, son eleman yem)
    for (let i = 1; i < foodPath.length; i++) {
      const nextHead = foodPath[i];
      
      // Yılanı hareket ettir
      if (i < foodPath.length - 1) {
        // Ara adımlar: baş ilerler, kuyruk kısalır (normal hareket)
        simulatedSnake = [nextHead, ...simulatedSnake.slice(0, -1)];
      } else {
        // SON adım: yemi yiyoruz, kuyruk kısalmaz (yılan uzar)
        simulatedSnake = [nextHead, ...simulatedSnake];
      }
    }

    // Artık simulatedSnake = yemi yedikten SONRAKİ gerçekçi yılan durumu

    // ===== KONTROL 1: Yeterince geniş alana mı erişiyoruz? =====
    const newHead = simulatedSnake[0];
    const obstaclesAfterEating = simulatedSnake.slice(1);
    const reachableAfterEating = countReachableSpaces(newHead, obstaclesAfterEating);
    const totalGridSpace = GRID_WIDTH * GRID_HEIGHT;
    const reachableRatio = reachableAfterEating / totalGridSpace;
    
    // En az grid alanının %25'ine erişebilmeliyiz (esnek)
    if (reachableRatio < MIN_SAFE_SPACE_RATIO) {
      return false; // Çok dar alan, güvenli değil
    }

    // ===== KONTROL 2: Kuyruk bölgesine ulaşabiliyor muyuz? =====
    const tailRegionSize = Math.min(TAIL_SAFE_DISTANCE, Math.floor(simulatedSnake.length * 0.2));
    const tailRegionStart = Math.max(1, simulatedSnake.length - tailRegionSize);
    
    // Kuyruk bölgesindeki herhangi bir segmente ulaşabilir miyiz?
    for (let i = tailRegionStart; i < simulatedSnake.length; i++) {
      const tailTarget = simulatedSnake[i];
      const obstaclesForTailCheck = [
        ...simulatedSnake.slice(1, i),
        ...simulatedSnake.slice(i + 1)
      ];
      
      const pathToTailSegment = findPathBFS(newHead, tailTarget, obstaclesForTailCheck);
      
      if (pathToTailSegment.length > 0) {
        // Kuyruk bölgesine ulaşabiliyoruz, GÜVENLİ!
        return true;
      }
    }

    // ===== KONTROL 3 (İYİLEŞTİRME): Erişilebilir alan yılan uzunluğunun %60'ından fazlaysa =====
    // Bu, kuyruk kontrolü başarısız olsa bile geniş alanda olduğumuzu gösterir
    if (reachableAfterEating >= simulatedSnake.length * 0.6) {
      return true; // Çok geniş alan var, muhtemelen güvenli
    }

    return false;
  };

  // ============= KATMAN 2: KUYRUK TAKİP MODU =============
  const findPathToTail = (head: Point, snake: Point[]): Point[] => {
    if (snake.length < 2) return [];
    
    const tail = snake[snake.length - 1];
    const obstacles = snake.slice(1, -1);
    
    return findPathBFS(head, tail, obstacles);
  };

  // ============= KATMAN 3: EN GÜVENLİ YÖN SEÇİMİ =============
  const findSafestDirection = (head: Point, snake: Point[]): Point | null => {
    const obstacles = snake.slice(1);
    
    let bestMove: Point | null = null;
    let maxSpaces = -1;

    for (const dir of DIRECTIONS) {
      const nextPos = { x: head.x + dir.x, y: head.y + dir.y };
      
      if (
        nextPos.x >= 0 &&
        nextPos.x < GRID_WIDTH &&
        nextPos.y >= 0 &&
        nextPos.y < GRID_HEIGHT &&
        !obstacles.some(seg => seg.x === nextPos.x && seg.y === nextPos.y)
      ) {
        const reachableSpaces = countReachableSpaces(nextPos, obstacles);
        
        if (reachableSpaces > maxSpaces) {
          maxSpaces = reachableSpaces;
          bestMove = nextPos;
        }
      }
    }

    return bestMove;
  };

  // ============= ANA KARAR MEKANİZMASI: 3 KATMANLI GÜVENLİK + SONSUZ DÖNGÜ ÖNLEYİCİ =============
  const findSmartNextMove = (
    head: Point,
    food: Point,
    snake: Point[],
    tailChaseCount: number // Kaç tick'tir kuyruk takibindeyiz
  ): Point | null => {
    const body = snake.slice(1);

    // ===== SONSUZ DÖNGÜ ÖNLEYİCİ (KRİTİK GÜVENLİK VALFİ) =====
    // Eğer çok uzun süredir (MAX_TAIL_CHASE_TICKS) kuyruk takibindeyse,
    // artık güvenlik kontrolünü atla ve ZORLA yeme git
    const shouldForceEat = tailChaseCount > MAX_TAIL_CHASE_TICKS;

    if (shouldForceEat) {
      // Zorla yeme gitme modu: güvenlik kontrolü YOK
      const pathToFood = findPathBFS(head, food, body);
      if (pathToFood.length > 1) {
        // Yeme giden yol var, direkt git (risk al, sonsuza dek beklemekten iyi)
        return pathToFood[1];
      }
    }

    // ===== KATMAN 1: YEME GÜVENLİ YOL VAR MI? =====
    const pathToFood = findPathBFS(head, food, body);
    
    if (pathToFood.length > 1) {
      // Yol bulundu, ama güvenli mi? (Gerçekçi adım adım simülasyon ile)
      const isSafe = isSafeToEatFood(pathToFood, snake);
      
      if (isSafe) {
        // GÜVENLİ! Yeme git
        return pathToFood[1];
      }
    }

    // ===== KATMAN 2: YEME GÜVENLİ YOL YOK, KUYRUĞU TAKİP ET =====
    const pathToTail = findPathToTail(head, snake);
    
    if (pathToTail.length > 1) {
      // Kuyruğa giden yol bulundu, onu takip et
      return pathToTail[1];
    }

    // ===== KATMAN 3: SON ÇARE, EN GÜVENLİ YÖNÜ SEÇ =====
    const safestMove = findSafestDirection(head, snake);
    
    if (safestMove) {
      return safestMove;
    }

    return null;
  };

  // ============= DİĞER YARDIMCI FONKSİYONLAR =============
  const checkCollision = (position: Point, body: Point[]): boolean => {
    if (position.x < 0 || position.x >= GRID_WIDTH || position.y < 0 || position.y >= GRID_HEIGHT) return true;
    for (let i = 1; i < body.length; i++) {
      if (position.x === body[i].x && position.y === body[i].y) return true;
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
      consecutiveTailChaseCount: 0, // Reset sayacı
    };

    setScore(0);
    setGameCount(prev => prev + 1);
  };

  const decreaseFps = () => setFps(prev => Math.max(MIN_FPS, prev - FPS_STEP));
  const increaseFps = () => setFps(prev => Math.min(MAX_FPS, prev + FPS_STEP));

  useEffect(() => {
    resetGame();
  }, []);

  // ============= OYUN MANTIĞI DÖNGÜSÜ (GELİŞTİRİLMİŞ SİSTEM) =============
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

      // ===== YENİ AKILLI KARAR MEKANİZMASI (SONSUZ DÖNGÜ ÖNLEYİCİ İLE) =====
      const nextPosition = findSmartNextMove(
        head, 
        state.food, 
        state.snake,
        state.consecutiveTailChaseCount // Kuyruk takip sayacını gönder
      );

      const finalNextPosition = nextPosition || {
        x: head.x + state.direction.x,
        y: head.y + state.direction.y,
      };

      // ===== KUYRUK TAKİP SAYACI YÖNETİMİ =====
      // Eğer yeme gidiyorsak sayacı sıfırla, kuyruk takibindeyse artır
      const pathToFood = findPathBFS(head, state.food, state.snake.slice(1));
      const isHeadingToFood = pathToFood.length > 1 && 
        pathToFood[1].x === finalNextPosition.x && 
        pathToFood[1].y === finalNextPosition.y;

      if (isHeadingToFood || state.consecutiveTailChaseCount > MAX_TAIL_CHASE_TICKS) {
        // Yeme gidiyor veya zorla yeme gönderildi, sayacı sıfırla
        state.consecutiveTailChaseCount = 0;
      } else {
        // Kuyruk takibi veya başka bir şey yapıyor, sayacı artır
        state.consecutiveTailChaseCount++;
      }

      state.direction = {
        x: finalNextPosition.x - head.x,
        y: finalNextPosition.y - head.y,
      };

      const newSnake = [finalNextPosition, ...state.snake];

      if (checkCollision(finalNextPosition, state.snake)) {
        state.isGameOver = true;
        state.deathTime = performance.now();
        state.particles = createFireParticles(state.snake);
        if (score > highScore) setHighScore(score);
        return;
      }

      if (finalNextPosition.x === state.food.x && finalNextPosition.y === state.food.y) {
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

  const drawGame = (
    ctx: CanvasRenderingContext2D, 
    state: typeof gameStateRef.current,
    interpolationFactor: number,
    currentTime: number
  ) => {
    const gradient = ctx.createLinearGradient(0, 0, 0, CANVAS_HEIGHT);
    gradient.addColorStop(0, COLORS.background);
    gradient.addColorStop(1, COLORS.backgroundGradient);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

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

    const foodX = state.food.x * CELL_SIZE;
    const foodY = state.food.y * CELL_SIZE;
    
    ctx.shadowBlur = 20;
    ctx.shadowColor = COLORS.food;
    ctx.fillStyle = COLORS.food;
    ctx.beginPath();
    ctx.arc(foodX + CELL_SIZE / 2, foodY + CELL_SIZE / 2, CELL_SIZE / 2 - 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    if (!state.isGameOver && state.snake.length > 0) {
      const interpolatedPositions = state.snake.map((segment, index) => {
        const prevSegment = state.previousSnake[index] || segment;
        const lerpX = prevSegment.x + (segment.x - prevSegment.x) * interpolationFactor;
        const lerpY = prevSegment.y + (segment.y - prevSegment.y) * interpolationFactor;
        return {
          x: lerpX * CELL_SIZE + CELL_SIZE / 2,
          y: lerpY * CELL_SIZE + CELL_SIZE / 2,
        };
      });

      const smoothCurve = generateSmoothCurve(interpolatedPositions);
      drawSnakeBody(ctx, smoothCurve);

      if (interpolatedPositions.length > 0) {
        drawSnakeHead(ctx, interpolatedPositions[0], state.direction);
      }
      
    } else if (state.isGameOver) {
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
          Gerçekçi Simülasyon + Sonsuz Döngü Önleyici
        </p>
      </div>

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

      <div className="relative shadow-2xl rounded-lg overflow-hidden border-4 border-purple-500">
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          className="block"
        />
      </div>

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
            <span className="text-gray-400">Döngü Koruması:</span>
            <span className="ml-2 font-bold text-green-400">{MAX_TAIL_CHASE_TICKS} tick</span>
          </div>
        </div>
        <div className="mt-4 text-center text-gray-400 text-xs">
          🧠 <strong>Adım Adım Simülasyon:</strong> Yılanın tüm yolu gerçekçi şekilde simüle edilir
        </div>
        <div className="mt-2 text-center text-green-400 text-xs font-semibold">
          ✨ Sonsuz Döngü Önleyici: {MAX_TAIL_CHASE_TICKS} tick kuyruk takibinden sonra ZORLA yeme gider
        </div>
        <div className="mt-2 text-center text-orange-400 text-xs">
          💡 3 kontrol: Alan (≥{(MIN_SAFE_SPACE_RATIO * 100).toFixed(0)}%) + Kuyruk bölgesi + Geniş alan bonusu
        </div>
      </div>

      <div className="mt-4 text-gray-400 text-xs text-center max-w-md">
        <p>🎮 Oyun tamamen otomatik - AI artık gerçekçi düşünüyor!</p>
        <p className="mt-1">⚡ Yukarıdaki butonlarla oyun hızını canlı olarak değiştirin</p>
      </div>
    </div>
  );
}

export default App;
