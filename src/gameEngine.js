const BOARD = { columns: 19, rows: 13 };
const DEFAULT_KOMI = 0;

export function createInitialState(ruleset = "korean", komi = DEFAULT_KOMI) {
  return {
    stones: [],
    turn: "black",
    captures: { black: 0, white: 0 },
    passes: 0,
    over: false,
    score: null,
    lastMove: null,
    ruleset,
    komi,
    moveCount: 0,
    boardHashes: [getBoardHash([])],
  };
}

export function isOccupied(stones, x, y) {
  return stones.some((stone) => stone.x === x && stone.y === y);
}

function inBounds(x, y) {
  return x >= 1 && x <= BOARD.columns && y >= 1 && y <= BOARD.rows;
}

function getNeighbors(x, y) {
  return [
    [x - 1, y],
    [x + 1, y],
    [x, y - 1],
    [x, y + 1],
  ].filter(([nx, ny]) => inBounds(nx, ny));
}

function buildBoard(stones) {
  const map = new Map();
  stones.forEach((stone) => {
    map.set(`${stone.x},${stone.y}`, stone);
  });
  return map;
}

function getGroupAndLiberties(board, startStone) {
  const color = startStone.color;
  const visited = new Set();
  const group = [];
  let liberties = 0;

  const queue = [[startStone.x, startStone.y]];
  visited.add(`${startStone.x},${startStone.y}`);

  while (queue.length > 0) {
    const [x, y] = queue.pop();
    group.push([x, y]);

    getNeighbors(x, y).forEach(([nx, ny]) => {
      const key = `${nx},${ny}`;
      const neighbor = board.get(key);
      if (!neighbor) {
        liberties += 1;
        return;
      }
      if (neighbor.color !== color) {
        return;
      }
      if (!visited.has(key)) {
        visited.add(key);
        queue.push([nx, ny]);
      }
    });
  }

  return { group, liberties };
}

function removeStones(stones, toRemoveSet) {
  return stones.filter(
    (stone) => !toRemoveSet.has(`${stone.x},${stone.y}`)
  );
}

function getBoardHash(stones) {
  const parts = stones
    .map((stone) => `${stone.x},${stone.y},${stone.color}`)
    .sort();
  return parts.join("|");
}

function computeTerritoryScore(stones) {
  const board = buildBoard(stones);
  const visited = new Set();
  let blackTerritory = 0;
  let whiteTerritory = 0;
  const territoryMap = [];

  for (let y = 1; y <= BOARD.rows; y += 1) {
    for (let x = 1; x <= BOARD.columns; x += 1) {
      const key = `${x},${y}`;
      if (board.has(key) || visited.has(key)) {
        continue;
      }

      const region = [];
      const queue = [[x, y]];
      visited.add(key);
      let touchesBlack = false;
      let touchesWhite = false;

      while (queue.length > 0) {
        const [cx, cy] = queue.pop();
        region.push([cx, cy]);

        getNeighbors(cx, cy).forEach(([nx, ny]) => {
          const nKey = `${nx},${ny}`;
          const neighbor = board.get(nKey);
          if (!neighbor) {
            if (!visited.has(nKey)) {
              visited.add(nKey);
              queue.push([nx, ny]);
            }
            return;
          }
          if (neighbor.color === "black") {
            touchesBlack = true;
          } else if (neighbor.color === "white") {
            touchesWhite = true;
          }
        });
      }

      if (touchesBlack && !touchesWhite) {
        blackTerritory += region.length;
        region.forEach(([rx, ry]) =>
          territoryMap.push({ x: rx, y: ry, owner: "black" })
        );
      } else if (touchesWhite && !touchesBlack) {
        whiteTerritory += region.length;
        region.forEach(([rx, ry]) =>
          territoryMap.push({ x: rx, y: ry, owner: "white" })
        );
      }
    }
  }

  return { blackTerritory, whiteTerritory, territoryMap };
}

function countStonesByColor(stones, color) {
  return stones.reduce(
    (count, stone) => (stone.color === color ? count + 1 : count),
    0
  );
}

