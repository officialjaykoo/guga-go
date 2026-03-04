import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import LoginUI from "./LoginUI";
import LobbyUI from "./LobbyUI";
import GameUI from "./GameUI";
import {
  DEFAULT_LANG,
  LANG_OPTIONS,
  loadLangPreference,
  normalizeLang,
  saveLangPreference,
  tFactory,
} from "../shared/common/i18n";
import { validateName } from "../shared/common/validation";

const DEFAULT_LOBBY_STATE = {
  rooms: [],
  waitingUsers: [],
  nextRoomId: 1,
  chat: { channels: {} },
  updatedAt: 0,
};

const normalizeLobbyState = (raw) => {
  const rooms = Array.isArray(raw?.rooms) ? raw.rooms : [];
  const waitingUsers = Array.isArray(raw?.waitingUsers) ? raw.waitingUsers : [];
  const chat = raw?.chat && typeof raw.chat === "object" ? raw.chat : { channels: {} };
  const nextRoomId = Number.isFinite(raw?.nextRoomId)
    ? Math.max(1, Math.floor(raw.nextRoomId))
    : 1;
  const updatedAt = Number.isFinite(raw?.updatedAt) ? raw.updatedAt : 0;

  return {
    rooms: rooms
      .filter((room) => room && typeof room.name === "string")
      .map((room) => ({
        name: room.name,
        players: Array.isArray(room.players)
          ? room.players.filter(Boolean)
          : [],
        ruleset: room.ruleset || "korean",
        status: room.status || "waiting",
        owner: room.owner || "",
        spectators: Array.isArray(room.spectators)
          ? room.spectators.filter(Boolean)
          : [],
        spectatorChatEnabled: Boolean(room.spectatorChatEnabled),
        ai: room.ai && typeof room.ai === "object"
          ? {
              enabled: Boolean(room.ai.enabled),
              color: room.ai.color || "white",
              name: room.ai.name || "",
              difficulty: room.ai.difficulty || "",
              vsAi: Boolean(room.ai.vsAi),
              black: room.ai.black || null,
              white: room.ai.white || null,
            }
          : null,
        game: room.game && Array.isArray(room.game.history)
          ? {
              history: room.game.history,
              timer: room.game.timer || null,
              pendingUndo: room.game.pendingUndo || null,
              pendingScore: room.game.pendingScore || null,
              undoUsed: Boolean(room.game.undoUsed),
              undoRequests: room.game.undoRequests || null,
              notifications: Array.isArray(room.game.notifications)
                ? room.game.notifications
                : [],
              review: Boolean(room.game.review),
            }
          : null,
      })),
    waitingUsers: waitingUsers.filter(Boolean),
    nextRoomId,
    chat: {
      channels:
        chat?.channels && typeof chat.channels === "object"
          ? chat.channels
          : {},
    },
    updatedAt,
  };
};

const getWsUrl = () => {
  const envUrl = import.meta?.env?.VITE_WS_URL;
  if (envUrl) {
    return envUrl;
  }
  return "ws://localhost:5174";
};

