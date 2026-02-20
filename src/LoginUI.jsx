import React, { useMemo, useState } from "react";
import { validateName } from "./validation";
import blackIcon from "./img/ui/black.svg";
import whiteIcon from "./img/ui/white.svg";

function safeGetCounter(rank) {
  if (typeof window === "undefined") return 0;
  try {
    const key = `guga-guest-${rank}`;
    const raw = window.localStorage.getItem(key);
    const parsed = Number.parseInt(raw || "0", 10);
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
}

function reserveGuestId(rank) {
  if (typeof window === "undefined") {
    return `${rank}K_GUEST1`;
  }
  try {
    const key = `guga-guest-${rank}`;
    const current = safeGetCounter(rank);
    const next = current + 1;
    window.localStorage.setItem(key, String(next));
    return `${rank}K_GUEST${next}`;
  } catch {
    return `${rank}K_GUEST1`;
  }
}

export default function LoginUI({ onGuestEnter, t }) {
  const [rank, setRank] = useState("1");
  const [error, setError] = useState("");
  const rankOptions = useMemo(() => {
    const suffix = t("guest_rank_suffix");
    return Array.from({ length: 18 }, (_, idx) => {
      const value = String(idx + 1);
      return { value, label: `${value}${suffix}` };
    });
  }, [t]);

  const previewId = useMemo(() => {
    const next = safeGetCounter(rank) + 1;
    return `${rank}K_GUEST${next}`;
  }, [rank]);

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="login-title">
          <img
            className="login-title-icon"
            src={blackIcon}
            alt=""
            aria-hidden="true"
          />
          <img
            className="login-title-icon"
            src={whiteIcon}
            alt=""
            aria-hidden="true"
          />
          {t("login_title")}
        </div>
        <div className="login-row">
          <div className="login-row-label">{t("guest_rank_label")}</div>
          <select
            value={rank}
            onChange={(e) => {
              setRank(e.target.value);
              setError("");
            }}
          >
            {rankOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="login-preview">
          {t("guest_id_label")}: <b>{previewId}</b>
        </div>
        <div className="login-actions">
          <button
            onClick={() => {
              const nextId = reserveGuestId(rank);
              const validation = validateName(nextId);
              if (!validation.ok) {
                setError(t("name_invalid"));
                return;
              }
              onGuestEnter?.(validation.value);
            }}
          >
            {t("guest_enter")}
          </button>
        </div>
        {error && <div className="login-error">{error}</div>}
      </div>
    </div>
  );
}
