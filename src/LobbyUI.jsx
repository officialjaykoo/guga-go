import React, { useState } from "react";
import balanceIcon from "./img/ui/balance.svg";
import playerBlackIcon from "./img/ui/player_-1.svg";
import playerWhiteIcon from "./img/ui/player_1.svg";
import ChatPanelView from "./components/ChatPanelView";
import RulesPageUI from "./RulesPageUI";
import { validateName } from "./validation";

export default function LobbyUI({
  userId,
  rooms,
  onJoinRoom,
  onCreateRoom,
  onSpectateRoom,
  waitingUsers,
  onLogout,
  chatChannels,
  onChatSend,
  onChatJoin,
  chatJoinTimes,
  t,
  lang,
  connected,
}) {
  const [newRoomRuleset, setNewRoomRuleset] = useState("korean");
  const [newRoomName, setNewRoomName] = useState("");
  const [error, setError] = useState("");
  const [selectedRoom, setSelectedRoom] = useState("");
  const [toast, setToast] = useState(null);

  return (
    <div className="sabaki-shell sabaki-shell--lobby">
      {toast && (
        <div
          className="sabaki-toast"
          onClick={() => setToast(null)}
        >
          {toast}
        </div>
      )}

      <div className="sabaki-topbar">
        <div className="sabaki-title">
          <img
            className="sabaki-title-icon"
            src={balanceIcon}
            alt=""
            aria-hidden="true"
          />
          {t("lobby")}
        </div>
        <div className="sabaki-actions">
          <button onClick={() => setToast(<RulesPageUI t={t} lang={lang} />)}>
            {t("rules_page")}
          </button>
          <button onClick={onLogout}>{t("logout")}</button>
        </div>
      </div>

      <div className="sabaki-main">
        <div className="sabaki-panel">
          <div className="sabaki-section-title sabaki-section-title--spaced">
            {t("rooms_title")}
          </div>
          {rooms.length === 0 && (
            <div className="sabaki-rooms-empty">
              {t("rooms_empty")}
            </div>
          )}
          {rooms.length > 0 && (
            <div className="sabaki-room-list">
              {rooms.map((room) => {
                const isFull = room.players.length >= 2;
                const isWaiting = room.status !== "playing";
                const isJoinable = isWaiting && !isFull;
                const rulesetLabel =
                  room.ruleset === "chinese"
                    ? t("ruleset_chinese")
                    : room.ruleset === "japanese"
                    ? t("ruleset_japanese")
                    : t("ruleset_korean");
                const aiLabel = room.ai?.enabled
                  ? room.ai.vsAi
                    ? `${t("ai_vs_ai_label")}(${
                        room.ai.difficulty || t("ai_difficulty_server")
                      })`
                    : `${t("ai_label")}(${
                        room.ai.difficulty || t("ai_difficulty_server")
                      })`
                  : "";
                const statusLabel =
                  room.status === "playing"
                    ? t("status_playing")
                    : t("status_waiting");
                return (
                  <div key={room.name} className="sabaki-room">
                    <div className="sabaki-room-top">
                      <div
                        className="sabaki-room-title"
                        onClick={() => {
                          setSelectedRoom(room.name);
                          onChatJoin?.("lobby", room.name);
                        }}
                      >
                        <span
                          className={`sabaki-room-dot ${
                            isWaiting ? "is-waiting" : "is-playing"
                          }`}
                        />
                        <span>{room.name}</span>
                        <span className="sabaki-room-status">
                          {aiLabel ? `${aiLabel} / ` : ""}
                          {statusLabel}
                        </span>
                      </div>
                      <div
                        className={`sabaki-room-graph ${
                          isWaiting ? "is-waiting" : "is-playing"
                        }`}
                      >
                        <span className="bar-1" />
                        <span className="bar-2" />
                        <span className="bar-3" />
                      </div>
                    </div>
                    <div
                      className="sabaki-meta sabaki-meta-row"
                    >
                      <span>
                        {t("ruleset_label")} {rulesetLabel}
                      </span>
                      <span>{t("players")}</span>
                      <span className="sabaki-player-slot">
                        <img
                          src={playerBlackIcon}
                          alt=""
                          aria-hidden="true"
                          className="sabaki-player-icon"
                        />
                        {room.players[0] || t("none")}
                      </span>
                      <span className="sabaki-player-slot">
                        <img
                          src={playerWhiteIcon}
                          alt=""
                          aria-hidden="true"
                          className="sabaki-player-icon"
                        />
                        {room.players[1] || t("none")}
                      </span>
                    </div>
                    <div className="sabaki-room-actions">
                      <button
                        disabled={!isJoinable}
                        onClick={() => {
                          if (isJoinable) {
                            onJoinRoom(room.name);
                          }
                        }}
                      >
                        {isJoinable ? t("enter_room") : t("full")}
                      </button>
                      <button
                        disabled={!connected}
                        onClick={() => {
                          if (connected) {
                            onSpectateRoom?.(room.name);
                          }
                        }}
                      >
                        {t("spectate")}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="sabaki-panel sabaki-panel-stack">
          <div className="sabaki-form">
            <div className="sabaki-section-title">{t("create_room")}</div>
            <input
              placeholder={t("room_name")}
              value={newRoomName}
              onChange={(e) => {
                setNewRoomName(e.target.value);
                setError("");
              }}
            />
            <select
              value={newRoomRuleset}
              onChange={(e) => setNewRoomRuleset(e.target.value)}
            >
              <option value="korean">{t("ruleset_korean_desc")}</option>
              <option value="chinese">{t("ruleset_chinese_desc")}</option>
              <option value="japanese">{t("ruleset_japanese_desc")}</option>
            </select>
            <button
              onClick={() => {
                const validation = validateName(newRoomName);
                if (!validation.ok) {
                  setError(
                    validation.reason === "empty"
                      ? t("room_name_required")
                      : t("name_invalid")
                  );
                  return;
                }
                onCreateRoom(validation.value, newRoomRuleset);
                setNewRoomName("");
              }}
              disabled={!connected}
            >
              {t("create_room")}
            </button>
            {error && <div className="sabaki-error">{error}</div>}
          </div>

          <div>
            <div className="sabaki-section-title">{t("waiting_list")}</div>
            <div className="sabaki-waiting-body">
              {waitingUsers.length === 0 && t("none")}
              {waitingUsers.length > 0 &&
                waitingUsers.map((user) => (
                  <div key={`wait-${user}`}>{user}</div>
                ))}
            </div>
          </div>

          {selectedRoom && (
            <ChatPanelView
              title={`${selectedRoom} ${t("chat")}`}
              placeholder={t("chat_placeholder")}
              emptyText={t("chat_empty")}
              userId={userId}
              t={t}
              roomId={selectedRoom}
              scope="lobby"
              messages={chatChannels?.[`lobby:${selectedRoom}`] || []}
              joinTime={chatJoinTimes?.[`lobby:${selectedRoom}`] || 0}
              onSend={onChatSend}
              disabled={
                !rooms.find((room) => room.name === selectedRoom)?.players.includes(
                  userId
                ) ||
                rooms.find((room) => room.name === selectedRoom)?.status ===
                  "playing"
              }
              disabledText={t("chat_waiting_only")}
            />
          )}
        </div>
      </div>
    </div>
  );
}
