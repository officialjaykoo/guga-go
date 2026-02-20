import React from "react";
import blackIcon from "../img/ui/black.svg";
import whiteIcon from "../img/ui/white.svg";

export default function PlayerBarView({
  emojiMode,
  turn,
  blackPlayer,
  whitePlayer,
  blackCaptures,
  whiteCaptures,
  blackHearts,
  whiteHearts,
  remainingSec,
  t,
}) {
  return (
    <div className="player-bar">
      <div
        className={`player-chip ${turn === "black" ? "is-active" : ""}`}
      >
        {emojiMode ? (
          <span className="player-emoji" aria-hidden="true">
            ??
          </span>
        ) : (
          <img src={blackIcon} alt="" aria-hidden="true" className="player-icon" />
        )}
        <div className="player-info-lines">
          <div className="player-name-line">{blackPlayer}</div>
          <div className="player-meta-line">
            <span>{t("captures")} {blackCaptures}</span>
            <span className="player-hearts">{blackHearts}</span>
          </div>
        </div>
      </div>
      <div
        className="player-timer"
      >
        {Number.isFinite(remainingSec) ? remainingSec : "--"}
      </div>
      <div
        className={`player-chip ${turn === "white" ? "is-active" : ""}`}
      >
        {emojiMode ? (
          <span className="player-emoji" aria-hidden="true">
            ??
          </span>
        ) : (
          <img src={whiteIcon} alt="" aria-hidden="true" className="player-icon" />
        )}
        <div className="player-info-lines">
          <div className="player-name-line">{whitePlayer}</div>
          <div className="player-meta-line">
            <span>{t("captures")} {whiteCaptures}</span>
            <span className="player-hearts">{whiteHearts}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
