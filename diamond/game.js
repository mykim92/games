/**
 * DIAMOND GAME (CHINESE CHECKERS) - GAME LOGIC & AI ENGINE
 */

// --- BOARD STRUCTURE AND GEOMETRY ---
const C = [
  1, 2, 3, 4,                         // Top triangle (AI start / Player target) - Rows 0-3
  13, 12, 11, 10, 9, 10, 11, 12, 13,  // Middle hexagon and wings - Rows 4-12
  4, 3, 2, 1                          // Bottom triangle (Player start / AI target) - Rows 13-16
];

const dy = Math.sqrt(3) / 2;
const spacing = 60; // Spacing multiplier for 1000x1000 viewBox

const nodes = [];
const nodesMap = {};
const neighbors = {};
const collinearLookup = {};

// Distance maps (BFS step counts)
const distToPlayerTarget = {};
const distToAITarget = {};

// 6-pointed star zones definition (10 holes per triangle corner)
const playerStartZone = [
  '13_0', '13_1', '13_2', '13_3',
  '14_0', '14_1', '14_2',
  '15_0', '15_1',
  '16_0'
];

const playerTargetZone = [
  '0_0',
  '1_0', '1_1',
  '2_0', '2_1', '2_2',
  '3_0', '3_1', '3_2', '3_3'
];

const aiStartZone = [
  '7_0',
  '6_0', '6_1',
  '5_0', '5_1', '5_2',
  '4_0', '4_1', '4_2', '4_3'
];

const aiTargetZone = [
  '9_9',
  '10_9', '10_10',
  '11_9', '11_10', '11_11',
  '12_9', '12_10', '12_11', '12_12'
];

// Game State
let boardState = {}; // maps nodeId -> 'player' | 'ai' | null
let activeTurn = 'player'; // 'player' | 'ai'
let selectedPieceId = null;
let aiDifficulty = 3; // Default level 3
let moveCount = 0;
let startTime = null;
let timerInterval = null;
let isGameOver = false;

// DOM Elements
let boardSvg, holesGroup, gridLinesGroup, piecesGroup, pathsGroup;
let moveCountEl, playTimeEl, turnIndicatorEl, turnTextEl;
let gameOverOverlay, modalTitle, modalText, modalRestartBtn;
let rulesOverlay, showRulesBtn, rulesCloseBtn;
let diffButtons;

// --- INITIALIZATION ---

document.addEventListener('DOMContentLoaded', () => {
  initDOM();
  initBoardData();
  renderBoardElements();
  resetGame();
  initConfetti();
});

function initDOM() {
  boardSvg = document.getElementById('game-board');
  holesGroup = document.getElementById('holes-group');
  gridLinesGroup = document.getElementById('grid-lines-group');
  piecesGroup = document.getElementById('pieces-group');
  pathsGroup = document.getElementById('paths-group');
  
  moveCountEl = document.getElementById('move-count');
  playTimeEl = document.getElementById('play-time');
  turnIndicatorEl = document.getElementById('turn-indicator');
  turnTextEl = document.getElementById('turn-text');
  
  gameOverOverlay = document.getElementById('game-over-overlay');
  modalTitle = document.getElementById('modal-title');
  modalText = document.getElementById('modal-text');
  modalRestartBtn = document.getElementById('modal-restart-btn');
  
  rulesOverlay = document.getElementById('rules-overlay');
  showRulesBtn = document.getElementById('show-rules-btn');
  rulesCloseBtn = document.getElementById('rules-close-btn');
  
  // Difficulty buttons
  diffButtons = document.querySelectorAll('.diff-btn');
  diffButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      if (isGameOver) return;
      diffButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      aiDifficulty = parseInt(btn.dataset.level);
    });
  });

  // Actions
  document.getElementById('restart-btn').addEventListener('click', resetGame);
  modalRestartBtn.addEventListener('click', () => {
    hideOverlay(gameOverOverlay);
    resetGame();
  });
  
  showRulesBtn.addEventListener('click', () => showOverlay(rulesOverlay));
  rulesCloseBtn.addEventListener('click', () => hideOverlay(rulesOverlay));
}

function showOverlay(overlay) {
  overlay.classList.add('active');
}

function hideOverlay(overlay) {
  overlay.classList.remove('active');
}

