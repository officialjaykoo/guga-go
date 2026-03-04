import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

export const GTP_LETTERS = "ABCDEFGHJKLMNOPQRSTUVWXYZ";

const LOG_LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const getLogLevel = (value) =>
  Object.prototype.hasOwnProperty.call(LOG_LEVELS, value)
    ? LOG_LEVELS[value]
    : LOG_LEVELS.warn;
const KATAGO_LOG_LEVEL = getLogLevel(
  String(process.env.KATAGO_LOG_LEVEL || "warn").toLowerCase()
);
const logWarn = (...args) => {
  if (KATAGO_LOG_LEVEL >= LOG_LEVELS.warn) {
    console.warn(...args);
  }
};

const formatKatagoExit = (code, signal) => {
  const parts = [];
  if (code !== null && code !== undefined) parts.push(`code=${code}`);
  if (signal !== null && signal !== undefined) parts.push(`signal=${signal}`);
  if (!parts.length) return "";
  return ` (${parts.join(", ")})`;
};

const getKatagoExitHint = (code) => {
  const numeric = Number(code);
  if (numeric === 3221225781 || numeric === -1073741515) {
    return "KataGo failed to load a required DLL (Windows STATUS_DLL_NOT_FOUND, 0xC0000135). For CUDA builds, check CUDA/cuDNN DLL compatibility and PATH.";
  }
  if (numeric === 3221225501 || numeric === -1073741795) {
    return "KataGo hit an illegal instruction (0xC000001D). This can happen with unsupported CPU instructions or mismatched binary builds.";
  }
  return "";
};

const buildKatagoUnavailableError = (name, lastExit) => {
  const detail = lastExit
    ? formatKatagoExit(lastExit.code, lastExit.signal)
    : "";
  const hint = lastExit ? getKatagoExitHint(lastExit.code) : "";
  const message = `${name} process not started.${detail}`;
  return new Error(hint ? `${message} ${hint}` : message);
};

export class GtpClient {
  constructor({
    command,
    args = [],
    cwd = process.cwd(),
    name = "katago",
    startupDelayMs = 0,
    maxTimeouts = 10,
    onExit = null,
    onTimeoutLimit = null,
    onUnknownCommand = null,
    deferStderr = false,
  }) {
    this.command = command;
    this.args = args;
    this.cwd = cwd;
    this.name = name;
    this.startupDelayMs = startupDelayMs;
    this.maxTimeouts = maxTimeouts;
    this.onExit = onExit;
    this.onTimeoutLimit = onTimeoutLimit;
    this.onUnknownCommand = onUnknownCommand;
    this.deferStderr = deferStderr;
    this.stderrBuffer = [];
    this.lastExit = null;
    this.stopPermanent = true;
    this.proc = null;
    this.queue = [];
    this.current = null;
    this.closed = false;
    this.timeoutCount = 0;
    this.readyAt = 0;
    this.supportedCommands = null;
    this.supportedCommandsPromise = null;
    this.lastRulesetSent = null;
    this.boardSizeValue = null;
    this.positionMoves = null;
    this.lastSetupRuleset = null;
    this.lastSetupKomi = null;
  }

