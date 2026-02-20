import React, { useEffect, useMemo, useState } from "react";

const parseRulesMarkdown = (text) => {
  const lines = String(text || "").split(/\r?\n/);
  const blocks = [];
  let currentList = null;

  lines.forEach((raw) => {
    const line = raw.trim();
    if (!line) {
      currentList = null;
      return;
    }
    if (line.startsWith("# ")) {
      blocks.push({ type: "h1", text: line.slice(2).trim() });
      currentList = null;
      return;
    }
    if (line.startsWith("## ")) {
      blocks.push({ type: "h2", text: line.slice(3).trim() });
      currentList = null;
      return;
    }
    if (line.startsWith("- ")) {
      if (!currentList) {
        currentList = { type: "ul", items: [] };
        blocks.push(currentList);
      }
      currentList.items.push(line.slice(2).trim());
      return;
    }
    blocks.push({ type: "p", text: line });
    currentList = null;
  });

  return blocks;
};

const getRulesDocCandidates = (lang) => {
  if (lang === "en") return ["/rules.en.md", "/rules.ko.md"];
  if (lang === "ja") return ["/rules.ja.md", "/rules.ko.md"];
  if (lang === "zh") return ["/rules.zh.md", "/rules.ko.md"];
  if (lang === "zh-TW") return ["/rules.zh-TW.md", "/rules.zh.md", "/rules.ko.md"];
  return ["/rules.ko.md"];
};

const fetchRulesWithFallback = async (lang) => {
  const candidates = getRulesDocCandidates(lang);
  for (const path of candidates) {
    const res = await fetch(path);
    if (!res.ok) continue;
    return res.text();
  }
  throw new Error("rules load failed");
};

export default function RulesPageUI({ t = (key) => key, lang = "ko" }) {
  const [content, setContent] = useState("");
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    fetchRulesWithFallback(lang)
      .then((text) => {
        if (!active) return;
        setContent(text);
      })
      .catch((err) => {
        if (!active) return;
        setError(err);
      });
    return () => {
      active = false;
    };
  }, [lang]);

  const blocks = useMemo(() => parseRulesMarkdown(content), [content]);

  return (
    <div className="rules-shell">
      {error && (
        <div className="rules-title">{t("rules_load_failed")}</div>
      )}
      {!error && !content && (
        <div className="rules-title">{t("rules_loading")}</div>
      )}
      {!error &&
        blocks.map((block, index) => {
          if (block.type === "h1" || block.type === "h2") {
            return (
              <div key={`${block.type}-${index}`} className="rules-title">
                {block.text}
              </div>
            );
          }
          if (block.type === "ul") {
            return (
              <ul key={`list-${index}`} className="rules-list">
                {block.items.map((item, itemIndex) => (
                  <li key={`item-${index}-${itemIndex}`}>{item}</li>
                ))}
              </ul>
            );
          }
          return (
            <div key={`p-${index}`} className="rules-paragraph">
              {block.text}
            </div>
          );
        })}
    </div>
  );
}