// Generate nodes & connections
function initBoardData() {
  // 1. Generate nodes
  for (let r = 0; r < C.length; r++) {
    for (let c = 0; c < C[r]; c++) {
      const x = c - (C[r] - 1) / 2;
      const y = (r - 8) * dy;
      
      const id = `${r}_${c}`;
      const cx = 500 + x * spacing;
      const cy = 500 + y * spacing;
      
      const node = { r, c, x, y, id, cx, cy };
      nodes.push(node);
      nodesMap[id] = node;
    }
  }

  // 2. Precalculate neighbors (distance = 1)
  for (const n of nodes) {
    neighbors[n.id] = [];
    for (const other of nodes) {
      if (n.id === other.id) continue;
      const dist = Math.hypot(n.x - other.x, n.y - other.y);
      if (Math.abs(dist - 1) < 0.01) {
        neighbors[n.id].push(other.id);
      }
    }
  }

  // 3. Precalculate collinear node for jumping
  // If moving A -> B -> C in a straight line (where B is neighbor of A, and C is neighbor of B)
  // vector(B - A) == vector(C - B) => C = 2 * B - A
  for (const a of nodes) {
    collinearLookup[a.id] = {};
    for (const bId of neighbors[a.id]) {
      const b = nodesMap[bId];
      const xc = 2 * b.x - a.x;
      const yc = 2 * b.y - a.y;
      
      const c = nodes.find(n => Math.hypot(n.x - xc, n.y - yc) < 0.01);
      collinearLookup[a.id][bId] = c ? c.id : null;
    }
  }

  // 4. Precalculate BFS distances to top/bottom tips
  calculateBFSDistances();
}

function calculateBFSDistances() {
  // BFS from Player Target Tip (0_0)
  const queuePlayer = [{ id: '0_0', dist: 0 }];
  const visitedPlayer = new Set(['0_0']);
  
  while (queuePlayer.length > 0) {
    const { id, dist } = queuePlayer.shift();
    distToPlayerTarget[id] = dist;
    for (const nId of neighbors[id]) {
      if (!visitedPlayer.has(nId)) {
        visitedPlayer.add(nId);
        queuePlayer.push({ id: nId, dist: dist + 1 });
      }
    }
  }

  // BFS from AI Target Tip (9_9)
  const queueAI = [{ id: '9_9', dist: 0 }];
  const visitedAI = new Set(['9_9']);
  
  while (queueAI.length > 0) {
    const { id, dist } = queueAI.shift();
    distToAITarget[id] = dist;
    for (const nId of neighbors[id]) {
      if (!visitedAI.has(nId)) {
        visitedAI.add(nId);
        queueAI.push({ id: nId, dist: dist + 1 });
      }
    }
  }
}

// --- RENDERING ---

function renderBoardElements() {
  // Clear any existing rendering
  gridLinesGroup.innerHTML = '';
  holesGroup.innerHTML = '';
  
  // 1. Draw Grid Lines
  const drawnLines = new Set();
  for (const a of nodes) {
    for (const bId of neighbors[a.id]) {
      const b = nodesMap[bId];
      const lineKey = a.id < bId ? `${a.id}-${bId}` : `${bId}-${a.id}`;
      if (!drawnLines.has(lineKey)) {
        drawnLines.add(lineKey);
        
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', a.cx);
        line.setAttribute('y1', a.cy);
        line.setAttribute('x2', b.cx);
        line.setAttribute('y2', b.cy);
        line.setAttribute('class', 'grid-line');
        line.setAttribute('id', `line-${lineKey}`);
        gridLinesGroup.appendChild(line);
      }
    }
  }

  // 2. Draw Holes
  for (const n of nodes) {
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', n.cx);
    circle.setAttribute('cy', n.cy);
    circle.setAttribute('r', 16);
    circle.setAttribute('class', 'hole');
    circle.setAttribute('id', `hole-${n.id}`);
    circle.setAttribute('data-id', n.id);
    
    // Add click handler to hole
    circle.addEventListener('click', () => handleHoleClick(n.id));
    
    group.appendChild(circle);
    
    // Add decorative zone markers
    if (playerTargetZone.includes(n.id)) {
      // Player Target Zone - Green highlight (where player needs to go)
      const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      ring.setAttribute('cx', n.cx);
      ring.setAttribute('cy', n.cy);
      ring.setAttribute('r', 6);
      ring.setAttribute('fill', '#10b981');
      ring.setAttribute('opacity', '0.25');
      ring.setAttribute('style', 'pointer-events: none;');
      group.appendChild(ring);
    } else if (aiTargetZone.includes(n.id)) {
      // AI Target Zone - Red highlight (where AI needs to go)
      const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      ring.setAttribute('cx', n.cx);
      ring.setAttribute('cy', n.cy);
      ring.setAttribute('r', 6);
      ring.setAttribute('fill', '#f43f5e');
      ring.setAttribute('opacity', '0.25');
      ring.setAttribute('style', 'pointer-events: none;');
      group.appendChild(ring);
    }

    holesGroup.appendChild(group);
  }
}

