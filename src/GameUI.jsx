import React, { useEffect, useMemo, useState, useRef } from "react";
import {
  createInitialState,
  isOccupied,
  computeFinalScore,
  scoreWithDead,
  suggestDeadStones,
} from "../shared/game/engine";
import PlayerBarView from "./components/PlayerBarView";
import ActionPanelView from "./components/ActionPanelView";
import GoBoardView from "./components/GoBoardView";
import GameLogView from "./components/GameLogView";
import ChatPanelView from "./components/ChatPanelView";
import KifuControlView from "./components/KifuControlView";
import RulesPageUI from "./RulesPageUI";
import { buildHistoryFromSgf, buildSgfFromHistory, parseSgf } from "../shared/game/sgf";
import captureStoneSound from "./sound/captureStone.mp3";
import newGameSound from "./sound/newgame.mp3";
import passStoneSound from "./sound/passStone.mp3";
import playStoneSound from "./sound/playStone.mp3";
import labelIcon from "./img/edit/label.svg";
import numberIcon from "./img/edit/number.svg";

export default function GameUI({
  currentRoom,
  userId,
  onLeaveRoom,
  onStartGame,
  onStartAiGame,
  onStartAiVsAi,
  aiDifficulty,
  onAiDifficultyChange,
  onGameAction,
  onLogout,
  chatChannels,
  onChatSend,
  onChatJoin,
  chatJoinTimes,
  onLoadKifu,
  onSpectatorChatToggle,
  t,
  lang,
}) {
  const columns = 19;
  const rows = 13;
  const isMobileHost =
    typeof window !== "undefined" && window.location.hostname.startsWith("m.");
  const cellSize = isMobileHost ? 22 : 35;
  const marginLeft = isMobileHost ? 40 : 44;
  const marginTop = isMobileHost ? 36 : 44;
  const marginRight = marginLeft;
  const marginBottom = marginTop;
  const boardWidth = (columns - 1) * cellSize;
  const boardHeight = (rows - 1) * cellSize;
  const totalWidth = marginLeft + boardWidth + marginRight;
  const totalHeight = marginTop + boardHeight + marginBottom;

  const defaultPeriodMs = 30000;
  const defaultMaxLives = 3;

  const starPoints = [
    [4, 4],
    [10, 4],
    [16, 4],
    [4, 7],
    [10, 7],
    [16, 7],
    [4, 10],
    [10, 10],
    [16, 10],
  ];

  const columnLabels = [
    "A",
    "B",
    "C",
    "D",
    "E",
    "F",
    "G",
    "H",
    "J",
    "K",
    "L",
    "M",
    "N",
    "O",
    "P",
    "Q",
    "R",
    "S",
    "T",
  ];

  const ruleset = currentRoom?.ruleset || "korean";
  const roomStatus = currentRoom?.status || "waiting";
  const isPlaying = roomStatus === "playing";
  const isWaiting = !isPlaying;
  const aiDifficultyLabel = currentRoom?.ai?.difficulty || t("ai_difficulty_server");
  const serverAiLabel = currentRoom?.ai?.enabled
    ? currentRoom.ai.vsAi
      ? `${t("ai_vs_ai_label")} ${
          currentRoom.ai.black?.name || t("ai_default_black")
        } ${t("ai_versus")} ${
          currentRoom.ai.white?.name || t("ai_default_white")
        } (${aiDifficultyLabel})`
      : `${currentRoom.ai.name || t("ai_label")} (${aiDifficultyLabel})`
    : "";

  const history = useMemo(() => {
    if (currentRoom?.game?.history?.length) {
      return currentRoom.game.history;
    }
    return [createInitialState(ruleset, currentRoom?.game?.history?.[0]?.komi)];
  }, [currentRoom?.game?.history, ruleset]);
  const [deadMode, setDeadMode] = useState(false);
  const [deadStones, setDeadStones] = useState(new Set());
  const [deadDraft, setDeadDraft] = useState(null);
  const [emojiMode, setEmojiMode] = useState(false);
  const [toast, setToast] = useState(null);
  const [actionToast, setActionToast] = useState(null);
  const [reviewIndex, setReviewIndex] = useState(null);
  const [autoPlay, setAutoPlay] = useState(false);
  const [showGameLogPopup, setShowGameLogPopup] = useState(false);
  const gameStateIndex =
    Number.isFinite(reviewIndex) && reviewIndex >= 0
      ? Math.min(reviewIndex, history.length - 1)
      : history.length - 1;
  const gameState = history[gameStateIndex];

  const occupiedMap = useMemo(() => {
    const map = new Set();
    const stones = gameState?.stones || [];
    stones.forEach((stone) => {
      map.add(`${stone.x},${stone.y}`);
    });
    return map;
  }, [gameState?.stones]);

  const activeDeadSet = useMemo(() => {
    if (deadMode && deadDraft) {
      return deadDraft;
    }
    return deadStones;
  }, [deadMode, deadDraft, deadStones]);

  const players = currentRoom?.players || [];
  const blackPlayer = players[0] || t("none");
  const whitePlayer = players[1] || t("none");
  const spectators = (currentRoom?.spectators || []).filter(
    (name) => name && !players.includes(name)
  );
  const isSpectator = spectators.includes(userId);
  const isOwner = currentRoom?.owner === userId;
  const spectatorChatEnabled = Boolean(currentRoom?.spectatorChatEnabled);
  const playerColor =
    players[0] === userId ? "black" : players[1] === userId ? "white" : null;
  const isPlayer = Boolean(playerColor);
  const isReview = Boolean(currentRoom?.game?.review);
  const isAiVsAiPlaying =
    Boolean(currentRoom?.ai?.enabled && currentRoom.ai.vsAi) && isPlaying;
  const isMyTurn =
    isPlayer &&
    !isReview &&
    gameState.turn === playerColor &&
    !gameState.over;
  const moveCount = gameStateIndex;
  const soundBankRef = useRef(null);
  const prevRoomStatusRef = useRef(roomStatus);
  const prevMoveKeyRef = useRef("");
  const prevCapturesRef = useRef({ black: 0, white: 0 });
  const prevHistoryLenRef = useRef(history.length);
  const kifuInputRef = useRef(null);

  const ensureSoundBank = () => {
    if (soundBankRef.current) return soundBankRef.current;
    soundBankRef.current = {
      capture: new Audio(captureStoneSound),
      newgame: new Audio(newGameSound),
      pass: new Audio(passStoneSound),
      place: new Audio(playStoneSound),
    };
    return soundBankRef.current;
  };

  const playSound = (key) => {
    if (typeof window === "undefined") return;
    const bank = ensureSoundBank();
    const audio = bank?.[key];
    if (!audio) return;
    try {
      audio.currentTime = 0;
      audio.play().catch(() => {});
    } catch {
      // ignore autoplay errors
    }
  };

  const handleIntersectionClick = (x, y) => {
    if (!isPlaying) return;
    if (isReview) {
      stepReview(1);
      return;
    }
    if (!isMyTurn) return;
    if (isOccupied(gameState.stones, x, y)) {
      return;
    }
    onGameAction?.(currentRoom?.name, { type: "place", x, y });
  };

  const handleStoneToggleDead = (stone) => {
    if (!gameState.over || gameState.score?.reason === "resign") {
      return;
    }
    if (stone.color === "green") {
      return;
    }
    if (!deadDraft) {
      return;
    }
    const key = `${stone.x},${stone.y}`;
    setDeadDraft((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const timer = currentRoom?.game?.timer;
  const periodMs = timer?.periodMs ?? defaultPeriodMs;
  const maxLives = timer?.maxLives ?? defaultMaxLives;
  const remainingMs = timer?.remainingMs ?? periodMs;
  const lives = timer?.lives ?? { black: maxLives, white: maxLives };
  const pendingUndo = currentRoom?.game?.pendingUndo || null;
  const pendingScore = currentRoom?.game?.pendingScore || null;
  const undoUsed = Boolean(currentRoom?.game?.undoUsed);
  const undoRequests = currentRoom?.game?.undoRequests || { black: 0, white: 0 };
  const notifications = Array.isArray(currentRoom?.game?.notifications)
    ? currentRoom.game.notifications
    : [];
  const isUndoTarget = pendingUndo?.to === userId;
  const isUndoRequester = pendingUndo?.from === userId;
  const isScoreTarget = pendingScore?.to === userId;
  const isScoreRequester = pendingScore?.from === userId;
  const remainingSec = Math.max(0, Math.ceil(remainingMs / 1000));
  const scoring =
    gameState.over && gameState.score && gameState.score.reason !== "resign";
  const scored = useMemo(() => {
    if (!scoring) return null;
    try {
      return scoreWithDead(
        gameState.stones,
        gameState.captures,
        ruleset,
        gameState.komi,
        Array.from(activeDeadSet)
      );
    } catch {
      return null;
    }
  }, [scoring, gameState.stones, gameState.captures, ruleset, activeDeadSet]);
  const analysis = currentRoom?.game?.analysis || null;
  const analysisTerritory = useMemo(() => {
    if (!analysis?.territory?.length) return null;
    return analysis.territory;
  }, [analysis]);
  const analysisScoreText = useMemo(() => {
    if (!Number.isFinite(analysis?.scoreLead)) return "";
    const lead = analysis.scoreLead;
    const leader = lead >= 0 ? t("black") : t("white");
    return `${t("ai_lead_prefix")} ${leader} ${Math.abs(lead).toFixed(1)}`;
  }, [analysis, t]);
  const resultText = useMemo(() => {
    if (!gameState.over) return "";
    if (gameState.score?.reason === "resign") {
      const winner = gameState.score.winner === "black" ? t("black") : t("white");
      return `${t("end")} - ${winner} ${t("win")}`;
    }
    if (scoring && scored) {
      return `${t("end")} - ${t("black")} ${scored.black} : ${t("white")} ${scored.white}`;
    }
    if (
      Number.isFinite(gameState.score?.black) &&
      Number.isFinite(gameState.score?.white)
    ) {
      return `${t("end")} - ${t("black")} ${gameState.score.black} : ${t("white")} ${gameState.score.white}`;
    }
    return "";
  }, [gameState.over, gameState.score, scoring, scored, t]);
  const softTerritory = useMemo(() => {
    if (scoring) return null;
    if (gameState.over) return null;
    if (!analysisTerritory) return null;
    if (moveCount < 50) return null;
    return analysisTerritory;
  }, [analysisTerritory, scoring, gameState.over, moveCount]);
  const previewTerritory = useMemo(() => {
    if (!currentRoom?.ai?.enabled || !currentRoom?.ai?.vsAi) return null;
    if (gameState.over) return null;
    if (moveCount < 50) return null;
    try {
      const preview = computeFinalScore(
        gameState.stones,
        gameState.captures,
        ruleset,
        gameState.komi
      );
      return preview?.territory?.territoryMap || null;
    } catch {
      return null;
    }
  }, [
    currentRoom?.ai?.enabled,
    currentRoom?.ai?.vsAi,
    gameState.over,
    moveCount,
    gameState.stones,
    gameState.captures,
    ruleset,
  ]);

  useEffect(() => {
    if (isUndoTarget) {
      setActionToast({ type: "undo", from: pendingUndo?.from });
      return;
    }
    if (isScoreTarget) {
      setActionToast({ type: "score", from: pendingScore?.from });
      return;
    }
    setActionToast(null);
  }, [isUndoTarget, isScoreTarget, pendingUndo, pendingScore]);

  useEffect(() => {
    if (!actionToast) return;
    const id = setTimeout(() => {
      if (actionToast.type === "undo" && isUndoTarget) {
        onGameAction?.(currentRoom?.name, { type: "undoReject" });
      }
      if (actionToast.type === "score" && isScoreTarget) {
        onGameAction?.(currentRoom?.name, { type: "scoreAccept" });
      }
      setActionToast(null);
    }, 15000);
    return () => clearTimeout(id);
  }, [actionToast, isUndoTarget, isScoreTarget, currentRoom?.name, onGameAction]);

  useEffect(() => {
    if (!notifications.length) return;
    const latest = notifications[notifications.length - 1];
    setToast(latest.text);
    const id = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(id);
  }, [notifications]);

  useEffect(() => {
    if (!gameState.over) return;
    if (gameState.score?.reason === "resign") {
      const winner = gameState.score.winner === "black" ? t("black") : t("white");
      setToast(`${t("end")} - ${winner} ${t("win")}`);
    } else if (scoring && scored) {
      setToast(
        `${t("end")} - ${t("black")} ${scored.black} : ${t("white")} ${scored.white}`
      );
    }
    const id = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(id);
  }, [gameState.over, gameState.score, scoring, scored, t]);

  useEffect(() => {
    if (roomStatus === "playing" && prevRoomStatusRef.current !== "playing") {
      playSound("newgame");
    }
    prevRoomStatusRef.current = roomStatus;
  }, [roomStatus]);

  useEffect(() => {
    if (!gameState?.lastMove) return;
    const lastMove = gameState.lastMove;
    const moveKey = `${lastMove.type}-${lastMove.player}-${lastMove.x || 0}-${
      lastMove.y || 0
    }-${moveCount}`;
    if (moveKey === prevMoveKeyRef.current) return;
    const prevCaptures = prevCapturesRef.current || { black: 0, white: 0 };
    const nextCaptures = gameState.captures || { black: 0, white: 0 };
    const captureDelta =
      (nextCaptures.black + nextCaptures.white) -
      (prevCaptures.black + prevCaptures.white);
    if (lastMove.type === "pass") {
      playSound("pass");
    } else if (lastMove.type === "stone") {
      if (captureDelta > 0) {
        playSound("capture");
      } else {
        playSound("place");
      }
    }
    prevMoveKeyRef.current = moveKey;
    prevCapturesRef.current = nextCaptures;
  }, [gameState.lastMove, gameState.captures, moveCount]);

  useEffect(() => {
    const prevLen = prevHistoryLenRef.current;
    if (history.length === 1 && prevLen > 1) {
      playSound("newgame");
    }
    prevHistoryLenRef.current = history.length;
    if (history.length <= 1) {
      prevCapturesRef.current = { black: 0, white: 0 };
      prevMoveKeyRef.current = "";
    }
  }, [history.length]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }
    const media = window.matchMedia("(max-width: 768px)");
    const update = () => setEmojiMode(media.matches);
    update();
    if (media.addEventListener) {
      media.addEventListener("change", update);
      return () => media.removeEventListener("change", update);
    }
    media.addListener(update);
    return () => media.removeListener(update);
  }, []);

  const lastChatKeyRef = useRef("");
  useEffect(() => {
    if (!currentRoom?.name) return;
    const scope = isPlaying ? "game" : "lobby";
    const key = `${scope}:${currentRoom.name}`;
    if (lastChatKeyRef.current === key) {
      return;
    }
    lastChatKeyRef.current = key;
    onChatJoin?.(scope, currentRoom.name);
  }, [currentRoom?.name, isPlaying, onChatJoin]);

  useEffect(() => {
    if (!gameState.over) {
      setDeadMode(false);
      setDeadStones(new Set());
      setDeadDraft(null);
    }
  }, [gameState.over, history.length]);

  useEffect(() => {
    if (!isReview) {
      setReviewIndex(null);
      setAutoPlay(false);
      return;
    }
    setReviewIndex((prev) => {
      const maxIndex = history.length - 1;
      if (!Number.isFinite(prev)) return maxIndex;
      return Math.min(prev, maxIndex);
    });
  }, [isReview, history.length]);

  useEffect(() => {
    if (!isReview || !autoPlay) return;
    if (gameStateIndex >= history.length - 1) {
      setAutoPlay(false);
      return;
    }
    const id = setInterval(() => {
      setReviewIndex((prev) => {
        const base = Number.isFinite(prev) ? prev : history.length - 1;
        const next = Math.min(history.length - 1, base + 1);
        if (next >= history.length - 1) {
          setAutoPlay(false);
        }
        return next;
      });
    }, 700);
    return () => clearInterval(id);
  }, [isReview, autoPlay, history.length, gameStateIndex]);

  useEffect(() => {
    if (!showGameLogPopup) return undefined;
    const handleEsc = (event) => {
      if (event.key === "Escape") {
        setShowGameLogPopup(false);
      }
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [showGameLogPopup]);

  const moveLabels = useMemo(() => {
    return history.slice(1, gameStateIndex + 1).map((state, idx) => {
      const move = state.lastMove;
      if (!move) {
        return null;
      }
      const playerLabel = move.player === "black" ? t("black") : t("white");
      if (move.type === "pass") {
        return `${idx + 1}. ${playerLabel} ${t("pass")}`;
      }
      if (move.type === "stone") {
        const letter = columnLabels[move.x - 1] || "?";
        const coord = `${letter}${move.y}`;
        return `${idx + 1}. ${playerLabel} ${coord}`;
      }
      if (move.type === "resign") {
        return `${idx + 1}. ${playerLabel} ${t("resign")}`;
      }
      if (move.type === "score") {
        return `${idx + 1}. ${t("score")}`;
      }
      return null;
    });
  }, [history, gameStateIndex, columnLabels, t]);

  const moveRows = useMemo(() => {
    const rowsList = [];
    for (let i = 0; i < moveLabels.length; i += 10) {
      rowsList.push(moveLabels.slice(i, i + 10));
    }
    return rowsList;
  }, [moveLabels]);

  const makeLivesHearts = (count) =>
    "\u2665".repeat(Math.max(0, count)) +
    "\u2661".repeat(Math.max(0, maxLives - count));
  const blackHearts = makeLivesHearts(lives.black);
  const whiteHearts = makeLivesHearts(lives.white);
  const canInteract = isPlaying && isPlayer && !gameState.over && !isReview;
  const myUndoCount = playerColor ? undoRequests[playerColor] || 0 : 0;
  const canUndoRequest = canInteract && !undoUsed && myUndoCount < 3;
  const canPass = canInteract && isMyTurn;
  const canScoreRequest = canInteract && isMyTurn && moveCount >= 100;
  const canResign = canInteract;
  const canReviewBack = isReview && gameStateIndex > 0;
  const canReviewForward = isReview && gameStateIndex < history.length - 1;

  const startDeadMode = () => {
    if (!scoring) return;
    setDeadMode(true);
    setDeadDraft(new Set(deadStones));
  };

  const confirmDead = () => {
    if (!deadDraft) return;
    setDeadStones(new Set(deadDraft));
    setDeadDraft(null);
    setDeadMode(false);
  };

  const cancelDead = () => {
    setDeadDraft(null);
    setDeadMode(false);
  };

  const applyAutoDead = () => {
    if (!scoring) return;
    const suggested = suggestDeadStones(gameState.stones);
    if (!deadMode) {
      setDeadMode(true);
      setDeadDraft(new Set(suggested));
      return;
    }
    setDeadDraft(new Set(suggested));
  };

  const resetDead = () => {
    if (deadMode) {
      setDeadDraft(new Set());
      return;
    }
    setDeadStones(new Set());
  };

  const stepReview = (delta) => {
    if (!isReview) return;
    setReviewIndex((prev) => {
      const base = Number.isFinite(prev) ? prev : history.length - 1;
      const next = Math.max(0, Math.min(history.length - 1, base + delta));
      return next;
    });
  };

  const handleBoardContextMenu = (event) => {
    if (!isReview) return;
    event.preventDefault();
    stepReview(-1);
  };

  if (!currentRoom) {
    return (
      <div>
        <h2>{t("game_title")}</h2>
        <p>{t("room_not_found")}</p>
        <button onClick={() => onLeaveRoom(null)}>{t("lobby")}</button>
      </div>
    );
  }

  const handleLeaveRoom = () => {
    if (!playerColor || isReview || gameState.over) {
      onLeaveRoom(currentRoom.name);
      return;
    }
    onGameAction?.(currentRoom?.name, { type: "resign" });
    onLeaveRoom(currentRoom.name);
  };

  const handleSpectatorChatToggle = () => {
    if (!isOwner) return;
    onSpectatorChatToggle?.(
      currentRoom?.name,
      !spectatorChatEnabled
    );
  };

  const canLoadKifu = currentRoom?.owner === userId;

  const buildKifuFileName = () => {
    const base = (currentRoom?.name || "kifu")
      .replace(/[^\w\-]+/g, "_")
      .slice(0, 50);
    const stamp = new Date()
      .toISOString()
      .replace(/[:T]/g, "-")
      .slice(0, 16);
    return `${base}_${stamp}.sgf`;
  };

  const handleSaveKifu = () => {
    if (!currentRoom?.game?.history?.length) {
      setToast(t("kifu_empty"));
      return;
    }
    const sgf = buildSgfFromHistory({
      history: currentRoom.game.history,
      columns,
      rows,
      ruleset,
      komi: currentRoom.game.history[0]?.komi ?? gameState.komi,
      playerBlack: players[0] || "",
      playerWhite: players[1] || "",
    });
    if (!sgf) {
      setToast(t("kifu_save_failed"));
      return;
    }
    const blob = new Blob([sgf], { type: "application/x-go-sgf" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = buildKifuFileName();
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setToast(t("kifu_save_done"));
  };

  const handleLoadKifuClick = () => {
    if (!canLoadKifu) {
      setToast(t("kifu_load_owner_only"));
      return;
    }
    kifuInputRef.current?.click();
  };

  const handleLoadKifuFile = (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result || "");
        const parsed = parseSgf(text);
        const result = buildHistoryFromSgf(parsed, {
          columns,
          rows,
          fallbackRuleset: ruleset,
          fallbackKomi: gameState.komi,
        });
        if (!result.ok) {
          if (result.error === "size_mismatch") {
            setToast(
              `${t("kifu_load_size")} ${result.found.columns}x${
                result.found.rows
              }`
            );
            return;
          }
          setToast(t("kifu_load_failed"));
          return;
        }
        const nextHistory = result.history.slice();
        const lastIdx = nextHistory.length - 1;
        if (lastIdx >= 0) {
          const last = nextHistory[lastIdx];
          nextHistory[lastIdx] = {
            ...last,
            over: true,
            score: last?.score ?? null,
          };
        }
        onLoadKifu?.(currentRoom?.name, {
          history: nextHistory,
          ruleset: result.ruleset,
          komi: result.komi,
          review: true,
        });
        setToast(t("kifu_load_done"));
      } catch {
        setToast(t("kifu_load_failed"));
      }
    };
    reader.onerror = () => {
      setToast(t("kifu_load_failed"));
    };
    reader.readAsText(file);
  };

  const roomLine = `${t("game_title")} ${t("ruleset_label")}:${
    ruleset === "chinese"
      ? t("ruleset_chinese")
      : ruleset === "japanese"
      ? t("ruleset_japanese")
      : t("ruleset_korean")
  } ${t("room")} [${currentRoom.name}] [${
    isPlaying ? t("status_playing") : t("status_waiting")
  }]`;

  return (
    <div className="sabaki-shell sabaki-shell--game">
      {toast && (
        <div
          className="sabaki-toast"
          onClick={() => setToast(null)}
        >
          {toast}
        </div>
      )}
      {actionToast && (
        <div className="sabaki-toast sabaki-toast--action">
          <div>
            {actionToast.from}{" "}
            {actionToast.type === "undo"
              ? t("undo_request_notice")
              : t("score_request_notice")}
          </div>
          <div className="sabaki-toast-actions">
            <button
              onClick={() => {
                if (actionToast.type === "undo") {
                  onGameAction?.(currentRoom?.name, { type: "undoAccept" });
                } else {
                  onGameAction?.(currentRoom?.name, { type: "scoreAccept" });
                }
                setActionToast(null);
              }}
            >
              {t("yes")}
            </button>
            <button
              onClick={() => {
                if (actionToast.type === "undo") {
                  onGameAction?.(currentRoom?.name, { type: "undoReject" });
                } else {
                  onGameAction?.(currentRoom?.name, { type: "scoreReject" });
                }
                setActionToast(null);
              }}
            >
              {t("no")}
            </button>
          </div>
        </div>
      )}
      {showGameLogPopup && (
        <div
          className="sabaki-modal-backdrop"
          onClick={() => setShowGameLogPopup(false)}
        >
          <div
            className="sabaki-panel sabaki-game-log-popup"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sabaki-game-log-popup-header">
              <div className="sabaki-game-log-popup-title">{t("game_log")}</div>
              <button
                className="sabaki-game-log-popup-close"
                onClick={() => setShowGameLogPopup(false)}
                aria-label={t("close")}
              >
                X
              </button>
            </div>
            <div className="sabaki-game-log-popup-body">
              <GameLogView title={null} rows={moveRows} t={t} />
            </div>
          </div>
        </div>
      )}

      <div className="sabaki-main sabaki-main--game">
        <div className="sabaki-panel sabaki-board-panel">
          <div className="sabaki-board-stack">
            <div
              className="sabaki-board-wrap"
              onContextMenu={handleBoardContextMenu}
            >
              <GoBoardView
                columns={columns}
                rows={rows}
                cellSize={cellSize}
                marginLeft={marginLeft}
                marginTop={marginTop}
                boardWidth={boardWidth}
                boardHeight={boardHeight}
                totalWidth={totalWidth}
                totalHeight={totalHeight}
                columnLabels={columnLabels}
                starPoints={starPoints}
                territory={scored?.territory?.territoryMap || previewTerritory}
                softTerritory={softTerritory}
                stones={gameState.stones}
                lastMove={gameState.lastMove}
                emojiMode={emojiMode}
                activeDeadSet={activeDeadSet}
                onStoneClick={(stone) => {
                  if (isReview) {
                    stepReview(1);
                    return;
                  }
                  if (deadMode) {
                    handleStoneToggleDead(stone);
                    return;
                  }
                  if (!canInteract) return;
                  handleIntersectionClick(stone.x, stone.y);
                }}
                onIntersectionClick={(x, y) => {
                  if (isReview) {
                    stepReview(1);
                    return;
                  }
                  if (!deadMode) {
                    handleIntersectionClick(x, y);
                  }
                }}
                isBlocked={(x, y) => occupiedMap.has(`${x},${y}`)}
              />
            </div>
            {isReview && (
              <KifuControlView
                step={stepReview}
                canBack={canReviewBack}
                canForward={canReviewForward}
                autoPlaying={autoPlay}
                onToggleAuto={() => setAutoPlay((prev) => !prev)}
                t={t}
              />
            )}
          </div>
        </div>

        <div className="sabaki-sidebar">
          <div className="sabaki-panel sabaki-topbar sabaki-topbar--game sabaki-right-header">
            <div className="sabaki-topbar-left">
              <div className="sabaki-title sabaki-title--single">{roomLine}</div>
            </div>
            <div className="sabaki-topbar-right">
              <div className="sabaki-room-name">
                {t("current_room")} {currentRoom.name}
              </div>
              <div className="sabaki-actions sabaki-actions--compact">
                <button
                  className="sabaki-icon-button"
                  onClick={() => {
                    setToast(<RulesPageUI t={t} lang={lang} />);
                  }}
                  title={t("rules_page")}
                  aria-label={t("rules_page")}
                >
                  <img src={labelIcon} alt="" aria-hidden="true" />
                </button>
                <button
                  className="sabaki-icon-button"
                  onClick={() => {
                    setShowGameLogPopup(true);
                  }}
                  title={t("game_log")}
                  aria-label={t("game_log")}
                >
                  <img src={numberIcon} alt="" aria-hidden="true" />
                </button>
                <button
                  className="sabaki-leave-quick"
                  onClick={() => {
                    handleLeaveRoom();
                  }}
                >
                  {t("leave_room")}
                </button>
                {isOwner && (
                  <button
                    className="sabaki-leave-quick"
                    onClick={handleSpectatorChatToggle}
                  >
                    {spectatorChatEnabled
                      ? t("spectator_chat_on")
                      : t("spectator_chat_off")}
                  </button>
                )}
                <button
                  className="sabaki-leave-quick"
                  onClick={() => onLogout?.()}
                >
                  {t("logout")}
                </button>
                <input
                  ref={kifuInputRef}
                  type="file"
                  accept=".sgf"
                  onChange={handleLoadKifuFile}
                  style={{ display: "none" }}
                />
              </div>
            </div>
          </div>
          <div
            className={`sabaki-panel sabaki-action-panel${
              isAiVsAiPlaying ? " is-ai-vs-ai" : ""
            }`}
          >
            {!isSpectator && (
              <div className="sabaki-action-row">
                <button onClick={handleSaveKifu}>{t("kifu_save")}</button>
                <button onClick={handleLoadKifuClick} disabled={!canLoadKifu}>
                  {t("kifu_load")}
                </button>
              </div>
            )}
            {!isSpectator && (
              <div className="sabaki-action-row">
                {isWaiting && (
                  <>
                    <button
                      onClick={() => onStartGame(currentRoom.name)}
                      disabled={
                        currentRoom.owner !== userId ||
                        players.length < 2 ||
                        isPlaying
                      }
                    >
                      {t("start_game")}
                    </button>
                    <select
                      value={aiDifficulty || "intro"}
                      onChange={(e) => onAiDifficultyChange?.(e.target.value)}
                      disabled={currentRoom.owner !== userId || players.length >= 2}
                    >
                      <option value="intro">{t("ai_intro")}</option>
                      <option value="low">{t("ai_low")}</option>
                      <option value="mid">{t("ai_mid")}</option>
                      <option value="high">{t("ai_high")}</option>
                      <option value="master">{t("ai_master")}</option>
                      <option value="god">{t("ai_god")}</option>
                    </select>
                    <button
                      onClick={() => onStartAiGame?.(currentRoom.name, aiDifficulty)}
                      disabled={currentRoom.owner !== userId || players.length >= 2}
                    >
                      {t("start_ai")}
                    </button>
                    <button
                      onClick={() => onStartAiVsAi?.(currentRoom.name, aiDifficulty)}
                      disabled={currentRoom.owner !== userId || players.length >= 2}
                    >
                      {t("start_ai_vs_ai")}
                    </button>
                  </>
                )}
              </div>
            )}
            {!isSpectator && (
              <div className="sabaki-action-panel-actions">
                <ActionPanelView
                  t={t}
                  disabled={!canInteract}
                  disableUndo={!canUndoRequest}
                  disablePass={!canPass}
                  disableScore={!canScoreRequest}
                  disableResign={!canResign}
                  onUndo={() => {
                    if (!canUndoRequest) return;
                    onGameAction?.(currentRoom?.name, { type: "undoRequest" });
                  }}
                  onPass={() => {
                    if (!canPass) return;
                    onGameAction?.(currentRoom?.name, { type: "pass" });
                  }}
                  onScore={() => {
                    if (!canScoreRequest) return;
                    onGameAction?.(currentRoom?.name, { type: "scoreRequest" });
                  }}
                  onResign={() => {
                    if (!canResign) return;
                    onGameAction?.(currentRoom?.name, { type: "resign" });
                  }}
                  scoring={scoring}
                  onDeadMode={startDeadMode}
                  onAutoDead={applyAutoDead}
                  onResetDead={resetDead}
                  deadModeActive={deadMode}
                  onDeadConfirm={confirmDead}
                  onDeadCancel={cancelDead}
                />
              </div>
            )}
          </div>
          <div className="sabaki-panel sabaki-bottom-stack">
            <div className="sabaki-room-panel">
              <PlayerBarView
                emojiMode={emojiMode}
                turn={gameState.turn}
                blackPlayer={blackPlayer}
                whitePlayer={whitePlayer}
                blackCaptures={gameState.captures.black}
                whiteCaptures={gameState.captures.white}
                blackHearts={blackHearts}
                whiteHearts={whiteHearts}
                remainingSec={isPlaying && !gameState.over ? remainingSec : null}
                t={t}
              />
              <div className="sabaki-spectators">
                <div className="sabaki-spectators-title">{t("spectators")}</div>
                <div className="sabaki-spectators-list">
                  {spectators.length ? spectators.join(", ") : t("none")}
                </div>
              </div>
              {(isUndoRequester || isScoreRequester) && (
                <div className="sabaki-waiting-panel">
                  {isUndoRequester ? t("undo_waiting") : t("score_waiting")}
                </div>
              )}
            </div>
            <div className="sabaki-bottom-chat">
              <ChatPanelView
                title={null}
                placeholder={t("chat_placeholder")}
                emptyText={t("chat_empty")}
                userId={userId}
                t={t}
                roomId={currentRoom.name}
                scope={isPlaying ? "game" : "lobby"}
                messages={
                  chatChannels?.[
                    `${isPlaying ? "game" : "lobby"}:${currentRoom.name}`
                  ] || []
                }
                joinTime={
                  chatJoinTimes?.[
                    `${isPlaying ? "game" : "lobby"}:${currentRoom.name}`
                  ] || 0
                }
                onSend={onChatSend}
                disabled={
                  !(
                    players.includes(userId) ||
                    (spectatorChatEnabled && isSpectator)
                  )
                }
                disabledText={
                  isSpectator && !spectatorChatEnabled
                    ? t("chat_spectator_blocked")
                    : isWaiting
                    ? t("chat_waiting_only")
                    : t("chat_players_only")
                }
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