  start() {
    if (this.proc || this.closed) return;
    const proc = spawn(this.command, this.args, {
      cwd: this.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.proc = proc;
    this.closed = false;
    this.stopPermanent = true;
    this.readyAt = Date.now() + this.startupDelayMs;
    const rl = createInterface({ input: proc.stdout });
    rl.on("line", (line) => this._onLine(line));
    proc.stderr.on("data", (chunk) => {
      const text = String(chunk).trim();
      if (!text) return;
      if (this.deferStderr) {
        this.stderrBuffer.push(text);
        return;
      }
      logWarn(`[${this.name}]`, text);
    });
    proc.on("exit", (code, signal) => {
      if (this.proc !== proc) return;
      logWarn(`[${this.name}] exited`, { code, signal });
      this.lastExit = { code, signal, at: Date.now() };
      const hint = getKatagoExitHint(code);
      if (hint) {
        logWarn(`[${this.name}]`, hint);
      }
      this.proc = null;
      this.closed = this.stopPermanent;
      this.stopPermanent = true;
      if (typeof this.onExit === "function") {
        this.onExit({ code, signal });
      }
      if (this.current) {
        const detail = formatKatagoExit(code, signal);
        const message = `${this.name} exited before response.${detail}`;
        this.current.reject(new Error(hint ? `${message} ${hint}` : message));
        this.current = null;
      }
      this.queue.splice(0).forEach((item) => {
        item.reject(buildKatagoUnavailableError(this.name, this.lastExit));
      });
    });
  }

  stop({ permanent = true } = {}) {
    this.stopPermanent = permanent;
    if (this.proc) {
      this.proc.kill();
      this.proc = null;
    }
    this.closed = permanent;
    this.boardSizeValue = null;
    this.positionMoves = null;
    this.lastSetupRuleset = null;
    this.lastSetupKomi = null;
    this.lastRulesetSent = null;
  }

  flushStderr() {
    if (!this.stderrBuffer.length) return;
    this.stderrBuffer.forEach((line) => {
      logWarn(`[${this.name}]`, line);
    });
    this.stderrBuffer = [];
  }

  enableStderr() {
    this.deferStderr = false;
    this.flushStderr();
  }

  send(command, timeoutMs = 2000) {
    if (!this.proc) {
      this.start();
    }
    if (!this.proc) {
      return Promise.reject(
        buildKatagoUnavailableError(this.name, this.lastExit)
      );
    }
    return new Promise((resolve, reject) => {
      const item = {
        command,
        resolve,
        reject,
        lines: [],
        startedAt: Date.now(),
        timeoutMs,
      };
      const delay = Math.max(0, this.readyAt - Date.now());
      if (delay > 0) {
        setTimeout(() => {
          if (this.closed) {
            item.reject(buildKatagoUnavailableError(this.name, this.lastExit));
            return;
          }
          this.queue.push(item);
          this._flush();
        }, delay);
      } else {
        this.queue.push(item);
        this._flush();
      }
    });
  }

  _flush() {
    if (this.current || this.queue.length === 0 || !this.proc) return;
    this.current = this.queue.shift();
    try {
      this.proc.stdin.write(`${this.current.command}\n`);
    } catch (err) {
      this.current.reject(err);
      this.current = null;
      this._flush();
      return;
    }
    if (this.current.timeoutMs > 0) {
      this.current.timer = setTimeout(() => {
        if (!this.current) return;
        this.timeoutCount += 1;
        if (this.timeoutCount >= this.maxTimeouts) {
          if (typeof this.onTimeoutLimit === "function") {
            this.onTimeoutLimit();
          }
          this.stop();
        }
        const command = String(this.current.command || "").trim();
        this.current.reject(
          new Error(
            `${this.name} timeout on command: ${command || "<empty>"}`
          )
        );
        this.current = null;
        this._flush();
      }, this.current.timeoutMs);
    }
  }

  _onLine(line) {
    if (!this.current) return;
    if (line === "") {
      if (this.current.timer) clearTimeout(this.current.timer);
      this.timeoutCount = 0;
      const response = {
        ok: true,
        lines: this.current.lines,
      };
      this.current.resolve(response);
      this.current = null;
      this._flush();
      return;
    }
    if (line.startsWith("=")) {
      this.current.lines.push(line.slice(1).trim());
      return;
    }
    if (line.startsWith("?")) {
      const message = line.slice(1).trim();
      const command = this.current.command || "";
      const lower = message.toLowerCase();
      if (lower.includes("unknown command") && typeof this.onUnknownCommand === "function") {
        const handled = this.onUnknownCommand({ command, message, lower, client: this });
        if (handled?.handled) {
          if (this.current.timer) clearTimeout(this.current.timer);
          if (handled.response) {
            this.current.resolve(handled.response);
          } else {
            this.current.resolve({ ok: false, lines: [] });
          }
          this.current = null;
          this._flush();
          return;
        }
      }
      const err = new Error(`${this.name} error: ${message}`);
      if (this.current.timer) clearTimeout(this.current.timer);
      this.current.reject(err);
      this.current = null;
      this._flush();
      return;
    }
    this.current.lines.push(line);
  }
}

export const isTimeoutError = (err) => {
  const message = String(err?.message || err || "").toLowerCase();
  return message.includes("timeout");
};

export const sendWithRetry = async (client, command, timeoutMs, retryTimeoutMult = 2) => {
  try {
    return await client.send(command, timeoutMs);
  } catch (err) {
    if (!isTimeoutError(err)) throw err;
    client.stop({ permanent: false });
    client.start();
    const retryMs = Math.max(timeoutMs * retryTimeoutMult, timeoutMs);
    return await client.send(command, retryMs);
  }
};

export const coordToGtp = (x, y) => {
  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    throw new Error(`Invalid coordinate: (${x}, ${y})`);
  }
  if (x < 1 || x > GTP_LETTERS.length || y < 1) {
    throw new Error(`Out-of-range coordinate: (${x}, ${y})`);
  }
  const letter = GTP_LETTERS[x - 1];
  if (!letter) {
    throw new Error(`Invalid GTP x coordinate: ${x}`);
  }
  return `${letter}${y}`;
};

export const gtpToCoord = (move) => {
  if (!move) return null;
  const value = move.trim().toUpperCase();
  if (value === "PASS" || value === "RESIGN") return value.toLowerCase();
  const letter = value[0];
  const x = GTP_LETTERS.indexOf(letter) + 1;
  const y = Number(value.slice(1));
  if (!x || !Number.isFinite(y)) return null;
  return { x, y };
};

export const buildMoveListFromHistory = (history, greenAs = "black") => {
  const moves = [];
  history.slice(1).forEach((state) => {
    const last = state.lastMove;
    if (!last) return;
    if (last.type === "stone") {
      let color = last.player;
      const stones = state.stones || [];
      const placed = stones.find(
        (stone) => stone.x === last.x && stone.y === last.y
      );
      if (placed?.color === "green") {
        color = greenAs === "white" ? "white" : "black";
      }
      moves.push({ color, x: last.x, y: last.y });
    } else if (last.type === "pass") {
      moves.push({ color: last.player, pass: true });
    }
  });
  return moves;
};

export const getKataGoRuleset = (ruleset) => {
  if (ruleset === "chinese") return "chinese";
  if (ruleset === "japanese") return "japanese";
  if (ruleset === "korean") return "korean";
  return "japanese";
};

export const getSupportedCommands = async (client) => {
  if (client.supportedCommands) return client.supportedCommands;
  if (client.supportedCommandsPromise) return client.supportedCommandsPromise;
  client.supportedCommandsPromise = (async () => {
    try {
      const response = await client.send("list_commands", 800);
      const entries = response.lines
        .map((line) => line.trim())
        .filter(Boolean);
      const set = new Set(entries);
      client.supportedCommands = set;
      return set;
    } catch {
      client.supportedCommands = null;
      return null;
    } finally {
      client.supportedCommandsPromise = null;
    }
  })();
  return client.supportedCommandsPromise;
};

export const applyKatagoRules = async (
  client,
  ruleset,
  {
    rulesCommand = "auto",
    setupTimeoutMs = 1200,
    sendCommand = null,
  } = {}
) => {
  const value = getKataGoRuleset(ruleset);
  if (value === "japanese") {
    return;
  }
  if (client.lastRulesetSent === value) {
    return;
  }
  const sendRules = async (command) => {
    try {
      if (sendCommand) {
        await sendCommand(command, setupTimeoutMs);
      } else {
        await client.send(command, setupTimeoutMs);
      }
      client.lastRulesetSent = value;
    } catch {
      // ignore rule-setting failures
    }
  };
  if (rulesCommand === "none" || rulesCommand === "off" || rulesCommand === "0") {
    return;
  }
  if (rulesCommand === "rules") {
    await sendRules(`rules ${value}`);
    return;
  }
  if (rulesCommand === "kata-set-rules") {
    await sendRules(`kata-set-rules ${value}`);
    return;
  }
  if (rulesCommand === "auto") {
    const commands = await getSupportedCommands(client);
    if (commands?.has("rules")) {
      await sendRules(`rules ${value}`);
      return;
    }
    if (commands?.has("kata-set-rules")) {
      await sendRules(`kata-set-rules ${value}`);
    }
    return;
  }
  try {
    await sendRules(`rules ${value}`);
  } catch {
    // ignore rule-setting failures
  }
};

export const setupKatagoPosition = async (
  client,
  history,
  ruleset,
  komi,
  {
    board,
    allowRect = true,
    rulesCommand = "auto",
    setupTimeoutMs = 1200,
    greenAs = "black",
    sendCommand = null,
  } = {}
) => {
  if (!board) {
    throw new Error("setupKatagoPosition requires board");
  }
  if (board.columns !== board.rows && !allowRect) {
    return false;
  }
  const boardSizeCommand =
    board.columns === board.rows || !allowRect
      ? `boardsize ${board.columns}`
      : `boardsize ${board.columns} ${board.rows}`;
  if (client.boardSizeValue !== boardSizeCommand) {
    if (sendCommand) {
      await sendCommand(boardSizeCommand, setupTimeoutMs);
    } else {
      await client.send(boardSizeCommand, setupTimeoutMs);
    }
    client.boardSizeValue = boardSizeCommand;
  }

  const moves = buildMoveListFromHistory(history, greenAs);
  const rulesValue = getKataGoRuleset(ruleset);
  const sameKomi = (a, b) => {
    const na = Number(a);
    const nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) {
      return Math.abs(na - nb) < 1e-6;
    }
    return a === b;
  };
  const needsReset =
    client.lastSetupRuleset !== rulesValue ||
    !sameKomi(client.lastSetupKomi, komi) ||
    !Array.isArray(client.positionMoves);