function resetGame() {
  isGameOver = false;
  moveCount = 0;
  moveCountEl.textContent = '0';
  
  // Reset timer
  if (timerInterval) clearInterval(timerInterval);
  startTime = Date.now();
  updateTimer();
  timerInterval = setInterval(updateTimer, 1000);
  
  selectedPieceId = null;
  activeTurn = 'player';
  
  // Set up board state
  boardState = {};
  for (const n of nodes) {
    if (aiStartZone.includes(n.id)) {
      boardState[n.id] = 'ai';
    } else if (playerStartZone.includes(n.id)) {
      boardState[n.id] = 'player';
    } else {
      boardState[n.id] = null;
    }
  }

  updateTurnUI();
  renderPieces();
  clearHighlights();
}

function updateTimer() {
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const s = String(elapsed % 60).padStart(2, '0');
  playTimeEl.textContent = `${m}:${s}`;
}

function renderPieces() {
  piecesGroup.innerHTML = '';
  
  for (const n of nodes) {
    const owner = boardState[n.id];
    if (owner) {
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', `piece ${owner}`);
      g.setAttribute('id', `piece-group-${n.id}`);
      g.setAttribute('data-node-id', n.id);
      
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', n.cx);
      circle.setAttribute('cy', n.cy);
      circle.setAttribute('r', 16);
      circle.setAttribute('fill', owner === 'player' ? 'url(#player-marble)' : 'url(#ai-marble)');
      circle.setAttribute('filter', 'url(#piece-shadow)');
      
      g.appendChild(circle);
      
      // Interactive events for player pieces
      if (owner === 'player') {
        g.addEventListener('click', (e) => {
          e.stopPropagation();
          handlePieceSelect(n.id);
        });
      }
      
      piecesGroup.appendChild(g);
    }
  }
}

// Animate piece movement from one node to another
function animatePiece(fromId, toId, callback) {
  const pieceG = document.getElementById(`piece-group-${fromId}`);
  if (!pieceG) {
    if (callback) callback();
    return;
  }
  
  const toNode = nodesMap[toId];
  const circle = pieceG.querySelector('circle');
  
  // Use transition to animate
  circle.style.transition = 'cx 0.45s cubic-bezier(0.25, 1, 0.5, 1), cy 0.45s cubic-bezier(0.25, 1, 0.5, 1)';
  circle.setAttribute('cx', toNode.cx);
  circle.setAttribute('cy', toNode.cy);
  
  // Update IDs after animation finishes
  setTimeout(() => {
    circle.style.transition = '';
    pieceG.setAttribute('id', `piece-group-${toId}`);
    pieceG.setAttribute('data-node-id', toId);
    
    // If it's an AI piece, we need to add the click listener if it somehow switched owners, but it doesn't.
    // However, if we moved a player piece, update its event listener target
    if (boardState[toId] === 'player') {
      // Re-bind select event to new closure to capture updated node ID
      const newG = pieceG.cloneNode(true);
      newG.addEventListener('click', (e) => {
        e.stopPropagation();
        handlePieceSelect(toId);
      });
      pieceG.replaceWith(newG);
    }
    
    if (callback) callback();
  }, 450);
}

// --- GAME LOGIC ---