export function passTurn(state) {
  if (state.over) {
    return state;
  }

  const nextTurn = state.turn === "black" ? "white" : "black";
  const passes = state.passes + 1;
  const over = passes >= 2;
  const moveCount = (state.moveCount ?? 0) + 1;

  const score = over
    ? computeFinalScore(
        state.stones,
        state.captures,
        state.ruleset,
        state.komi ?? DEFAULT_KOMI
      )
    : null;

  return {
    ...state,
    turn: nextTurn,
    passes,
    over,
    score,
    moveCount,
    lastMove: { type: "pass", player: state.turn },
  };
}

export function computeFinalScore(
  stones,
  captures,
  ruleset,
  komi = DEFAULT_KOMI
) {
  const territory = computeTerritoryScore(stones);

  if (ruleset === "chinese") {
    const blackStones = countStonesByColor(stones, "black");
    const whiteStones = countStonesByColor(stones, "white");
    return {
      black: territory.blackTerritory + blackStones,
      white: territory.whiteTerritory + whiteStones + komi,
      territory,
      captures,
      komi,
      ruleset,
      stoneCounts: { black: blackStones, white: whiteStones },
    };
  }

  return {
    black: territory.blackTerritory + captures.black,
    white: territory.whiteTerritory + captures.white + komi,
    territory,
    captures,
    komi,
    ruleset,
  };
}

export function scoreWithDead(stones, captures, ruleset, komi, deadStones) {
  const deadSet = new Set(deadStones || []);
  let removedBlack = 0;
  let removedWhite = 0;
  const aliveStones = stones.filter((stone) => {
    const key = `${stone.x},${stone.y}`;
    if (!deadSet.has(key)) {
      return true;
    }
    if (stone.color === "black") {
      removedBlack += 1;
    } else if (stone.color === "white") {
      removedWhite += 1;
    }
    return false;
  });

  const updatedCaptures = {
    black: captures.black + removedWhite,
    white: captures.white + removedBlack,
  };

  const score = computeFinalScore(aliveStones, updatedCaptures, ruleset, komi);
  return {
    ...score,
    removed: { black: removedBlack, white: removedWhite },
  };
}

export function scoreNow(state) {
  if (state.over) {
    return state;
  }
  return {
    ...state,
    over: true,
    score: computeFinalScore(
      state.stones,
      state.captures,
      state.ruleset,
      state.komi ?? DEFAULT_KOMI
    ),
    lastMove: { type: "score" },
  };
}

export function resign(state, player) {
  if (state.over) {
    return state;
  }
  const winner = player === "black" ? "white" : "black";
  return {
    ...state,
    over: true,
    score: {
      winner,
      reason: "resign",
    },
    lastMove: { type: "resign", player },
  };
}

function buildEmptyRegions(board) {
  const visited = new Set();
  const regions = [];

  for (let y = 1; y <= BOARD.rows; y += 1) {
    for (let x = 1; x <= BOARD.columns; x += 1) {
      const key = `${x},${y}`;
      if (board.has(key) || visited.has(key)) {
        continue;
      }

      const region = [];
      const queue = [[x, y]];
      visited.add(key);
      let touchesBlack = false;
      let touchesWhite = false;

      while (queue.length > 0) {
        const [cx, cy] = queue.pop();
        region.push([cx, cy]);

        getNeighbors(cx, cy).forEach(([nx, ny]) => {
          const nKey = `${nx},${ny}`;
          const neighbor = board.get(nKey);
          if (!neighbor) {
            if (!visited.has(nKey)) {
              visited.add(nKey);
              queue.push([nx, ny]);
            }
            return;
          }
          if (neighbor.color === "black") {
            touchesBlack = true;
          } else if (neighbor.color === "white") {
            touchesWhite = true;
          }
        });
      }

      let owner = null;
      if (touchesBlack && !touchesWhite) {
        owner = "black";
      } else if (touchesWhite && !touchesBlack) {
        owner = "white";
      }

      regions.push({ points: region, owner, touchesGreen: false });
    }
  }

  return regions;
}

