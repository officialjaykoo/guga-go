import * as nativeStyle from "./aiStyle_n4tive.js";
import * as ganghandolStyle from "./aiStyle_ganghandol_heuristic.js";

const STYLE_KEY = String(process.env.AI_STYLE_MODE || "native")
  .trim()
  .toLowerCase();

const STYLE_MAP = {
  native: nativeStyle,
  n4tive: nativeStyle,
  pure: nativeStyle,
  ganghandol: ganghandolStyle,
};

const ACTIVE_STYLE = STYLE_MAP[STYLE_KEY] || ganghandolStyle;

export const AI_STYLE_NAME = ACTIVE_STYLE.AI_STYLE_NAME || STYLE_KEY;
export const pickOpeningMove =
  ACTIVE_STYLE.pickOpeningMove || (() => null);
export const pickStyleOverrideMove =
  ACTIVE_STYLE.pickStyleOverrideMove || (() => null);
export const pickStyleFallbackMove =
  ACTIVE_STYLE.pickStyleFallbackMove || (() => null);