export default function AppUI() {
  const [screen, setScreen] = useState("login");
  const [userId, setUserId] = useState("");
  const [lang, setLang] = useState(() =>
    loadLangPreference() || DEFAULT_LANG
  );
  const t = useMemo(() => tFactory(lang), [lang]);
  const [lobbyState, setLobbyState] = useState(DEFAULT_LOBBY_STATE);
  const [currentRoom, setCurrentRoom] = useState(null);
  const [aiDifficulty, setAiDifficulty] = useState("intro");
  const [connected, setConnected] = useState(false);
  const [chatJoinTimes, setChatJoinTimes] = useState({});
  const [serverNotice, setServerNotice] = useState(null);
  const [roomRole, setRoomRole] = useState("play");
  const wsRef = useRef(null);
  const reconnectRef = useRef(null);
  const reconnectDelayRef = useRef(500);
  const pendingAuthRef = useRef(null);
  const userIdRef = useRef("");
  const screenRef = useRef("login");
  const currentRoomRef = useRef(null);
  const roomRoleRef = useRef("play");

  const handleLangChange = useCallback((nextLang) => {
    const normalized = normalizeLang(nextLang);
    setLang(normalized);
    saveLangPreference(normalized);
  }, []);

  const rooms = lobbyState.rooms;
  const waitingUsers = lobbyState.waitingUsers.filter(
    (user) =>
      !rooms.some(
        (room) =>
          room.players.includes(user) || room.spectators?.includes(user)
      )
  );
  const currentRoomData = rooms.find((room) => room.name === currentRoom) || null;
  const effectiveRoom = currentRoomData;
  const lobbyRooms = rooms;
  const shouldConnect = true;

  const send = useCallback((payload) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    ws.send(JSON.stringify(payload));
    return true;
  }, []);

  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  useEffect(() => {
    screenRef.current = screen;
  }, [screen]);

  useEffect(() => {
    currentRoomRef.current = currentRoom;
  }, [currentRoom]);

  useEffect(() => {
    roomRoleRef.current = roomRole;
  }, [roomRole]);

  useEffect(() => {
    if (!shouldConnect) {
      if (reconnectRef.current) {
        clearTimeout(reconnectRef.current);
        reconnectRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setConnected(false);
      return;
    }

    let cancelled = false;
    const scheduleReconnect = () => {
      if (cancelled || !shouldConnect) return;
      if (reconnectRef.current) {
        clearTimeout(reconnectRef.current);
      }
      const delay = reconnectDelayRef.current;
      reconnectRef.current = setTimeout(() => {
        if (!cancelled && shouldConnect) {
          connect();
        }
      }, delay);
      reconnectDelayRef.current = Math.min(delay * 1.5, 10000);
    };

    const connect = () => {
      if (cancelled || !shouldConnect) return;
      const ws = new WebSocket(getWsUrl());
      wsRef.current = ws;

      ws.addEventListener("open", () => {
        reconnectDelayRef.current = 500;
        setConnected(true);
        if (pendingAuthRef.current) {
          send(pendingAuthRef.current);
        }
        const trimmed = userIdRef.current.trim();
        if (!trimmed) return;
        if (screenRef.current === "lobby") {
          send({ type: "enterLobby", userId: trimmed });
        } else if (screenRef.current === "game" && currentRoomRef.current) {
          const role = roomRoleRef.current;
          const type = role === "spectate" ? "spectateRoom" : "joinRoom";
          send({
            type,
            userId: trimmed,
            roomName: currentRoomRef.current,
          });
        }
      });

      ws.addEventListener("message", (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data?.type === "notice" && typeof data.text === "string") {
            setServerNotice({ text: data.text, at: Date.now() });
            return;
          }
          if (data?.type === "authOk" && typeof data.userId === "string") {
            const normalized = data.userId.trim();
            if (!normalized) return;
            pendingAuthRef.current = null;
            setUserId(normalized);
            userIdRef.current = normalized;
            setScreen("lobby");
            screenRef.current = "lobby";
            return;
          }
          if (data?.type === "chatEvent") {
            const scope = String(data.scope || "").trim() || "lobby";
            const roomId = String(data.roomId || "").trim() || "global";
            const entry = data.entry;
            if (!entry || typeof entry !== "object") return;
            const key = `${scope}:${roomId}`;
            setLobbyState((prev) => {
              const channels = prev?.chat?.channels || {};
              const list = Array.isArray(channels[key]) ? channels[key] : [];
              return {
                ...prev,
                chat: {
                  channels: {
                    ...channels,
                    [key]: [...list, entry].slice(-200),
                  },
                },
              };
            });
            return;
          }
          if (data?.type === "state") {
            setLobbyState(normalizeLobbyState(data.state));
          }
        } catch {
          // ignore malformed payloads
        }
      });

      ws.addEventListener("close", () => {
        setConnected(false);
        scheduleReconnect();
      });

      ws.addEventListener("error", () => {
        ws.close();
      });
    };

    connect();
    return () => {
      cancelled = true;
      if (reconnectRef.current) {
        clearTimeout(reconnectRef.current);
        reconnectRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [send, shouldConnect]);

  useEffect(() => {
    if (currentRoom && !currentRoomData) {
      setCurrentRoom(null);
      if (screen === "game") {
        setScreen("lobby");
      }
    }
  }, [currentRoom, currentRoomData, screen]);

  useEffect(() => {
    if (!serverNotice) return;
    const id = setTimeout(() => setServerNotice(null), 3500);
    return () => clearTimeout(id);
  }, [serverNotice]);

  useEffect(() => {
    const trimmed = userId.trim();
    if (!trimmed) {
      return;
    }
    const activeRoom = rooms.find((room) =>
      room.players.includes(trimmed) ||
      room.spectators?.includes(trimmed) ||
      (room.ai?.vsAi && room.owner === trimmed && room.name === currentRoom)
    );
    if (activeRoom && activeRoom.name !== currentRoom) {
      setCurrentRoom(activeRoom.name);
      if (screen !== "game") {
        setScreen("game");
      }
    }
    if (activeRoom) {
      if (
        activeRoom.players.includes(trimmed) ||
        (activeRoom.ai?.vsAi && activeRoom.owner === trimmed)
      ) {
        if (roomRoleRef.current !== "play") {
          setRoomRole("play");
        }
      } else if (activeRoom.spectators?.includes(trimmed)) {
        if (roomRoleRef.current !== "spectate") {
          setRoomRole("spectate");
        }
      }
    }
    if (!activeRoom && currentRoom && screen === "game") {
      setCurrentRoom(null);
      setScreen("lobby");
      setRoomRole("play");
    }
  }, [rooms, userId, currentRoom, screen]);

  const enterLobby = (nextUserId) => {
    const validation = validateName(nextUserId ?? userId);
    if (!validation.ok) return;
    const trimmed = validation.value;
    pendingAuthRef.current = {
      type: "authLogin",
      provider: "guest",
      guestId: trimmed,
    };
    send(pendingAuthRef.current);
  };

  const loginGoogle = (idToken) => {
    const token = String(idToken || "").trim();
    if (!token) return;
    pendingAuthRef.current = {
      type: "authLogin",
      provider: "google",
      idToken: token,
    };
    send(pendingAuthRef.current);
  };

  const createRoom = (title, ruleset) => {
    const validation = validateName(userId);
    if (!validation.ok) return;
    const trimmed = validation.value;
    setScreen("game");
    send({ type: "createRoom", userId: trimmed, title, ruleset });
  };

  const joinRoom = (roomName) => {
    const validation = validateName(userId);
    if (!validation.ok) return;
    const trimmed = validation.value;
    setCurrentRoom(roomName);
    setScreen("game");
    setRoomRole("play");
    send({ type: "joinRoom", userId: trimmed, roomName });
  };

  const spectateRoom = (roomName) => {
    const validation = validateName(userId);
    if (!validation.ok) return;
    const trimmed = validation.value;
    setCurrentRoom(roomName);
    setScreen("game");
    setRoomRole("spectate");
    send({ type: "spectateRoom", userId: trimmed, roomName });
  };

  const leaveRoom = (roomName) => {
    const validation = validateName(userId);
    const trimmed = validation.ok ? validation.value : "";
    setCurrentRoom(null);
    setScreen("lobby");
    setRoomRole("play");
    if (trimmed) {
      send({ type: "leaveRoom", userId: trimmed, roomName });
    }
  };

  const startGame = (roomName) => {
    const validation = validateName(userId);
    if (!validation.ok) return;
    const trimmed = validation.value;
    send({ type: "startGame", userId: trimmed, roomName });
  };

  const startAiGame = (roomName, difficulty) => {
    if (!roomName) return;
    const level = difficulty || "intro";
    setAiDifficulty(level);
    const validation = validateName(userId);
    if (!validation.ok) return;
    const trimmed = validation.value;
    send({ type: "startAiGame", userId: trimmed, roomName, difficulty: level });
  };

  const startAiVsAiGame = (roomName, difficulty) => {
    if (!roomName) return;
    const level = difficulty || "intro";
    setAiDifficulty(level);
    const validation = validateName(userId);
    if (!validation.ok) return;
    const trimmed = validation.value;
    send({
      type: "startAiVsAiGame",
      userId: trimmed,
      roomName,
      difficulty: level,
    });
  };

  const gameAction = (roomName, action) => {
    const validation = validateName(userId);
    if (!validation.ok || !roomName) return;
    const trimmed = validation.value;
    send({ type: "gameAction", userId: trimmed, roomName, action });
  };

  const loadKifu = (roomName, payload) => {
    const validation = validateName(userId);
    if (!validation.ok || !roomName) return;
    if (!payload?.history || !Array.isArray(payload.history)) return;
    const trimmed = validation.value;
    send({
      type: "loadKifu",
      userId: trimmed,
      roomName,
      history: payload.history,
      ruleset: payload.ruleset,
      komi: payload.komi,
      review: payload.review !== false,
    });
  };

  const setSpectatorChat = (roomName, enabled) => {
    const validation = validateName(userId);
    if (!validation.ok || !roomName) return;
    const trimmed = validation.value;
    send({
      type: "setSpectatorChat",
      userId: trimmed,
      roomName,
      enabled: Boolean(enabled),
    });
  };

  const sendChat = (payload) => {
    const validation = validateName(userId);
    if (!validation.ok) return;
    const trimmed = validation.value;
    send({
      type: "chatSend",
      userId: trimmed,
      scope: payload.scope,
      roomId: payload.roomId,
      text: payload.text,
    });
  };

  const ensureChatJoinTime = useCallback((scope, roomId) => {
    if (!scope || !roomId) return;
    const key = `${scope}:${roomId}`;
    setChatJoinTimes((prev) => {
      if (prev[key] && Date.now() - prev[key] < 1000) {
        return prev;
      }
      return { ...prev, [key]: Date.now() };
    });
  }, []);

  const logout = () => {
    const trimmed = userId.trim();
    if (trimmed) {
      send({ type: "logout", userId: trimmed });
    }
    pendingAuthRef.current = null;
    setCurrentRoom(null);
    setScreen("login");
    setUserId("");
    setRoomRole("play");
  };

  const isMobileHost =
    typeof window !== "undefined" && window.location.hostname.startsWith("m.");

  return (
    <div className={`app-shell ${isMobileHost ? "app-shell--mobile" : ""}`}>
      <div className="app-lang-switch">
        <label htmlFor="app-lang-select">{t("language_label")}</label>
        <select
          id="app-lang-select"
          value={lang}
          onChange={(e) => handleLangChange(e.target.value)}
        >
          {LANG_OPTIONS.map((option) => (
            <option
              key={option.code}
              value={option.code}
              disabled={!option.enabled}
            >
              {t(option.labelKey)}
              {option.enabled ? "" : ` ${t("language_planned_suffix")}`}
            </option>
          ))}
        </select>
      </div>
      {serverNotice && (
        <div
          className="app-notice"
          onClick={() => setServerNotice(null)}
        >
          {serverNotice.text}
        </div>
      )}
      {screen === "login" && (
        <LoginUI
          onGuestEnter={enterLobby}
          onGoogleLogin={loginGoogle}
          t={t}
        />
      )}

      {screen === "lobby" && (
        <LobbyUI
          userId={userId}
          rooms={lobbyRooms}
          onJoinRoom={joinRoom}
          onCreateRoom={createRoom}
          onSpectateRoom={spectateRoom}
          waitingUsers={waitingUsers}
          onLogout={logout}
          chatChannels={lobbyState.chat.channels}
          onChatSend={sendChat}
          onChatJoin={ensureChatJoinTime}
          chatJoinTimes={chatJoinTimes}
          t={t}
          lang={lang}
          connected={connected}
        />
      )}

      {screen === "game" && (
        <GameUI
          currentRoom={effectiveRoom}
          userId={userId}
          onLeaveRoom={leaveRoom}
          onStartGame={startGame}
          onStartAiGame={startAiGame}
          onStartAiVsAi={startAiVsAiGame}
          aiDifficulty={aiDifficulty}
          onAiDifficultyChange={setAiDifficulty}
          onGameAction={gameAction}
          onLoadKifu={loadKifu}
          onSpectatorChatToggle={setSpectatorChat}
          onLogout={logout}
          chatChannels={lobbyState.chat.channels}
          onChatSend={sendChat}
          onChatJoin={ensureChatJoinTime}
          chatJoinTimes={chatJoinTimes}
          t={t}
          lang={lang}
        />
      )}
    </div>
  );
}