function buildStoneGroups(board) {
  const visited = new Set();
  const groups = [];

  for (let y = 1; y <= BOARD.rows; y += 1) {
    for (let x = 1; x <= BOARD.columns; x += 1) {
      const key = `${x},${y}`;
      const stone = board.get(key);
      if (!stone || visited.has(key)) {
        continue;
      }
      if (stone.color === "green") {
        continue;
      }

      const group = [];
      const queue = [[x, y]];
      visited.add(key);

      while (queue.length > 0) {
        const [cx, cy] = queue.pop();
        group.push([cx, cy]);
        getNeighbors(cx, cy).forEach(([nx, ny]) => {
          const nKey = `${nx},${ny}`;
          const neighbor = board.get(nKey);
          if (!neighbor) {
            return;
          }
          if (neighbor.color !== stone.color) {
            return;
          }
          if (!visited.has(nKey)) {
            visited.add(nKey);
            queue.push([nx, ny]);
          }
        });
      }

      groups.push({ color: stone.color, stones: group });
    }
  }

  return groups;
}

export function suggestDeadStones(stones) {
  const board = buildBoard(stones);
  const emptyRegions = buildEmptyRegions(board);
  const groups = buildStoneGroups(board);

  const deadSet = new Set();

  groups.forEach((group) => {
    const opponent = group.color === "black" ? "white" : "black";
    let adjacentOwners = new Set();
    let hasNeutral = false;

    group.stones.forEach(([x, y]) => {
      getNeighbors(x, y).forEach(([nx, ny]) => {
        const neighbor = board.get(`${nx},${ny}`);
        if (neighbor) {
          return;
        }
        const region = emptyRegions.find((r) =>
          r.points.some(([rx, ry]) => rx === nx && ry === ny)
        );
        if (region) {
          if (!region.owner) {
            hasNeutral = true;
          } else {
            adjacentOwners.add(region.owner);
          }
        }
      });
    });

    if (!hasNeutral && adjacentOwners.size === 1 && adjacentOwners.has(opponent)) {
      group.stones.forEach(([gx, gy]) => {
        deadSet.add(`${gx},${gy}`);
      });
    }
  });

  return Array.from(deadSet);
}

export function placeStone(state, x, y) {
  if (state.over || isOccupied(state.stones, x, y)) {
    return state;
  }

  const player = state.turn;
  const moveCount = Number.isFinite(state.moveCount)
    ? state.moveCount
    : state.stones.length;
  const color = moveCount < 4 ? "green" : player;

  const newStone = {
    x,
    y,
    player,
    color,
    moveNumber: moveCount + 1,
  };

  const nextTurn = player === "black" ? "white" : "black";
  let stones = [...state.stones, newStone];

  if (color === "green") {
    const newHash = getBoardHash(stones);
    const prevHash = state.boardHashes[state.boardHashes.length - 2];
    if (prevHash && prevHash === newHash) {
      return state;
    }
    return {
      ...state,
      stones,
      turn: nextTurn,
      captures: { ...state.captures },
      passes: 0,
      over: false,
      score: null,
      moveCount: moveCount + 1,
      lastMove: { type: "stone", player, x, y },
      boardHashes: [...state.boardHashes, newHash],
    };
  }

  const board = buildBoard(stones);
  const toRemove = new Set();
  let capturedCount = 0;

  getNeighbors(x, y).forEach(([nx, ny]) => {
    const neighbor = board.get(`${nx},${ny}`);
    if (!neighbor || neighbor.color === color || neighbor.color === "green") {
      return;
    }
    const { group, liberties } = getGroupAndLiberties(board, neighbor);
    if (liberties === 0) {
      group.forEach(([gx, gy]) => {
        toRemove.add(`${gx},${gy}`);
      });
    }
  });

  if (toRemove.size > 0) {
    capturedCount = toRemove.size;
    stones = removeStones(stones, toRemove);
  }

  const boardAfter = buildBoard(stones);
  const placedStone = boardAfter.get(`${x},${y}`);
  const selfCheck =
    placedStone && getGroupAndLiberties(boardAfter, placedStone).liberties === 0;
  if (selfCheck) {
    return state;
  }

  const newHash = getBoardHash(stones);
  const prevHash = state.boardHashes[state.boardHashes.length - 2];
  if (prevHash && prevHash === newHash) {
    return state;
  }

  const captures = {
    ...state.captures,
    [player]: state.captures[player] + capturedCount,
  };

  return {
    ...state,
    stones,
    turn: nextTurn,
    captures,
    passes: 0,
    over: false,
    score: null,
    moveCount: moveCount + 1,
    lastMove: { type: "stone", player, x, y },
    boardHashes: [...state.boardHashes, newHash],
  };
}
