import React from "react";

export default function GoBoardView({
  columns,
  rows,
  cellSize,
  marginLeft,
  marginTop,
  boardWidth,
  boardHeight,
  totalWidth,
  totalHeight,
  columnLabels,
  starPoints,
  territory,
  softTerritory,
  stones,
  lastMove,
  emojiMode,
  activeDeadSet,
  onStoneClick,
  onIntersectionClick,
  isBlocked,
}) {
  return (
    <svg
      width={totalWidth}
      height={totalHeight}
      viewBox={`0 0 ${totalWidth} ${totalHeight}`}
      className="go-board"
    >
      <defs>
        <radialGradient id="stoneBlack" cx="30%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#3a3a3a" />
          <stop offset="60%" stopColor="#111" />
          <stop offset="100%" stopColor="#000" />
        </radialGradient>
        <radialGradient id="stoneWhite" cx="30%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="60%" stopColor="#f0f0f0" />
          <stop offset="100%" stopColor="#cfcfcf" />
        </radialGradient>
        <radialGradient id="stoneGreen" cx="30%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#6fdc7a" />
          <stop offset="60%" stopColor="#2e7d32" />
          <stop offset="100%" stopColor="#1b5e20" />
        </radialGradient>
      </defs>
      <rect
        x={marginLeft}
        y={marginTop}
        width={boardWidth}
        height={boardHeight}
        fill="#d8a35e"
      />

      {columnLabels.map((label, idx) => {
        const x = marginLeft + idx * cellSize;
        return (
          <text
            key={label}
            x={x}
            y={marginTop - 22}
            textAnchor="middle"
            fontSize="12"
            fontWeight="600"
            fill="#2b1a0b"
          >
            {label}
          </text>
        );
      })}

      {columnLabels.map((label, idx) => {
        const x = marginLeft + idx * cellSize;
        return (
          <text
            key={`bottom-${label}`}
            x={x}
            y={marginTop + boardHeight + 26}
            textAnchor="middle"
            fontSize="12"
            fontWeight="600"
            fill="#2b1a0b"
          >
            {label}
          </text>
        );
      })}

      {Array.from({ length: rows }).map((_, rowIdx) => {
        const label = rows - rowIdx;
        const y = marginTop + rowIdx * cellSize;
        return (
          <text
            key={`row-${label}`}
            x={marginLeft - 18}
            y={y + 4}
            textAnchor="end"
            fontSize="12"
            fontWeight="600"
            fill="#2b1a0b"
          >
            {label}
          </text>
        );
      })}

      {Array.from({ length: rows }).map((_, rowIdx) => {
        const label = rows - rowIdx;
        const y = marginTop + rowIdx * cellSize;
        return (
          <text
            key={`row-right-${label}`}
            x={marginLeft + boardWidth + 18}
            y={y + 4}
            textAnchor="start"
            fontSize="12"
            fontWeight="600"
            fill="#2b1a0b"
          >
            {label}
          </text>
        );
      })}

      {Array.from({ length: columns }).map((_, colIdx) => {
        const x = marginLeft + colIdx * cellSize;
        return (
          <line
            key={`v-${colIdx}`}
            x1={x}
            y1={marginTop}
            x2={x}
            y2={marginTop + boardHeight}
            stroke="#2b1a0b"
            strokeWidth="1"
          />
        );
      })}

      {Array.from({ length: rows }).map((_, rowIdx) => {
        const y = marginTop + rowIdx * cellSize;
        return (
          <line
            key={`h-${rowIdx}`}
            x1={marginLeft}
            y1={y}
            x2={marginLeft + boardWidth}
            y2={y}
            stroke="#2b1a0b"
            strokeWidth="1"
          />
        );
      })}

      {territory?.map((point) => {
        const cx = marginLeft + (point.x - 1) * cellSize;
        const cy = marginTop + (rows - point.y) * cellSize;
        const fill =
          point.owner === "black"
            ? "rgba(0,0,0,0.18)"
            : "rgba(255,255,255,0.45)";
        return (
          <circle
            key={`territory-${point.x}-${point.y}`}
            cx={cx}
            cy={cy}
            r="9"
            fill={fill}
          />
        );
      })}

      {softTerritory?.map((point) => {
        const cx = marginLeft + (point.x - 1) * cellSize;
        const cy = marginTop + (rows - point.y) * cellSize;
        const fill =
          point.owner === "black"
            ? "rgba(0,0,0,0.1)"
            : "rgba(255,255,255,0.25)";
        return (
          <circle
            key={`soft-${point.x}-${point.y}`}
            cx={cx}
            cy={cy}
            r="7"
            fill={fill}
          />
        );
      })}

      {starPoints.map(([x, y]) => {
        const cx = marginLeft + (x - 1) * cellSize;
        const cy = marginTop + (rows - y) * cellSize;
        return (
          <circle
            key={`star-${x}-${y}`}
            cx={cx}
            cy={cy}
            r="3"
            fill="#1a0f08"
          />
        );
      })}

      {stones.map((stone) => {
        const cx = marginLeft + (stone.x - 1) * cellSize;
        const cy = marginTop + (rows - stone.y) * cellSize;
        const fillColor =
          stone.color === "black"
            ? "url(#stoneBlack)"
            : stone.color === "green"
            ? "url(#stoneGreen)"
            : "url(#stoneWhite)";
        const textColor = stone.color === "white" ? "#111" : "#fff";
        const emoji =
          stone.color === "black"
            ? "\u26AB"
            : stone.color === "green"
            ? "\uD83D\uDFE2"
            : "\u26AA";
        const isDead = activeDeadSet.has(`${stone.x},${stone.y}`);

        return (
          <g key={`stone-${stone.x}-${stone.y}-${stone.moveNumber}`}>
            {emojiMode ? (
              <text
                x={cx}
                y={cy + 7}
                textAnchor="middle"
                fontSize="20"
                onClick={() => onStoneClick(stone)}
                className={`go-board-emoji ${isDead ? "is-dead" : ""}`}
              >
                {emoji}
              </text>
            ) : (
              <circle
                cx={cx}
                cy={cy}
                r="11"
                fill={fillColor}
                stroke="#111"
                strokeWidth="1"
                onClick={() => onStoneClick(stone)}
                className={`go-board-stone ${isDead ? "is-dead" : ""}`}
              />
            )}
            <text
              x={cx}
              y={cy + 4}
              textAnchor="middle"
              fontSize="10"
              fontWeight="700"
              fill={emojiMode ? "#111" : textColor}
            >
              {stone.moveNumber}
            </text>
            {isDead && (
              <text
                x={cx}
                y={cy + 4}
                textAnchor="middle"
                fontSize="12"
                fontWeight="900"
                fill="#b71c1c"
              >
                \u2716
              </text>
            )}
          </g>
        );
      })}

      {lastMove?.type === "stone" && (
        <circle
          cx={marginLeft + (lastMove.x - 1) * cellSize}
          cy={marginTop + (rows - lastMove.y) * cellSize}
          r="14"
          fill="none"
          stroke="#c62828"
          strokeWidth="2"
        />
      )}

      {Array.from({ length: rows }).map((_, rowIdx) => {
        const y = rows - rowIdx;
        return Array.from({ length: columns }).map((_, colIdx) => {
          const x = colIdx + 1;
          const cx = marginLeft + (x - 1) * cellSize;
          const cy = marginTop + rowIdx * cellSize;
          const blocked = isBlocked(x, y);
          return (
            <circle
              key={`hit-${x}-${y}`}
              cx={cx}
              cy={cy}
              r="12"
              fill="transparent"
              onClick={() => onIntersectionClick(x, y)}
              className={`go-board-hit ${blocked ? "is-blocked" : ""}`}
              pointerEvents="all"
            />
          );
        });
      })}
    </svg>
  );
}