// Find all legal moves for a piece at startId
function getValidMoves(startId, state = boardState) {
  const owner = state[startId];
  if (!owner) return [];
  
  const startNode = nodesMap[startId];
  const valid = [];
  
  // 1. Single steps (adjacent empty neighbors)
  for (const nId of neighbors[startId]) {
    if (state[nId] === null) {
      valid.push(nId);
    }
  }
  
  // 2. Jumps (using BFS to find all jump chains)
  const jumps = getJumpsBFS(startId, state);
  valid.push(...jumps);
  
  // 3. Apply target triangle restrictions:
  // "Once a piece enters its target triangle, it cannot leave it."
  const isCurrentlyInGoal = (owner === 'player' && playerTargetZone.includes(startId)) || 
                             (owner === 'ai' && aiTargetZone.includes(startId));
  
  if (isCurrentlyInGoal) {
    return valid.filter(destId => {
      if (owner === 'player') {
        return playerTargetZone.includes(destId);
      } else {
        return aiTargetZone.includes(destId);
      }
    });
  }
  
  return valid;
}

// Calculate jumps from startId
function getJumpsBFS(startId, state) {
  const reachable = [];
  const queue = [startId];
  const visited = new Set([startId]);
  
  while (queue.length > 0) {
    const currId = queue.shift();
    
    for (const bId of neighbors[currId]) {
      // Must jump over an OCCUPIED node
      if (state[bId] !== null) {
        // Look up collinear node behind it
        const cId = collinearLookup[currId][bId];
        // Collinear node must exist, be empty, and not visited yet in this chain
        if (cId && state[cId] === null && !visited.has(cId)) {
          visited.add(cId);
          reachable.push(cId);
          queue.push(cId);
        }
      }
    }
  }
  return reachable;
}

// --- INTERACTIVE EVENTS ---

function handlePieceSelect(nodeId) {
  if (activeTurn !== 'player' || isGameOver) return;
  
  // If clicking already selected piece, deselect
  if (selectedPieceId === nodeId) {
    clearSelection();
    return;
  }
  
  clearSelection();
  selectedPieceId = nodeId;
  
  // Visual select glow
  const pieceG = document.getElementById(`piece-group-${nodeId}`);
  if (pieceG) pieceG.classList.add('selected');
  
  // Find and highlight moves
  const moves = getValidMoves(nodeId);
  highlightMoves(nodeId, moves);
}

function handleHoleClick(nodeId) {
  if (activeTurn !== 'player' || !selectedPieceId || isGameOver) return;
  
  const holeEl = document.getElementById(`hole-${nodeId}`);
  if (!holeEl || !holeEl.classList.contains('valid-target')) return;
  
  // Execute move
  executePlayerMove(selectedPieceId, nodeId);
}

function clearSelection() {
  if (selectedPieceId) {
    const prevPieceG = document.getElementById(`piece-group-${selectedPieceId}`);
    if (prevPieceG) prevPieceG.classList.remove('selected');
  }
  selectedPieceId = null;
  clearHighlights();
}

function highlightMoves(fromId, moves) {
  clearHighlights();
  
  const fromNode = nodesMap[fromId];
  
  for (const toId of moves) {
    const toNode = nodesMap[toId];
    
    // Highlight hole
    const holeEl = document.getElementById(`hole-${toId}`);
    if (holeEl) holeEl.classList.add('valid-target');
    
    // Draw visual path line
    const pathLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    pathLine.setAttribute('x1', fromNode.cx);
    pathLine.setAttribute('y1', fromNode.cy);
    pathLine.setAttribute('x2', toNode.cx);
    pathLine.setAttribute('y2', toNode.cy);
    pathLine.setAttribute('stroke', 'rgba(212, 175, 55, 0.4)');
    pathLine.setAttribute('stroke-width', '2');
    pathLine.setAttribute('stroke-dasharray', '4 4');
    pathLine.setAttribute('class', 'path-highlight');
    pathsGroup.appendChild(pathLine);
  }
}

function clearHighlights() {
  const highlightedHoles = document.querySelectorAll('.hole.valid-target');
  highlightedHoles.forEach(h => h.classList.remove('valid-target'));
  pathsGroup.innerHTML = '';
}

function executePlayerMove(fromId, toId) {
  clearSelection();
  
  // Update board state
  boardState[fromId] = null;
  boardState[toId] = 'player';
  
  moveCount++;
  moveCountEl.textContent = moveCount;
  
  activeTurn = 'ai';
  updateTurnUI();
  
  animatePiece(fromId, toId, () => {
    // Check win condition
    const winCheck = checkWinner(boardState);
    if (winCheck.isOver) {
      declareGameOver(winCheck.winner);
    } else {
      // PC turn delay
      setTimeout(executeAIMove, 600);
    }
  });
}

