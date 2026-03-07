/**
 * TUI facade — thin wrapper over @clack/prompts.
 *
 * Commands import from this module only (Design AD1).
 * The mode is resolved once at init() and never changes (R2).
 * In plain mode, all calls delegate to console.* with zero ANSI (R8, R10).
 */

import * as clack from '@clack/prompts';

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
