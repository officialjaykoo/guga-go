import React from "react";
import arrowIcon from "../img/edit/arrow.svg";
import circleIcon from "../img/edit/circle.svg";
import crossIcon from "../img/edit/cross.svg";
import labelIcon from "../img/edit/label.svg";
import numberIcon from "../img/edit/number.svg";
import squareIcon from "../img/edit/square.svg";
import triangleIcon from "../img/edit/triangle.svg";

export default function ActionPanelView({
  t,
  onUndo,
  onPass,
  onScore,
  onResign,
  disableUndo = false,
  disablePass = false,
  disableScore = false,
  disableResign = false,
  scoring,
  onDeadMode,
  onAutoDead,
  onResetDead,
  deadModeActive = false,
  onDeadConfirm,
  onDeadCancel,
  disabled = false,
}) {
  return (
    <div className="action-panel">
      <div
        className="action-group"
      >
        <button onClick={onUndo} disabled={disabled || disableUndo}>
          <span className="action-button-content">
            <img src={arrowIcon} alt="" aria-hidden="true" className="action-icon" />
            {t("undo")}
          </span>
        </button>
        <button onClick={onPass} disabled={disabled || disablePass}>
          <span className="action-button-content">
            <img src={circleIcon} alt="" aria-hidden="true" className="action-icon" />
            {t("pass")}
          </span>
        </button>
        <button onClick={onScore} disabled={disabled || disableScore}>
          <span className="action-button-content">
            <img src={numberIcon} alt="" aria-hidden="true" className="action-icon" />
            {t("score")}
          </span>
        </button>
        <button onClick={onResign} disabled={disabled || disableResign}>
          <span className="action-button-content">
            <img src={crossIcon} alt="" aria-hidden="true" className="action-icon" />
            {t("resign")}
          </span>
        </button>
      </div>
      {scoring && (
        <div
          className="action-group action-group--scoring"
        >
          {!deadModeActive && (
            <button onClick={onDeadMode} disabled={disabled}>
              <span className="action-button-content">
                <img src={triangleIcon} alt="" aria-hidden="true" className="action-icon" />
                {t("dead_mark")}
              </span>
            </button>
          )}
          {deadModeActive && (
            <>
              <button onClick={onDeadConfirm} disabled={disabled}>
                <span className="action-button-content">
                  <img src={labelIcon} alt="" aria-hidden="true" className="action-icon" />
                  {t("dead_confirm")}
                </span>
              </button>
              <button onClick={onDeadCancel} disabled={disabled}>
                <span className="action-button-content">
                  <img src={squareIcon} alt="" aria-hidden="true" className="action-icon" />
                  {t("dead_cancel")}
                </span>
              </button>
            </>
          )}
          <button onClick={onAutoDead} disabled={disabled}>
            <span className="action-button-content">
              <img src={circleIcon} alt="" aria-hidden="true" className="action-icon" />
              {t("dead_auto")}
            </span>
          </button>
          <button onClick={onResetDead} disabled={disabled}>
            <span className="action-button-content">
              <img src={arrowIcon} alt="" aria-hidden="true" className="action-icon" />
              {t("dead_reset")}
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
