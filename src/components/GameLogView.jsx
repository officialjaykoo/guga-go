import React, { useEffect, useRef } from "react";
import blackIcon from "../img/ui/black.svg";
import whiteIcon from "../img/ui/white.svg";

export default function GameLogView({ title, rows, t = (key) => key }) {
  const listRef = useRef(null);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [rows]);

  const renderLabel = (label) => {
    if (!label) return null;
    const parts = String(label).split(" ");
    if (parts.length < 2) return label;

    const token = parts[1];
    const rest = parts.slice(2).join(" ");
    const normalizedToken = token.toLowerCase();
    const blackToken = String(t("black") || "").toLowerCase();
    const whiteToken = String(t("white") || "").toLowerCase();
    const isBlack = normalizedToken === blackToken;
    const isWhite = normalizedToken === whiteToken;

    if (!isBlack && !isWhite) return label;
    const icon = isBlack ? blackIcon : whiteIcon;

    return (
      <>
        <span>{parts[0]}</span>
        <img src={icon} alt="" aria-hidden="true" className="game-log-icon" />
        <span>{rest}</span>
      </>
    );
  };

  return (
    <div className="game-log">
      {title ? (
        <div className="game-log-title">
          {title}
        </div>
      ) : null}
      <div className="game-log-list" ref={listRef}>
        {rows.map((row, rowIdx) => (
          <div
            key={`row-${rowIdx}`}
            className="game-log-row"
          >
            {row.map((label, idx) =>
              label ? (
                <span
                  key={`move-${rowIdx}-${idx}`}
                  className="game-log-item"
                >
                  {renderLabel(label)}
                </span>
              ) : null
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

