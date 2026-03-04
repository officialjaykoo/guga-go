import React from "react";

export default function KifuControlView({
  step,
  canBack,
  canForward,
  onToggleAuto,
  autoPlaying,
  t = (key) => key,
}) {
  return (
    <div className="sabaki-kifu-controls">
      <button onClick={() => step(-3)} disabled={!canBack}>
        {t("kifu_step_back_3")}
      </button>
      <button onClick={() => step(-1)} disabled={!canBack}>
        {t("kifu_step_back_1")}
      </button>
      <button onClick={() => step(1)} disabled={!canForward}>
        {t("kifu_step_forward_1")}
      </button>
      <button onClick={() => step(3)} disabled={!canForward}>
        {t("kifu_step_forward_3")}
      </button>
      <button onClick={onToggleAuto}>
        {autoPlaying ? t("kifu_auto_play_stop") : t("kifu_auto_play_start")}
      </button>
    </div>
  );
}

