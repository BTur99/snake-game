(() => {
  'use strict';

  // ------------------------------------------------------------------ CONFIG

  const COLS = 21;
  const ROWS = 21;
  const START_LENGTH = 3;
  const CORNER_RADIUS = 0.34;
  const EYE_TURN_PORTION = 0.6;
  const MAX_QUEUE = 2;
  const SWIPE_THRESHOLD = 24;
  const MAX_DPR = 3;
  const OBSTACLE_BLOCKS = 6;
  const OBSTACLE_SIZE = 2;
  const OBSTACLE_MAX_TRIES = 240;
  const SAFE_ZONE = { minX: 6, maxX: 16, minY: 8, maxY: 12 };
  const STORAGE_KEY_PREFIX = 'snake:record:v2:';
  const LEGACY_STORAGE_KEY = 'snake:record:v1';

  const MODES = {
    slow: {
      id: 'slow',
      label: 'Медленный',
      speedLabel: '160 мс',
      stepMs: 160,
      obstacles: false,
      theme: 'default',
    },
    medium: {
      id: 'medium',
      label: 'Средний',
      speedLabel: '120 мс',
      stepMs: 120,
      obstacles: false,
      theme: 'default',
    },
    fast: {
      id: 'fast',
      label: 'Быстрый',
      speedLabel: '90 мс',
      stepMs: 90,
      obstacles: false,
      theme: 'default',
    },
    ultra: {
      id: 'ultra',
      label: 'Ультрахардкор',
      speedLabel: '75 мс · препятствия',
      stepMs: 75,
      obstacles: true,
      theme: 'ultra',
    },
  };
  const MODE_ORDER = ['slow', 'medium', 'fast', 'ultra'];
  const DEFAULT_MODE = 'medium';

  const PALETTE_VARS = {
    board: '--board',
    grid: '--grid',
    snake: '--snake',
    eyes: '--eyes',
    accent: '--accent',
    haloStrong: '--halo-strong',
    haloSoft: '--halo-soft',
    obstacle: '--obstacle',
    obstacleEdge: '--obstacle-edge',
  };

  // Значения по умолчанию совпадают с CSS; при смене темы перечитываются из
  // computed style один раз, а не каждый кадр.
  const palette = {
    board: '#0d1115',
    grid: 'rgba(255, 255, 255, 0.05)',
    snake: '#e8ede9',
    eyes: '#0b0f12',
    accent: '#7ce8c1',
    haloStrong: 'rgba(124, 232, 193, 0.26)',
    haloSoft: 'rgba(124, 232, 193, 0.1)',
    obstacle: '#3b1116',
    obstacleEdge: '#b23a42',
  };

  const DIRS = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
  };

  const KEY_DIRS = {
    ArrowUp: 'up',
    ArrowDown: 'down',
    ArrowLeft: 'left',
    ArrowRight: 'right',
    KeyW: 'up',
    KeyS: 'down',
    KeyA: 'left',
    KeyD: 'right',
  };

  const TAU = Math.PI * 2;

  function modeConfig(mode) {
    return MODES[mode] || MODES[DEFAULT_MODE];
  }

  function stepMsFor(mode) {
    return modeConfig(mode).stepMs;
  }

  // ------------------------------------------------------ STATE AND LOGIC

  function cloneCell(cell) {
    return { x: cell.x, y: cell.y };
  }

  function cellIndex(cols, x, y) {
    return y * cols + x;
  }

  function isInSafeZone(x, y) {
    return (
      x >= SAFE_ZONE.minX &&
      x <= SAFE_ZONE.maxX &&
      y >= SAFE_ZONE.minY &&
      y <= SAFE_ZONE.maxY
    );
  }

  function generateObstacles(cols, rows, snake, rng) {
    const occupied = new Set();

    for (let i = 0; i < snake.length; i += 1) {
      occupied.add(cellIndex(cols, snake[i].x, snake[i].y));
    }

    const obstacles = [];
    const maxX = cols - OBSTACLE_SIZE;
    const maxY = rows - OBSTACLE_SIZE;
    let tries = 0;

    if (maxX < 0 || maxY < 0) {
      return obstacles;
    }

    while (obstacles.length < OBSTACLE_BLOCKS * OBSTACLE_SIZE ** 2) {
      if (tries >= OBSTACLE_MAX_TRIES) {
        break;
      }

      tries += 1;

      const x = Math.min(maxX, Math.floor(rng() * (maxX + 1)));
      const y = Math.min(maxY, Math.floor(rng() * (maxY + 1)));
      const cells = [];
      let fits = true;

      for (let dy = 0; dy < OBSTACLE_SIZE && fits; dy += 1) {
        for (let dx = 0; dx < OBSTACLE_SIZE; dx += 1) {
          const cellX = x + dx;
          const cellY = y + dy;
          const index = cellIndex(cols, cellX, cellY);

          if (isInSafeZone(cellX, cellY) || occupied.has(index)) {
            fits = false;
            break;
          }

          cells.push({ x: cellX, y: cellY });
        }
      }

      if (!fits) {
        continue;
      }

      for (let i = 0; i < cells.length; i += 1) {
        occupied.add(cellIndex(cols, cells[i].x, cells[i].y));
        obstacles.push(cells[i]);
      }
    }

    return obstacles;
  }

  function spawnFood(snake, cols, rows, rng, obstacles = []) {
    const occupied = new Set();

    for (let i = 0; i < snake.length; i += 1) {
      occupied.add(cellIndex(cols, snake[i].x, snake[i].y));
    }

    for (let i = 0; i < obstacles.length; i += 1) {
      occupied.add(cellIndex(cols, obstacles[i].x, obstacles[i].y));
    }

    const free = [];

    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        if (!occupied.has(cellIndex(cols, x, y))) {
          free.push({ x, y });
        }
      }
    }

    if (free.length === 0) {
      return null;
    }

    const index = Math.min(free.length - 1, Math.floor(rng() * free.length));
    return free[index];
  }

  function createGame({
    cols = COLS,
    rows = ROWS,
    rng = Math.random,
    mode = DEFAULT_MODE,
  } = {}) {
    const config = modeConfig(mode);
    const centerX = Math.floor(cols / 2);
    const centerY = Math.floor(rows / 2);
    const snake = [];

    for (let i = 0; i < START_LENGTH; i += 1) {
      snake.push({ x: centerX - i, y: centerY });
    }

    const obstacles = config.obstacles
      ? generateObstacles(cols, rows, snake, rng)
      : [];

    return {
      cols,
      rows,
      rng,
      mode: config.id,
      obstacles,
      snake,
      prev: snake.map(cloneCell),
      dir: DIRS.right,
      queue: [],
      food: spawnFood(snake, cols, rows, rng, obstacles),
      score: 0,
      status: 'start',
    };
  }

  function queueDirection(game, name) {
    const dir = DIRS[name];

    if (!dir) {
      return game;
    }

    const last =
      game.queue.length > 0 ? game.queue[game.queue.length - 1] : game.dir;

    if (dir.x === last.x && dir.y === last.y) {
      return game;
    }

    if (dir.x + last.x === 0 && dir.y + last.y === 0) {
      return game;
    }

    if (game.queue.length >= MAX_QUEUE) {
      return game;
    }

    return { ...game, queue: game.queue.concat(dir) };
  }

  function hitsObstacle(obstacles, x, y) {
    for (let i = 0; i < obstacles.length; i += 1) {
      if (obstacles[i].x === x && obstacles[i].y === y) {
        return true;
      }
    }

    return false;
  }

  function step(game) {
    if (game.status !== 'playing') {
      return { state: game, event: null };
    }

    const head = game.snake[0];
    const dir = game.queue.length > 0 ? game.queue[0] : game.dir;
    const nextHead = { x: head.x + dir.x, y: head.y + dir.y };

    const outside =
      nextHead.x < 0 ||
      nextHead.y < 0 ||
      nextHead.x >= game.cols ||
      nextHead.y >= game.rows;

    if (outside || hitsObstacle(game.obstacles, nextHead.x, nextHead.y)) {
      return {
        state: { ...game, status: 'over', queue: [], prev: game.snake },
        event: { type: 'died' },
      };
    }

    const willEat =
      game.food !== null &&
      nextHead.x === game.food.x &&
      nextHead.y === game.food.y;

    // Хвост уходит в этом тике, если еды нет, поэтому последний сегмент
    // не считается препятствием.
    const bodyLimit = willEat ? game.snake.length : game.snake.length - 1;

    for (let i = 0; i < bodyLimit; i += 1) {
      const segment = game.snake[i];
      if (segment.x === nextHead.x && segment.y === nextHead.y) {
        return {
          state: { ...game, status: 'over', queue: [], prev: game.snake },
          event: { type: 'died' },
        };
      }
    }

    const queue = game.queue.slice(1);

    if (willEat) {
      const snake = [nextHead].concat(game.snake);
      const prev = game.snake.concat(game.snake[game.snake.length - 1]);
      const score = game.score + 1;
      const food = spawnFood(
        snake,
        game.cols,
        game.rows,
        game.rng,
        game.obstacles,
      );

      if (food === null) {
        return {
          state: {
            ...game,
            snake,
            prev,
            food: null,
            score,
            dir,
            queue,
            status: 'won',
          },
          event: { type: 'won', score },
        };
      }

      return {
        state: { ...game, snake, prev, food, score, dir, queue },
        event: { type: 'ate', score },
      };
    }

    const snake = [nextHead].concat(game.snake.slice(0, -1));

    return {
      state: { ...game, snake, prev: game.snake, dir, queue },
      event: { type: 'moved' },
    };
  }

  // ------------------------------------------------------------------- INPUT

  let pointerStart = null;

  function onDirection(name) {
    if (game.status === 'start') {
      startGame();
      game = queueDirection(game, name);
      return;
    }

    if (game.status === 'playing') {
      game = queueDirection(game, name);
    }
  }

  function onKeyDown(event) {
    if (event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }

    const isSpace = event.code === 'Space' || event.key === ' ';
    const isEnter = event.code === 'Enter' || event.key === 'Enter';

    if ((isSpace || isEnter) && event.repeat) {
      event.preventDefault();
      return;
    }

    const digit = /^Digit([1-4])$/.exec(event.code);

    if (digit && game.status === 'start' && !event.repeat) {
      event.preventDefault();
      selectMode(MODE_ORDER[Number(digit[1]) - 1]);
      return;
    }

    const active = document.activeElement;
    const onButton = active !== null && active.tagName === 'BUTTON';

    // Кнопка сама обработает Space/Enter нативным кликом.
    if (onButton && (isSpace || isEnter)) {
      return;
    }

    const direction = KEY_DIRS[event.code];

    if (direction) {
      event.preventDefault();
      onDirection(direction);
      return;
    }

    if (isSpace) {
      event.preventDefault();

      if (game.status === 'start') {
        startGame();
      } else if (game.status === 'playing') {
        pauseGame();
      } else if (game.status === 'paused') {
        resumeGame();
      }

      return;
    }

    if (isEnter) {
      event.preventDefault();

      if (game.status === 'start') {
        startGame();
      } else if (game.status === 'over' || game.status === 'won') {
        restartGame();
      }
    }
  }

  function onPointerDown(event) {
    if (!event.isPrimary) {
      return;
    }

    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }

    const target = event.target;
    const modeButton =
      target instanceof Element ? target.closest('[data-mode-button]') : null;

    pointerStart = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      mode: modeButton ? modeButton.dataset.modeButton : null,
    };
  }

  function onPointerUp(event) {
    if (pointerStart === null || event.pointerId !== pointerStart.id) {
      return;
    }

    const dx = event.clientX - pointerStart.x;
    const dy = event.clientY - pointerStart.y;
    const mode = pointerStart.mode;
    pointerStart = null;

    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_THRESHOLD) {
      return;
    }

    let direction;

    if (Math.abs(dx) >= Math.abs(dy)) {
      direction = dx > 0 ? 'right' : 'left';
    } else {
      direction = dy > 0 ? 'down' : 'up';
    }

    // Свайп, начатый на плитке, сначала выбирает этот режим, чтобы не
    // запустить игру в предыдущем. Короткий тап по плитке обрабатывает click.
    if (mode) {
      selectMode(mode);
    }

    onDirection(direction);
  }

  function onPointerCancel(event) {
    if (pointerStart !== null && event.pointerId === pointerStart.id) {
      pointerStart = null;
    }
  }

  function bindInput() {
    window.addEventListener('keydown', onKeyDown);

    els.stage.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);

    els.overlay.addEventListener('click', (event) => {
      const target = event.target;
      const element = target instanceof Element ? target : null;
      const modeButton = element
        ? element.closest('button[data-mode-button]')
        : null;

      if (modeButton) {
        selectMode(modeButton.dataset.modeButton);
        return;
      }

      const button = element ? element.closest('button[data-action]') : null;

      if (!button) {
        return;
      }

      const action = button.dataset.action;

      if (action === 'start') {
        startGame();
      } else if (action === 'resume') {
        resumeGame();
      } else if (action === 'restart') {
        restartGame();
      } else if (action === 'menu') {
        openMenu();
      }
    });

    els.pauseButton.addEventListener('click', togglePause);

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        autoPause();
      } else {
        lastTime = 0;
      }
    });

    window.addEventListener('blur', autoPause);

    window.addEventListener('focus', () => {
      lastTime = 0;
    });
  }

  // ------------------------------------------------------------------ RENDER

  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  let reducedMotion = motionQuery.matches;

  motionQuery.addEventListener('change', (event) => {
    reducedMotion = event.matches;
  });

  const view = {
    canvas: null,
    ctx: null,
    size: 0,
    cell: 0,
    dpr: 1,
    background: null,
    halo: null,
    haloSize: 0,
    path: [],
  };

  let els = null;

  let lastScore = null;
  let lastRecord = null;
  let lastModeName = null;
  let lastSelectedMode = null;
  let lastScreenMode = null;

  function buildBackground(size, cell, dpr) {
    const layer = document.createElement('canvas');
    layer.width = Math.max(1, Math.round(size * dpr));
    layer.height = layer.width;

    const layerCtx = layer.getContext('2d');
    layerCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    layerCtx.fillStyle = palette.board;
    layerCtx.fillRect(0, 0, size, size);

    layerCtx.fillStyle = palette.grid;
    const hairline = 1 / dpr;

    for (let x = 1; x < COLS; x += 1) {
      const lineX = Math.round(x * cell * dpr) / dpr;
      layerCtx.fillRect(lineX, 0, hairline, size);
    }

    for (let y = 1; y < ROWS; y += 1) {
      const lineY = Math.round(y * cell * dpr) / dpr;
      layerCtx.fillRect(0, lineY, size, hairline);
    }

    return layer;
  }

  function buildHalo(cell, dpr) {
    const cssSize = cell * 3;
    const layer = document.createElement('canvas');
    layer.width = Math.max(1, Math.round(cssSize * dpr));
    layer.height = layer.width;

    const layerCtx = layer.getContext('2d');
    layerCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const center = cssSize / 2;
    const gradient = layerCtx.createRadialGradient(
      center,
      center,
      0,
      center,
      center,
      center,
    );

    gradient.addColorStop(0, palette.haloStrong);
    gradient.addColorStop(0.42, palette.haloSoft);
    gradient.addColorStop(1, 'transparent');

    layerCtx.fillStyle = gradient;
    layerCtx.fillRect(0, 0, cssSize, cssSize);

    return layer;
  }

  function resizeBoard() {
    if (!view.canvas) {
      return;
    }

    const rect = view.canvas.getBoundingClientRect();
    const size = Math.min(rect.width, rect.height);

    if (size <= 0) {
      return;
    }

    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const pixelSize = Math.max(1, Math.round(size * dpr));

    view.size = size;
    view.cell = size / COLS;
    view.dpr = dpr;

    if (view.canvas.width !== pixelSize) {
      view.canvas.width = pixelSize;
    }

    if (view.canvas.height !== pixelSize) {
      view.canvas.height = pixelSize;
    }

    view.background = buildBackground(size, view.cell, dpr);
    view.halo = buildHalo(view.cell, dpr);
    view.haloSize = view.cell * 3;

    render(performance.now());
  }

  function snakeAlpha() {
    if (game.status === 'playing' || game.status === 'paused') {
      return Math.max(0, Math.min(1, acc / stepMsFor(game.mode)));
    }

    return game.status === 'start' ? 0 : 1;
  }

  function drawObstacles() {
    if (game.status === 'start' || game.obstacles.length === 0) {
      return;
    }

    const ctx = view.ctx;
    const cell = view.cell;
    const inset = cell * 0.1;
    const size = cell - inset * 2;
    const radius = cell * 0.2;

    ctx.fillStyle = palette.obstacle;
    ctx.strokeStyle = palette.obstacleEdge;
    ctx.lineWidth = Math.max(1, cell * 0.045);

    for (let i = 0; i < game.obstacles.length; i += 1) {
      const obstacle = game.obstacles[i];
      const x = obstacle.x * cell + inset;
      const y = obstacle.y * cell + inset;

      ctx.beginPath();

      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(x, y, size, size, radius);
      } else {
        ctx.rect(x, y, size, size);
      }

      ctx.fill();
      ctx.stroke();
    }
  }

  function drawFood(now) {
    if (!game.food) {
      return;
    }

    const ctx = view.ctx;
    const cell = view.cell;
    const x = (game.food.x + 0.5) * cell;
    const y = (game.food.y + 0.5) * cell;
    const pulse = reducedMotion ? 1 : 1 + Math.sin(now / 420) * 0.05;
    const haloSize = view.haloSize * pulse;

    ctx.drawImage(
      view.halo,
      x - haloSize / 2,
      y - haloSize / 2,
      haloSize,
      haloSize,
    );

    ctx.beginPath();
    ctx.arc(x, y, cell * 0.27 * pulse, 0, TAU);
    ctx.fillStyle = palette.accent;
    ctx.fill();
  }

  function drawEyes(headX, headY, alpha) {
    const ctx = view.ctx;
    const cell = view.cell;
    const prevHead = game.prev[0] || game.snake[0];
    const prevNeck = game.prev[1] || prevHead;
    let oldX = prevHead.x - prevNeck.x;
    let oldY = prevHead.y - prevNeck.y;
    const oldLength = Math.hypot(oldX, oldY);

    if (oldLength === 0) {
      oldX = game.dir.x;
      oldY = game.dir.y;
    } else {
      oldX /= oldLength;
      oldY /= oldLength;
    }

    // Взгляд доворачивается за первые 60% шага: к концу шага глаза уже смотрят
    // в новом направлении, без скачка на 90° за один кадр.
    const t = Math.max(0, Math.min(1, alpha / EYE_TURN_PORTION));
    const eased = t * t * (3 - 2 * t);
    let dirX = oldX + (game.dir.x - oldX) * eased;
    let dirY = oldY + (game.dir.y - oldY) * eased;
    const dirLength = Math.hypot(dirX, dirY) || 1;

    dirX /= dirLength;
    dirY /= dirLength;

    const perpX = -dirY;
    const perpY = dirX;
    const forward = cell * 0.165;
    const side = cell * 0.145;
    const radius = Math.max(1.1, cell * 0.07);

    ctx.fillStyle = palette.eyes;

    for (let sign = -1; sign <= 1; sign += 2) {
      ctx.beginPath();
      ctx.arc(
        headX + dirX * forward + perpX * side * sign,
        headY + dirY * forward + perpY * side * sign,
        radius,
        0,
        TAU,
      );
      ctx.fill();
    }
  }

  function pushPathPoint(path, length, x, y) {
    if (
      length > 0 &&
      Math.abs(path[length - 2] - x) < 0.01 &&
      Math.abs(path[length - 1] - y) < 0.01
    ) {
      return length;
    }

    path[length] = x;
    path[length + 1] = y;

    return length + 2;
  }

  function drawSnake(alpha) {
    const ctx = view.ctx;
    const cell = view.cell;
    const snake = game.snake;
    const prev = game.prev;
    const count = snake.length;

    if (count === 0) {
      return;
    }

    // Тело стоит на клеточном маршруте, двигаются только голова и хвост:
    // так изгибы не «дышат» от шага к шагу. Буфер — под count + 1 точку.
    const path = view.path;
    const capacity = (count + 1) * 2;

    if (path.length < capacity) {
      path.length = capacity;
    }

    const prevHead = prev[0] || snake[0];
    const moved = snake[0].x !== prevHead.x || snake[0].y !== prevHead.y;
    let pathLength = 0;

    if (!moved) {
      for (let i = 0; i < count; i += 1) {
        pathLength = pushPathPoint(
          path,
          pathLength,
          (snake[i].x + 0.5) * cell,
          (snake[i].y + 0.5) * cell,
        );
      }
    } else {
      pathLength = pushPathPoint(
        path,
        pathLength,
        (prevHead.x + (snake[0].x - prevHead.x) * alpha + 0.5) * cell,
        (prevHead.y + (snake[0].y - prevHead.y) * alpha + 0.5) * cell,
      );

      for (let i = 0; i < count - 1; i += 1) {
        pathLength = pushPathPoint(
          path,
          pathLength,
          (prev[i].x + 0.5) * cell,
          (prev[i].y + 0.5) * cell,
        );
      }

      if (count > 1) {
        const oldTail = prev[count - 1];
        const newTail = prev[count - 2];
        pathLength = pushPathPoint(
          path,
          pathLength,
          (oldTail.x + (newTail.x - oldTail.x) * alpha + 0.5) * cell,
          (oldTail.y + (newTail.y - oldTail.y) * alpha + 0.5) * cell,
        );
      }
    }

    ctx.strokeStyle = palette.snake;
    ctx.lineWidth = cell * 0.68;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(path[0], path[1]);

    // Каждый изгиб ленты, включая давно сформированный, скругляем одинаково.
    // Радиус ограничен половиной соседних отрезков, чтобы на коротких
    // сегментах скругления не наезжали друг на друга.
    const radiusLimit = cell * CORNER_RADIUS;
    const lastIndex = pathLength - 2;

    for (let i = 2; i < lastIndex; i += 2) {
      const prevX = path[i - 2];
      const prevY = path[i - 1];
      const currX = path[i];
      const currY = path[i + 1];
      const nextX = path[i + 2];
      const nextY = path[i + 3];
      const ax = currX - prevX;
      const ay = currY - prevY;
      const bx = nextX - currX;
      const by = nextY - currY;
      const lenA = Math.hypot(ax, ay);
      const lenB = Math.hypot(bx, by);
      const cross = ax * by - ay * bx;

      if (lenA < 0.01 || lenB < 0.01 || Math.abs(cross) < 0.01) {
        ctx.lineTo(currX, currY);
        continue;
      }

      const radius = Math.min(radiusLimit, lenA / 2, lenB / 2);
      ctx.lineTo(currX - (ax / lenA) * radius, currY - (ay / lenA) * radius);
      ctx.quadraticCurveTo(
        currX,
        currY,
        currX + (bx / lenB) * radius,
        currY + (by / lenB) * radius,
      );
    }

    ctx.lineTo(path[lastIndex], path[lastIndex + 1]);
    ctx.stroke();

    if (count === 1) {
      ctx.beginPath();
      ctx.arc(path[0], path[1], cell * 0.34, 0, TAU);
      ctx.fillStyle = palette.snake;
      ctx.fill();
    }

    drawEyes(path[0], path[1], alpha);
  }

  function render(now) {
    if (!view.ctx || view.size === 0 || !view.background) {
      return;
    }

    const ctx = view.ctx;

    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.clearRect(0, 0, view.size, view.size);
    ctx.drawImage(view.background, 0, 0, view.size, view.size);

    if (game.status !== 'start') {
      drawObstacles();
      drawFood(now);
      drawSnake(snakeAlpha());
    }
  }

  function overlayMode() {
    if (game.status === 'playing') {
      return 'none';
    }

    if (game.status === 'paused') {
      return 'pause';
    }

    return game.status;
  }

  function announce(message) {
    if (message === lastAnnouncement) {
      return;
    }

    lastAnnouncement = message;
    els.status.textContent = message;
  }

  function syncUI() {
    if (game.score !== lastScore) {
      lastScore = game.score;
      els.scoreValues.forEach((node) => {
        node.textContent = String(game.score);
      });
      els.finalScores.forEach((node) => {
        node.textContent = String(game.score);
      });
    }

    if (record !== lastRecord) {
      lastRecord = record;
      els.recordValues.forEach((node) => {
        node.textContent = String(record);
      });
    }

    const modeName = modeConfig(game.mode).label;

    if (modeName !== lastModeName) {
      lastModeName = modeName;
      els.modeName.textContent = modeName;
    }

    if (game.mode !== lastSelectedMode) {
      lastSelectedMode = game.mode;
      els.modeButtons.forEach((button) => {
        button.setAttribute(
          'aria-pressed',
          String(button.dataset.modeButton === game.mode),
        );
      });
    }

    const mode = overlayMode();

    if (mode !== lastScreenMode) {
      lastScreenMode = mode;
      els.overlay.dataset.mode = mode;
      els.overlay.setAttribute(
        'aria-hidden',
        mode === 'none' ? 'true' : 'false',
      );

      let activeScreen = null;

      els.screens.forEach((screen) => {
        const isActive = screen.dataset.screen === mode;
        screen.hidden = !isActive;

        if (isActive) {
          activeScreen = screen;
        }
      });

      if (mode === 'none') {
        if (els.overlay.contains(document.activeElement)) {
          document.activeElement.blur();
        }
      } else if (mode !== 'start' && document.hasFocus() && activeScreen) {
        const button = activeScreen.querySelector('button');

        if (button) {
          button.focus({ preventScroll: true });
        }
      }
    }

    const canPause = game.status === 'playing' || game.status === 'paused';
    const shouldDisable = !canPause;

    if (els.pauseButton.disabled !== shouldDisable) {
      els.pauseButton.disabled = shouldDisable;
    }

    const pauseState =
      game.status === 'paused'
        ? 'paused'
        : game.status === 'playing'
          ? 'playing'
          : 'idle';

    if (els.pauseButton.dataset.state !== pauseState) {
      els.pauseButton.dataset.state = pauseState;
    }

    const pauseLabel = game.status === 'paused' ? 'Продолжить' : 'Пауза';

    if (els.pauseButton.getAttribute('aria-label') !== pauseLabel) {
      els.pauseButton.setAttribute('aria-label', pauseLabel);
    }
  }

  function applyTheme(mode) {
    const theme = modeConfig(mode).theme;
    const root = document.documentElement;

    if (theme === 'ultra') {
      root.dataset.theme = 'ultra';
    } else {
      root.removeAttribute('data-theme');
    }

    syncPalette();

    if (els.metaTheme) {
      const background = window
        .getComputedStyle(root)
        .getPropertyValue('--bg')
        .trim();

      if (background) {
        els.metaTheme.setAttribute('content', background);
      }
    }

    if (view.canvas) {
      resizeBoard();
    }
  }

  function syncPalette() {
    const styles = window.getComputedStyle(document.documentElement);

    Object.keys(PALETTE_VARS).forEach((key) => {
      const value = styles.getPropertyValue(PALETTE_VARS[key]).trim();

      if (value) {
        palette[key] = value;
      }
    });
  }

  // -------------------------------------------------------------------- LOOP

  let game = createGame({ cols: COLS, rows: ROWS, mode: DEFAULT_MODE });
  let record = 0;
  let acc = 0;
  let lastTime = 0;
  let lastAnnouncement = '';

  function recordKey(mode) {
    return STORAGE_KEY_PREFIX + mode;
  }

  function readRecord(mode) {
    try {
      const raw = window.localStorage.getItem(recordKey(mode));
      const parsed = Number.parseInt(raw === null ? '' : raw, 10);

      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }

      if (mode === DEFAULT_MODE) {
        const legacyRaw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
        const legacy = Number.parseInt(legacyRaw === null ? '' : legacyRaw, 10);

        if (Number.isFinite(legacy) && legacy > 0) {
          window.localStorage.setItem(recordKey(mode), String(legacy));
          return legacy;
        }
      }

      return 0;
    } catch {
      return 0;
    }
  }

  function saveRecord(mode, value) {
    try {
      window.localStorage.setItem(recordKey(mode), String(value));
    } catch {
      // Приватный режим или запрет storage — рекорд просто не сохранится.
    }
  }

  function focusStartButton() {
    if (els.startButton) {
      els.startButton.focus({ preventScroll: true });
    }
  }

  function announceMode(config) {
    lastAnnouncement = '';
    const obstacles = config.obstacles ? ' С препятствиями.' : '';
    announce(
      `Режим: ${config.label}. Скорость ${config.stepMs} мс.${obstacles} ` +
        `Рекорд ${record}.`,
    );
  }

  function selectMode(modeId) {
    const config = MODES[modeId];

    if (!config || game.status !== 'start') {
      return;
    }

    game = createGame({ cols: COLS, rows: ROWS, mode: config.id });
    record = readRecord(config.id);
    lastRecord = null;
    acc = 0;
    lastTime = 0;
    applyTheme(config.id);
    syncUI();
    focusStartButton();
    announceMode(config);
  }

  function startGame() {
    if (game.status !== 'start') {
      return;
    }

    game = { ...game, status: 'playing' };
    acc = 0;
    lastTime = 0;
    syncUI();
    announce('Игра началась. Счёт 0.');
  }

  function restartGame() {
    const mode = game.mode;
    game = createGame({ cols: COLS, rows: ROWS, mode });
    game = { ...game, status: 'playing' };
    lastRecord = null;
    acc = 0;
    lastTime = 0;
    syncUI();
    announce('Игра началась. Счёт 0.');
  }

  function openMenu() {
    const mode = game.mode;
    game = createGame({ cols: COLS, rows: ROWS, mode });
    lastRecord = null;
    acc = 0;
    lastTime = 0;
    syncUI();
    render(performance.now());
    focusStartButton();
    announce(`Выбор режима. ${modeConfig(mode).label}. Рекорд ${record}.`);
  }

  function pauseGame() {
    if (game.status !== 'playing') {
      return;
    }

    game = { ...game, status: 'paused' };
    syncUI();
    announce('Пауза.');
    render(performance.now());
  }

  function resumeGame() {
    if (game.status !== 'paused') {
      return;
    }

    game = { ...game, status: 'playing' };
    lastTime = 0;
    syncUI();
    announce('Продолжение.');
  }

  function togglePause() {
    if (game.status === 'playing') {
      pauseGame();
    } else if (game.status === 'paused') {
      resumeGame();
    }
  }

  function autoPause() {
    if (game.status === 'playing') {
      pauseGame();
    }
  }

  function handleStep(result) {
    game = result.state;
    const event = result.event;

    if (!event) {
      return;
    }

    if ((event.type === 'ate' || event.type === 'won') && game.score > record) {
      record = game.score;
      saveRecord(game.mode, record);
    }

    if (event.type === 'ate') {
      syncUI();
      announce(`Счёт ${game.score}.`);
    } else if (event.type === 'died') {
      acc = 0;
      syncUI();
      announce(`Игра окончена. Счёт ${game.score}. Рекорд ${record}.`);
    } else if (event.type === 'won') {
      acc = 0;
      syncUI();
      announce(`Победа. Счёт ${game.score}.`);
    }
  }

  function frame(now) {
    if (lastTime === 0) {
      lastTime = now;
    }

    const dt = Math.min(now - lastTime, 250);
    lastTime = now;

    // devicePixelRatio может измениться без resize (перенос окна на другой
    // монитор), поэтому проверяем его в цикле и пересобираем canvas.
    if (Math.min(window.devicePixelRatio || 1, MAX_DPR) !== view.dpr) {
      resizeBoard();
    }

    const wasPlaying = game.status === 'playing';

    if (wasPlaying) {
      const stepMs = stepMsFor(game.mode);
      acc += dt;
      let steps = 0;

      while (acc >= stepMs && steps < 4) {
        const result = step(game);
        acc -= stepMs;
        handleStep(result);
        steps += 1;

        if (game.status !== 'playing') {
          acc = 0;
          break;
        }
      }
    }

    if (wasPlaying) {
      render(now);
    }

    window.requestAnimationFrame(frame);
  }

  // --------------------------------------------------------------- BOOTSTRAP

  function buildModePicker() {
    MODE_ORDER.forEach((modeId, index) => {
      const config = MODES[modeId];
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'mode-btn';
      button.dataset.modeButton = modeId;
      button.setAttribute('aria-pressed', 'false');
      button.setAttribute('aria-keyshortcuts', String(index + 1));
      button.setAttribute(
        'aria-label',
        `${config.label}, ${config.speedLabel}`,
      );

      const name = document.createElement('span');
      name.className = 'mode-name';
      name.textContent = config.label;

      const speed = document.createElement('span');
      speed.className = 'mode-speed';
      speed.textContent = config.speedLabel;

      button.append(name, speed);
      els.modePicker.append(button);
    });

    els.modeButtons = Array.from(
      els.modePicker.querySelectorAll('[data-mode-button]'),
    );
  }

  function bootstrap() {
    els = {
      stage: document.querySelector('.stage'),
      overlay: document.getElementById('overlay'),
      screens: Array.from(document.querySelectorAll('.screen')),
      scoreValues: Array.from(document.querySelectorAll('[data-score]')),
      finalScores: Array.from(document.querySelectorAll('[data-final-score]')),
      recordValues: Array.from(document.querySelectorAll('[data-record]')),
      pauseButton: document.getElementById('pauseButton'),
      status: document.getElementById('status'),
      modePicker: document.querySelector('[data-mode-picker]'),
      modeName: document.querySelector('[data-mode-name]'),
      startButton: document.querySelector('button[data-action="start"]'),
      metaTheme: document.querySelector('meta[name="theme-color"]'),
      modeButtons: [],
    };

    view.canvas = document.getElementById('board');
    view.ctx = view.canvas.getContext('2d');

    buildModePicker();

    record = readRecord(game.mode);

    bindInput();
    applyTheme(game.mode);
    syncUI();

    const observer = new ResizeObserver(resizeBoard);
    observer.observe(els.stage);
    resizeBoard();

    window.requestAnimationFrame(frame);
  }

  bootstrap();
})();