  const isSameMove = (a, b) => {
    if (!a || !b) return false;
    if (a.pass || b.pass) return Boolean(a.pass) === Boolean(b.pass) && a.color === b.color;
    return a.color === b.color && a.x === b.x && a.y === b.y;
  };

  const isPrefix = (prefix, full) => {
    if (!Array.isArray(prefix) || !Array.isArray(full)) return false;
    if (prefix.length > full.length) return false;
    for (let i = 0; i < prefix.length; i += 1) {
      if (!isSameMove(prefix[i], full[i])) return false;
    }
    return true;
  };

  const applyMovesFrom = async (startIndex) => {
    for (let i = startIndex; i < moves.length; i += 1) {
      const move = moves[i];
      if (move.pass) {
        if (sendCommand) {
          await sendCommand(`play ${move.color} pass`, setupTimeoutMs);
        } else {
          await client.send(`play ${move.color} pass`, setupTimeoutMs);
        }
        continue;
      }
      const text = `play ${move.color} ${coordToGtp(move.x, move.y)}`;
      if (sendCommand) {
        await sendCommand(text, setupTimeoutMs);
      } else {
        await client.send(text, setupTimeoutMs);
      }
    }
  };

  if (needsReset || !isPrefix(client.positionMoves, moves)) {
    if (sendCommand) {
      await sendCommand("clear_board", setupTimeoutMs);
    } else {
      await client.send("clear_board", setupTimeoutMs);
    }
    await applyKatagoRules(client, ruleset, {
      rulesCommand,
      setupTimeoutMs,
      sendCommand,
    });
    if (sendCommand) {
      await sendCommand(`komi ${komi}`, setupTimeoutMs);
    } else {
      await client.send(`komi ${komi}`, setupTimeoutMs);
    }
    await applyMovesFrom(0);
  } else if (client.positionMoves.length < moves.length) {
    await applyMovesFrom(client.positionMoves.length);
  }

  client.positionMoves = moves;
  client.lastSetupRuleset = rulesValue;
  client.lastSetupKomi = komi;
  return true;
};

