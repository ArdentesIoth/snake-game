import { useEffect, useRef, useState } from 'react';

// ============= AYARLAR =============
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;
const CELL_SIZE = 20; // 20x20 piksel hücreler
const GRID_WIDTH = CANVAS_WIDTH / CELL_SIZE; // 40
const GRID_HEIGHT = CANVAS_HEIGHT / CELL_SIZE; // 30
const FPS = 10; // Oyun hızı (artırarak hızlandırabilirsiniz)

// Renkler
const COLORS = {
  background: '#1a1a2e',
  backgroundGradient: '#16213e',
  snake: '#00ff88',
  snakeHead: '#00cc6a',
  food: '#ff0066',
  text: '#ffffff',
  scoreGlow: '#ffd700',
};

interface Point {
  x: number;
  y: number;
}

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [score, setScore] = useState(0);
  const [levelUp, setLevelUp] = useState(false);
  const gameStateRef = useRef({
    snake: [{ x: 0, y: 0 }],
    food: { x: 10, y: 10 },
    hamiltonianPath: [] as Point[],
    pathIndex: 0,
    hasEaten: false,
  });

  // Hamiltonian Cycle oluştur - Zigzag pattern
  const createHamiltonianCycle = (): Point[] => {
    const path: Point[] = [];
    
    // Zigzag pattern: Her satırda sağa git, sonra alta in, sola git, alta in...
    for (let y = 0; y < GRID_HEIGHT; y++) {
      if (y % 2 === 0) {
        // Sağa git
        for (let x = 0; x < GRID_WIDTH; x++) {
          path.push({ x, y });
        }
      } else {
        // Sola git
        for (let x = GRID_WIDTH - 1; x >= 0; x--) {
          path.push({ x, y });
        }
      }
    }
    
    return path;
  };

  // Rastgele yem konumu oluştur
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

  // Oyunu başlat
  useEffect(() => {
    const hamiltonianPath = createHamiltonianCycle();
    const startPoint = hamiltonianPath[0];
    
    gameStateRef.current = {
      snake: [startPoint],
      food: generateFood([startPoint]),
      hamiltonianPath,
      pathIndex: 0,
      hasEaten: false,
    };
  }, []);

  // Oyun döngüsü
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const gameLoop = setInterval(() => {
      const state = gameStateRef.current;
      
      // Hamiltonian yolu takip et
      state.pathIndex = (state.pathIndex + 1) % state.hamiltonianPath.length;
      const nextPosition = state.hamiltonianPath[state.pathIndex];

      // Yılanı hareket ettir
      const newSnake = [nextPosition, ...state.snake];
      
      // Yem yendi mi kontrol et
      if (nextPosition.x === state.food.x && nextPosition.y === state.food.y) {
        state.hasEaten = true;
        setScore(prev => prev + 1);
        state.food = generateFood(newSnake);
        
        // Level up efekti
        setLevelUp(true);
        setTimeout(() => setLevelUp(false), 300);
      } else {
        // Yem yenmediyse kuyruk kısalır
        newSnake.pop();
      }

      state.snake = newSnake;

      // Çizim
      drawGame(ctx, state);
    }, 1000 / FPS);

    return () => clearInterval(gameLoop);
  }, []);

  // Oyunu çiz
  const drawGame = (ctx: CanvasRenderingContext2D, state: typeof gameStateRef.current) => {
    // Gradient arka plan
    const gradient = ctx.createLinearGradient(0, 0, 0, CANVAS_HEIGHT);
    gradient.addColorStop(0, COLORS.background);
    gradient.addColorStop(1, COLORS.backgroundGradient);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Grid çizgileri (opsiyonel, hafif)
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

    // Yem çiz (parlayan efekt)
    const foodX = state.food.x * CELL_SIZE;
    const foodY = state.food.y * CELL_SIZE;
    
    // Glow efekti
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

    // Yılan çiz
    state.snake.forEach((segment, index) => {
      const x = segment.x * CELL_SIZE;
      const y = segment.y * CELL_SIZE;

      if (index === 0) {
        // Baş - daha parlak
        ctx.fillStyle = COLORS.snakeHead;
        ctx.shadowBlur = 15;
        ctx.shadowColor = COLORS.snake;
      } else {
        // Gövde - gradient efekt
        const opacity = 1 - (index / state.snake.length) * 0.3;
        ctx.fillStyle = COLORS.snake;
        ctx.globalAlpha = opacity;
        ctx.shadowBlur = 5;
        ctx.shadowColor = COLORS.snake;
      }

      // Yuvarlak köşeli dikdörtgen
      const radius = 4;
      ctx.beginPath();
      ctx.roundRect(x + 1, y + 1, CELL_SIZE - 2, CELL_SIZE - 2, radius);
      ctx.fill();
      
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
    });
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900">
      <div className="mb-6 text-center">
        <h1 className="text-4xl font-bold text-white mb-2">
          🤖 AI Yılan Oyunu
        </h1>
        <p className="text-gray-300 text-sm">
          Hamiltonian Cycle Algoritması ile Otomatik Oynuyor
        </p>
      </div>

      {/* Skor Göstergesi */}
      <div 
        className={`mb-4 transition-all duration-300 ${
          levelUp ? 'scale-125' : 'scale-100'
        }`}
      >
        <div className="bg-gradient-to-r from-yellow-400 via-yellow-500 to-yellow-600 text-gray-900 px-8 py-4 rounded-lg shadow-2xl">
          <div className="text-center">
            <div className="text-sm font-semibold uppercase tracking-wider">Skor</div>
            <div className={`text-6xl font-bold ${levelUp ? 'animate-pulse' : ''}`}>
              {score}
            </div>
          </div>
        </div>
        {levelUp && (
          <div className="text-center mt-2 text-yellow-400 font-bold text-xl animate-bounce">
            🎉 +1
          </div>
        )}
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
            <span className="text-gray-400">Maksimum:</span>
            <span className="ml-2 font-bold">{GRID_WIDTH * GRID_HEIGHT}</span>
          </div>
          <div>
            <span className="text-gray-400">Hız (FPS):</span>
            <span className="ml-2 font-bold">{FPS}</span>
          </div>
          <div>
            <span className="text-gray-400">İlerleme:</span>
            <span className="ml-2 font-bold">
              {((score / (GRID_WIDTH * GRID_HEIGHT - 1)) * 100).toFixed(1)}%
            </span>
          </div>
        </div>
        <div className="mt-4 text-center text-gray-400 text-xs">
          💡 Hamiltonian Cycle algoritması sayesinde yılan hiç ölmeden tüm ekranı doldurur
        </div>
      </div>

      {/* Kontroller */}
      <div className="mt-4 text-gray-400 text-xs">
        <p>🎮 Oyun tamamen otomatik - hiçbir tuşa basmanıza gerek yok!</p>
        <p className="mt-1">⚙️ Hızı ayarlamak için App.tsx dosyasındaki FPS değişkenini değiştirin</p>
      </div>
    </div>
  );
}

export default App;