function updateTurnUI() {
  if (activeTurn === 'player') {
    turnIndicatorEl.className = 'turn-indicator player-turn active-turn';
    turnTextEl.textContent = '당신의 차례';
  } else {
    turnIndicatorEl.className = 'turn-indicator ai-turn active-turn';
    turnTextEl.textContent = 'PC 생각 중...';
  }
}

// --- WIN CONDITION CHECK ---

function checkWinner(state) {
  const playerInGoal = playerTargetZone.filter(id => state[id] === 'player').length;
  const aiInPlayerGoal = playerTargetZone.filter(id => state[id] === 'ai').length;
  
  const aiInGoal = aiTargetZone.filter(id => state[id] === 'ai').length;
  const playerInAiGoal = aiTargetZone.filter(id => state[id] === 'player').length;

  // Win formulas (including blocked spaces)
  if (playerInGoal + aiInPlayerGoal === 10 && playerInGoal > 0) {
    // If all 10 slots are occupied and player has pieces there, and player has no pieces left outside
    const playerTotalLeft = nodes.filter(n => state[n.id] === 'player' && !playerTargetZone.includes(n.id)).length;
    if (playerTotalLeft === 0) {
      return { isOver: true, winner: 'player' };
    }
  }

  if (aiInGoal + playerInAiGoal === 10 && aiInGoal > 0) {
    const aiTotalLeft = nodes.filter(n => state[n.id] === 'ai' && !aiTargetZone.includes(n.id)).length;
    if (aiTotalLeft === 0) {
      return { isOver: true, winner: 'ai' };
    }
  }

  // Double check basic win (all 10 inside)
  if (playerInGoal === 10) return { isOver: true, winner: 'player' };
  if (aiInGoal === 10) return { isOver: true, winner: 'ai' };

  return { isOver: false, winner: null };
}

function declareGameOver(winner) {
  isGameOver = true;
  if (timerInterval) clearInterval(timerInterval);
  
  if (winner === 'player') {
    modalTitle.textContent = '승리!';
    modalTitle.className = 'modal-title victory';
    modalText.textContent = `축하합니다! 총 ${moveCount}회 이동하여 PC를 물리쳤습니다.`;
    startConfetti();
  } else {
    modalTitle.textContent = '패배';
    modalTitle.className = 'modal-title defeat';
    modalText.textContent = 'PC가 먼저 모든 말을 이동시켰습니다. 다시 도전해보세요!';
  }
  
  setTimeout(() => {
    showOverlay(gameOverOverlay);
  }, 500);
}

// --- AI ENGINE (MINIMAX + HEURISTICS) ---

function executeAIMove() {
  if (isGameOver) return;
  
  const move = selectBestAIMove();
  if (!move) {
    // AI has no moves, skip turn (rarely happens)
    activeTurn = 'player';
    updateTurnUI();
    return;
  }
  
  // Make move
  boardState[move.from] = null;
  boardState[move.to] = 'ai';
  
  animatePiece(move.from, move.to, () => {
    const winCheck = checkWinner(boardState);
    if (winCheck.isOver) {
      declareGameOver(winCheck.winner);
    } else {
      activeTurn = 'player';
      updateTurnUI();
    }
  });
}

