import React, { useEffect, useMemo, useRef, useState } from "react";
import { validateName } from "../shared/common/validation";
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

const GOOGLE_GSI_SRC = "https://accounts.google.com/gsi/client";

export default function LoginUI({ onGuestEnter, onGoogleLogin, t }) {
  const [rank, setRank] = useState("1");
  const [error, setError] = useState("");
  const googleDivRef = useRef(null);
  const googleClientId = import.meta?.env?.VITE_GOOGLE_CLIENT_ID;
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

  useEffect(() => {
    if (!googleClientId || typeof window === "undefined") return;
    const renderGoogleButton = () => {
      const g = window.google;
      if (!g?.accounts?.id || !googleDivRef.current) return;
      g.accounts.id.initialize({
        client_id: googleClientId,
        callback: (resp) => {
          const credential = String(resp?.credential || "").trim();
          if (!credential) return;
          onGoogleLogin?.(credential);
        },
      });
      googleDivRef.current.innerHTML = "";
      g.accounts.id.renderButton(googleDivRef.current, {
        theme: "outline",
        size: "large",
        width: 260,
      });
    };
    if (window.google?.accounts?.id) {
      renderGoogleButton();
      return;
    }
    const existing = document.querySelector(`script[src="${GOOGLE_GSI_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", renderGoogleButton, { once: true });
      return () =>
        existing.removeEventListener("load", renderGoogleButton, { once: true });
    }
    const script = document.createElement("script");
    script.src = GOOGLE_GSI_SRC;
    script.async = true;
    script.defer = true;
    script.onload = renderGoogleButton;
    document.head.appendChild(script);
    return () => {
      script.onload = null;
    };
  }, [googleClientId, onGoogleLogin]);

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
        {googleClientId ? (
          <div className="login-actions">
            <div ref={googleDivRef} />
          </div>
        ) : null}
        {error && <div className="login-error">{error}</div>}
      </div>
    </div>
  );
}


