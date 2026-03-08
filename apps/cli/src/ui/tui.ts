/**
 * TUI facade — thin wrapper over @clack/prompts.
 *
 * Commands import from this module only (Design AD1).
 * The mode is resolved once at init() and never changes (R2).
 * In plain mode, all calls delegate to console.* with zero ANSI (R8, R10).
 */

import * as clack from '@clack/prompts';
import type { FindingSeverity } from 'ghagga-core';
import { colorSeverity } from './chalk.js';
import { BOX_CHARS, DIVIDER_CHAR } from './theme.js';

// ─── Types ──────────────────────────────────────────────────────

export type TuiMode = 'styled' | 'plain';

export interface TuiInitOptions {
  /** User explicitly passed --plain */
  plain?: boolean;
}

export interface TuiSpinner {
  /** Start the spinner with an initial message. */
  start(message?: string): void;
  /** Update the spinner's message while it's spinning. */
  message(message: string): void;
  /** Stop the spinner with a final message (shown as success). */
  stop(message?: string): void;
}

// ─── State ──────────────────────────────────────────────────────

let _plain = true; // default to plain (safe for tests / non-TTY)
let _activeSpinner: TuiSpinner | null = null;

// ─── Init ───────────────────────────────────────────────────────

/**
 * Initialize the TUI mode. Must be called once before any output.
 * Auto-detects styled vs. plain based on TTY, CI, and --plain flag.
 */
export function init(opts?: TuiInitOptions): void {
  _plain = !!opts?.plain || !process.stdout.isTTY || !!process.env.CI;
}

/** Returns true when the current mode is plain. */
export function isPlain(): boolean {
  return _plain;
}

// ─── Intro / Outro ──────────────────────────────────────────────

export function intro(title: string): void {
  if (_plain) {
    console.log(`═══ ${title} ═══`);
  } else {
    clack.intro(title);
  }
}

export function outro(message: string): void {
  if (_plain) {
    console.log(`─── ${message} ───`);
  } else {
    clack.outro(message);
  }
}

// ─── Structured Log Methods ─────────────────────────────────────

export const log = {
  info(message: string): void {
    if (_plain) {
      console.log(message);
    } else {
      clack.log.info(message);
    }
  },

  success(message: string): void {
    if (_plain) {
      console.log(message);
    } else {
      clack.log.success(message);
    }
  },

  warn(message: string): void {
    if (_plain) {
      console.log(message);
    } else {
      clack.log.warn(message);
    }
  },

  error(message: string): void {
    if (_plain) {
      console.error(message);
    } else {
      clack.log.error(message);
    }
  },

  step(message: string): void {
    if (_plain) {
      console.log(message);
    } else {
      clack.log.step(message);
    }
  },

  message(message: string): void {
    if (_plain) {
      console.log(message);
    } else {
      clack.log.message(message);
    }
  },
};

// ─── Spinner ────────────────────────────────────────────────────

/**
 * Create a spinner instance.
 * Styled: animated clack spinner.
 * Plain: no-op start/message, stop() prints the final message.
 */
export function spinner(): TuiSpinner {
  if (_plain) {
    return {
      start() {},
      message() {},
      stop(msg?: string) {
        if (msg) console.log(msg);
      },
    };
  }

  const s = clack.spinner();
  return {
    start(msg?: string) {
      s.start(msg);
    },
    message(msg: string) {
      s.message(msg);
    },
    stop(msg?: string) {
      s.stop(msg);
    },
  };
}

/**
 * Register the active spinner for progress updates.
 * Called by review.ts when creating its spinner.
 */
export function setActiveSpinner(s: TuiSpinner | null): void {
  _activeSpinner = s;
}

// ─── Severity ───────────────────────────────────────────────────

/**
 * Return severity-colored text.
 * Styled: ANSI-colored via chalk adapter.
 * Plain: "[LEVEL] text" prefix, no ANSI.
 */
export function severity(text: string, level: FindingSeverity): string {
  if (!text) return '';
  if (_plain) {
    return `[${level.toUpperCase()}] ${text}`;
  }
  return colorSeverity(text, level);
}

// ─── Box ────────────────────────────────────────────────────────

/**
 * Render a bordered box with title and content lines.
 * Styled: Unicode box-drawing (┌─ title ─┐, │ line │, └───┘).
 * Plain: "--- title ---\ncontent\n---"
 */
export function box(title: string, content: string[]): string {
  if (_plain) {
    const lines = [`--- ${title} ---`];
    for (const line of content) {
      lines.push(line);
    }
    lines.push('---');
    return lines.join('\n');
  }

  const MIN_WIDTH = 40;
  const maxContentLen = Math.max(...content.map((l) => l.length), title.length + 4, MIN_WIDTH);
  const innerWidth = maxContentLen + 2; // padding

  const top = `${BOX_CHARS.topLeft}${BOX_CHARS.horizontal} ${title} ${BOX_CHARS.horizontal.repeat(Math.max(0, innerWidth - title.length - 3))}${BOX_CHARS.topRight}`;
  const bottom = `${BOX_CHARS.bottomLeft}${BOX_CHARS.horizontal.repeat(innerWidth)}${BOX_CHARS.bottomRight}`;

  const lines = [top];
  for (const line of content) {
    lines.push(`${BOX_CHARS.vertical} ${line.padEnd(innerWidth - 2)} ${BOX_CHARS.vertical}`);
  }
  lines.push(bottom);

  return lines.join('\n');
}

// ─── Divider ────────────────────────────────────────────────────

const DIVIDER_WIDTH = 60;

/**
 * Render a section divider.
 * Styled: "──── label ────" using ─ characters (60 char width).
 * Plain: "--- label ---" or "---" if no label.
 */
export function divider(label?: string): string {
  if (_plain) {
    return label ? `--- ${label} ---` : '---';
  }

  if (!label) {
    return DIVIDER_CHAR.repeat(DIVIDER_WIDTH);
  }

  const labelStr = ` ${label} `;
  const remaining = DIVIDER_WIDTH - labelStr.length;
  const left = Math.floor(remaining / 2);
  const right = remaining - left;

  return `${DIVIDER_CHAR.repeat(left)}${labelStr}${DIVIDER_CHAR.repeat(right)}`;
}

// ─── Progress ───────────────────────────────────────────────────

/**
 * Display step progress indicator.
 * Format: "[current/total] label"
 * Styled: updates active spinner message (if set), else console.log.
 * Plain: console.log.
 */
export function progress(current: number, total: number, label: string): void {
  const msg = `[${current}/${total}] ${label}`;

  if (_plain) {
    console.log(msg);
    return;
  }

  if (_activeSpinner) {
    _activeSpinner.message(msg);
  } else {
    console.log(msg);
  }
}
