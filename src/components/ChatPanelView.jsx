import React, { useEffect, useRef, useState } from "react";

export default function ChatPanelView({
  title,
  placeholder,
  emptyText,
  userId,
  t,
  roomId,
  scope,
  messages,
  joinTime,
  onSend,
  disabled = false,
  disabledText = "",
}) {
  const [input, setInput] = useState("");
  const safeMessages = Array.isArray(messages) ? messages : [];
  const filteredMessages = joinTime
    ? safeMessages.filter((msg) => !msg.ts || msg.ts >= joinTime)
    : safeMessages;
  const scrollRef = useRef(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [filteredMessages.length]);

  const send = () => {
    if (disabled) return;
    const text = input.trim();
    if (!text) return;
    onSend?.({ scope, roomId, text, userId });
    setInput("");
  };

  return (
    <div
      className="chat-panel"
    >
      {title ? (
        <div className="chat-header">
          {title}
        </div>
      ) : null}
      <div
        className="chat-body"
        ref={scrollRef}
      >
        {filteredMessages.length === 0 && (
          <div className="chat-empty">{emptyText}</div>
        )}
        {filteredMessages.map((msg) => (
          <div
            key={msg.id}
            className={`chat-message ${msg.user === userId ? "is-self" : ""}`}
          >
            <div
              className={`chat-meta ${msg.user === userId ? "is-self" : ""}`}
            >
              <div className="chat-meta-name">{msg.user}</div>
              <div>{msg.time}</div>
            </div>
            <div
              className={`chat-bubble-wrap ${msg.user === userId ? "is-self" : ""}`}
            >
              <div
                className={`chat-bubble ${msg.user === userId ? "is-self" : ""}`}
              >
                {msg.text}
              </div>
            </div>
          </div>
        ))}
      </div>
      {disabled && (
        <div className="chat-disabled">
          {disabledText}
        </div>
      )}
      <div
        className="chat-input-row"
      >
        <input
          className="chat-input"
          placeholder={placeholder}
          value={input}
          disabled={disabled}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              send();
            }
          }}
        />
        <button onClick={send} disabled={disabled}>
          {t("chat_send")}
        </button>
      </div>
    </div>
  );
}