function selectBestAIMove() {
  const aiMoves = getAvailableMovesForColor(boardState, 'ai');
  if (aiMoves.length === 0) return null;
  
  // Level 1: Random Forward Movement
  if (aiDifficulty === 1) {
    // Filter moves that bring piece closer to target or are neutral, fallback to all
    const forwardMoves = aiMoves.filter(m => distToBottom[m.from] > distToBottom[m.to]);
    const pool = forwardMoves.length > 0 ? forwardMoves : aiMoves;
    return pool[Math.floor(Math.random() * pool.length)];
  }
  
  // Level 2: Greedy (Depth 1 Evaluation)
  if (aiDifficulty === 2) {
    let bestScore = -Infinity;
    let candidates = [];
    
    for (const move of aiMoves) {
      // Simulate
      boardState[move.from] = null;
      boardState[move.to] = 'ai';
      
      const score = evaluateBoard(boardState) + (Math.random() * 0.5 - 0.25); // Slight randomness
      
      // Undo
      boardState[move.from] = 'ai';
      boardState[move.to] = null;
      
      if (score > bestScore) {
        bestScore = score;
        candidates = [move];
      } else if (Math.abs(score - bestScore) < 0.01) {
        candidates.push(move);
      }
    }
    // 10% chance to pick 2nd best to feel human-like
    if (candidates.length > 1 && Math.random() < 0.1) {
      return candidates[1];
    }
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  // Level 3: Minimax Alpha-Beta Depth 2
  // Level 4: Minimax Alpha-Beta Depth 3
  // Level 5: Minimax Alpha-Beta Depth 4 (with selective beam search)
  const depth = aiDifficulty === 3 ? 2 : (aiDifficulty === 4 ? 3 : 4);
  const useBeamPruning = aiDifficulty === 5;
  
  let bestMove = null;
  let bestValue = -Infinity;
  
  // Sort moves descending by priority to optimize alpha-beta pruning
  aiMoves.sort((a, b) => b.priority - a.priority);
  
  // If Level 5, restrict branching on root node to top 15 moves to keep depth 4 responsive
  const searchPool = useBeamPruning ? aiMoves.slice(0, 16) : aiMoves;
  
  for (const move of searchPool) {
    // Simulate
    boardState[move.from] = null;
    boardState[move.to] = 'ai';
    
    const val = minimax(boardState, depth - 1, -Infinity, Infinity, false, useBeamPruning);
    
    // Undo
    boardState[move.from] = 'ai';
    boardState[move.to] = null;
    
    if (val > bestValue) {
      bestValue = val;
      bestMove = move;
    }
  }
  
  return bestMove || aiMoves[0];
}

// Minimax with Alpha-Beta Pruning
function minimax(state, depth, alpha, beta, isMaximizing, useBeamPruning) {
  const terminal = checkWinner(state);
  if (terminal.isOver) {
    // Quick win/loss score adjusted by depth to prefer faster wins / slower losses
    return terminal.winner === 'ai' ? (10000 + depth) : (-10000 - depth);
  }
  
  if (depth === 0) {
    return evaluateBoard(state);
  }

  if (isMaximizing) {
    let maxEval = -Infinity;
    const moves = getAvailableMovesForColor(state, 'ai');
    moves.sort((a, b) => b.priority - a.priority);
    
    const pool = useBeamPruning ? moves.slice(0, 12) : moves;
    
    for (const move of pool) {
      // Simulate
      state[move.from] = null;
      state[move.to] = 'ai';
      
      const evalVal = minimax(state, depth - 1, alpha, beta, false, useBeamPruning);
      
      // Undo
      state[move.from] = 'ai';
      state[move.to] = null;
      
      maxEval = Math.max(maxEval, evalVal);
      alpha = Math.max(alpha, evalVal);
      if (beta <= alpha) break; // Beta cut-off
    }
    return maxEval;
  } else {
    let minEval = Infinity;
    const moves = getAvailableMovesForColor(state, 'player');
    moves.sort((a, b) => b.priority - a.priority); // player prioritizes moving towards top, so low priority = bad for AI
    
    const pool = useBeamPruning ? moves.slice(0, 12) : moves;
    
    for (const move of pool) {
      // Simulate
      state[move.from] = null;
      state[move.to] = 'player';
      
      const evalVal = minimax(state, depth - 1, alpha, beta, true, useBeamPruning);
      
      // Undo
      state[move.from] = 'player';
      state[move.to] = null;
      
      minEval = Math.min(minEval, evalVal);
      beta = Math.min(beta, evalVal);
      if (beta <= alpha) break; // Alpha cut-off
    }
    return minEval;
  }
}

// Get all possible moves for all pieces of a color
function getAvailableMovesForColor(state, color) {
  const moves = [];
  
  for (const n of nodes) {
    if (state[n.id] === color) {
      const validDestinations = getValidMoves(n.id, state);
      for (const destId of validDestinations) {
        // Calculate move priority based on distance change to target
        let priority = 0;
        if (color === 'ai') {
          priority = distToAITarget[n.id] - distToAITarget[destId];
        } else {
          priority = distToPlayerTarget[n.id] - distToPlayerTarget[destId];
        }
        
        moves.push({ from: n.id, to: destId, priority });
      }
    }
  }
  
  return moves;
}

// Board Heuristic Evaluator
function evaluateBoard(state) {
  let aiScore = 0;
  let playerScore = 0;
  
  let maxAIDist = 0;
  let maxPlayerDist = 0;
  
  const aiPieces = [];
  const playerPieces = [];

  // Gather piece locations
  for (const n of nodes) {
    const owner = state[n.id];
    if (owner === 'ai') {
      aiPieces.push(n);
      const d = distToAITarget[n.id];
      if (d > maxAIDist) maxAIDist = d;
    } else if (owner === 'player') {
      playerPieces.push(n);
      const d = distToPlayerTarget[n.id];
      if (d > maxPlayerDist) maxPlayerDist = d;
    }
  }

  // 1. Progress Heuristic (Negative distance to target)
  for (const n of aiPieces) {
    aiScore += -distToAITarget[n.id];
    
    // Deep Target Triangle Bonuses (generalized based on target distance)
    if (aiTargetZone.includes(n.id)) {
      aiScore += (4 - distToAITarget[n.id]) * 10;
    }
  }
  
  for (const n of playerPieces) {
    playerScore += -distToPlayerTarget[n.id];
    
    // Deep Target Triangle Bonuses
    if (playerTargetZone.includes(n.id)) {
      playerScore += (4 - distToPlayerTarget[n.id]) * 10;
    }
  }

  // 2. Straggler Penalty (Force lagging pieces forward)
  aiScore -= maxAIDist * 1.8;
  playerScore -= maxPlayerDist * 1.8;

  // 3. Cohesion / Bridge potential (clustering pieces together)
  // Small reward for keeping marbles close to other friendly marbles
  let aiCohesion = 0;
  for (const a of aiPieces) {
    for (const bId of neighbors[a.id]) {
      if (state[bId] === 'ai') {
        aiCohesion += 0.15;
      }
    }
  }
  
  let playerCohesion = 0;
  for (const a of playerPieces) {
    for (const bId of neighbors[a.id]) {
      if (state[bId] === 'player') {
        playerCohesion += 0.15;
      }
    }
  }

  return (aiScore + aiCohesion) - (playerScore + playerCohesion);
}

// --- CONFETTI EFFECT SYSTEM ---

let confettiActive = false;
let confettiCanvas, ctx;
let confettiParticles = [];

function initConfetti() {
  confettiCanvas = document.getElementById('particles-canvas');
  ctx = confettiCanvas.getContext('2d');
  
  window.addEventListener('resize', resizeConfettiCanvas);
  resizeConfettiCanvas();
}

function resizeConfettiCanvas() {
  if (confettiCanvas) {
    confettiCanvas.width = window.innerWidth;
    confettiCanvas.height = window.innerHeight;
  }
}

class ConfettiParticle {
  constructor() {
    this.x = Math.random() * confettiCanvas.width;
    this.y = Math.random() * -confettiCanvas.height - 20;
    this.size = Math.random() * 8 + 6;
    this.color = `hsl(${Math.random() * 360}, 80%, 60%)`;
    
    this.vx = Math.random() * 4 - 2;
    this.vy = Math.random() * 5 + 4;
    this.rotation = Math.random() * 360;
    this.rotationSpeed = Math.random() * 10 - 5;
  }
  
  update() {
    this.x += this.vx;
    this.y += this.vy;
    this.rotation += this.rotationSpeed;
    
    // Wind drift
    this.vx += Math.sin(Date.now() / 500) * 0.05;
  }
  
  draw() {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate((this.rotation * Math.PI) / 180);
    ctx.fillStyle = this.color;
    ctx.fillRect(-this.size / 2, -this.size / 2, this.size, this.size);
    ctx.restore();
  }
}

function startConfetti() {
  confettiActive = true;
  confettiParticles = [];
  for (let i = 0; i < 150; i++) {
    confettiParticles.push(new ConfettiParticle());
  }
  requestAnimationFrame(animateConfetti);
}

function stopConfetti() {
  confettiActive = false;
  ctx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
}

function animateConfetti() {
  if (!confettiActive) return;
  
  ctx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
  
  let activeCount = 0;
  for (const p of confettiParticles) {
    p.update();
    p.draw();
    if (p.y < confettiCanvas.height) {
      activeCount++;
    } else {
      // Recycle particle to top
      p.y = -20;
      p.x = Math.random() * confettiCanvas.width;
      p.vy = Math.random() * 5 + 4;
      activeCount++;
    }
  }
  
  if (activeCount > 0) {
    requestAnimationFrame(animateConfetti);
  }
}

// Close confetti when closing game-over screen
modalRestartBtn.addEventListener('click', stopConfetti);
