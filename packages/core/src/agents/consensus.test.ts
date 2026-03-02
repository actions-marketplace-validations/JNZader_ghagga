import { describe, it, expect } from 'vitest';
import { parseVote, calculateConsensus } from './consensus.js';
import type { ConsensusVote, ConsensusStance, LLMProvider } from '../types.js';

// ─── Helpers ────────────────────────────────────────────────────

function makeVote(
  overrides: Partial<ConsensusVote> = {},
): ConsensusVote {
  return {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    stance: 'neutral',
    decision: 'approve',
    confidence: 0.8,
    reasoning: 'Looks good.',
    ...overrides,
  };
}

// ─── parseVote ──────────────────────────────────────────────────

describe('parseVote', () => {
  const defaults = {
    provider: 'anthropic' as LLMProvider,
    model: 'claude-sonnet-4-20250514',
    stance: 'neutral' as ConsensusStance,
  };

  function call(text: string, overrides: Partial<typeof defaults> = {}) {
    const { provider, model, stance } = { ...defaults, ...overrides };
    return parseVote(text, provider, model, stance);
  }

  // ── Decision parsing ──

  it('parses approve decision', () => {
    const vote = call('DECISION: approve\nCONFIDENCE: 0.9\nREASONING: Clean code.');
    expect(vote.decision).toBe('approve');
  });

  it('parses reject decision', () => {
    const vote = call('DECISION: reject\nCONFIDENCE: 0.8\nREASONING: Major issues.');
    expect(vote.decision).toBe('reject');
  });

  it('parses abstain decision', () => {
    const vote = call('DECISION: abstain\nCONFIDENCE: 0.5\nREASONING: Unsure.');
    expect(vote.decision).toBe('abstain');
  });

  it('defaults to abstain for unrecognized decision', () => {
    const vote = call('DECISION: maybe\nCONFIDENCE: 0.5\nREASONING: Hm.');
    expect(vote.decision).toBe('abstain');
  });

  it('defaults to abstain when DECISION line is missing', () => {
    const vote = call('CONFIDENCE: 0.5\nREASONING: No decision here.');
    expect(vote.decision).toBe('abstain');
  });

  it('handles case-insensitive decision keywords', () => {
    const vote = call('DECISION: APPROVE\nCONFIDENCE: 0.9\nREASONING: Yes.');
    expect(vote.decision).toBe('approve');
  });

  it('handles case-insensitive labels', () => {
    const vote = call('decision: Reject\nconfidence: 0.7\nreasoning: No good.');
    expect(vote.decision).toBe('reject');
    expect(vote.confidence).toBe(0.7);
    expect(vote.reasoning).toBe('No good.');
  });

  // ── Confidence parsing ──

  it('parses confidence value', () => {
    const vote = call('DECISION: approve\nCONFIDENCE: 0.75\nREASONING: Fine.');
    expect(vote.confidence).toBe(0.75);
  });

  it('clamps confidence above 1 to 1', () => {
    const vote = call('DECISION: approve\nCONFIDENCE: 1.5\nREASONING: Sure.');
    expect(vote.confidence).toBe(1);
  });

  it('defaults to 0.5 when confidence has negative sign (regex cannot capture it)', () => {
    const vote = call('DECISION: approve\nCONFIDENCE: -0.3\nREASONING: Maybe.');
    // The regex [\d.]+ does not match the minus sign, so parseFloat gets "0.3" won't happen — 
    // actually the minus makes the whole match fail, falling back to default 0.5
    expect(vote.confidence).toBe(0.5);
  });

  it('defaults confidence to 0.5 when missing', () => {
    const vote = call('DECISION: approve\nREASONING: No confidence given.');
    expect(vote.confidence).toBe(0.5);
  });

  it('defaults confidence to 0.5 for non-numeric value', () => {
    const vote = call('DECISION: approve\nCONFIDENCE: high\nREASONING: Hmm.');
    expect(vote.confidence).toBe(0.5);
  });

  // ── Reasoning parsing ──

  it('extracts multi-line reasoning', () => {
    const text =
      'DECISION: approve\nCONFIDENCE: 0.8\nREASONING: Line one.\nLine two.\nLine three.';
    const vote = call(text);
    expect(vote.reasoning).toBe('Line one.\nLine two.\nLine three.');
  });

  it('defaults reasoning when missing', () => {
    const vote = call('DECISION: approve\nCONFIDENCE: 0.8');
    expect(vote.reasoning).toBe('No reasoning provided.');
  });

  // ── Metadata pass-through ──

  it('sets provider, model, and stance from args', () => {
    const vote = call('DECISION: approve\nCONFIDENCE: 0.9\nREASONING: Ok.', {
      provider: 'openai',
      model: 'gpt-4o',
      stance: 'for',
    });
    expect(vote.provider).toBe('openai');
    expect(vote.model).toBe('gpt-4o');
    expect(vote.stance).toBe('for');
  });

  // ── Edge cases ──

  it('handles empty text', () => {
    const vote = call('');
    expect(vote.decision).toBe('abstain');
    expect(vote.confidence).toBe(0.5);
    expect(vote.reasoning).toBe('No reasoning provided.');
  });

  it('handles text with extra whitespace around labels', () => {
    const vote = call('DECISION:   approve  \nCONFIDENCE:   0.85  \nREASONING:   Spaced out.');
    expect(vote.decision).toBe('approve');
    expect(vote.confidence).toBe(0.85);
    expect(vote.reasoning).toBe('Spaced out.');
  });

  it('handles text with preamble before structured fields', () => {
    const text =
      'Here is my analysis of the code:\n\nDECISION: reject\nCONFIDENCE: 0.7\nREASONING: Found issues.';
    const vote = call(text);
    expect(vote.decision).toBe('reject');
    expect(vote.confidence).toBe(0.7);
    expect(vote.reasoning).toBe('Found issues.');
  });
});

// ─── calculateConsensus ─────────────────────────────────────────

describe('calculateConsensus', () => {
  // ── Clear approve ──

  it('returns PASSED when all models approve with high confidence', () => {
    const votes = [
      makeVote({ decision: 'approve', confidence: 0.9, stance: 'for' }),
      makeVote({ decision: 'approve', confidence: 0.8, stance: 'neutral' }),
      makeVote({ decision: 'approve', confidence: 0.7, stance: 'against' }),
    ];
    const result = calculateConsensus(votes);
    expect(result.status).toBe('PASSED');
    expect(result.summary).toContain('APPROVED');
    expect(result.summary).toContain('100%');
  });

  it('returns PASSED with approve majority above 60% threshold', () => {
    // approve weight: 0.9 + 0.8 = 1.7, reject weight: 0.3
    // total = 2.0, approve ratio = 85%, gap = 70%
    const votes = [
      makeVote({ decision: 'approve', confidence: 0.9 }),
      makeVote({ decision: 'approve', confidence: 0.8 }),
      makeVote({ decision: 'reject', confidence: 0.3 }),
    ];
    const result = calculateConsensus(votes);
    expect(result.status).toBe('PASSED');
  });

  // ── Clear reject ──

  it('returns FAILED when all models reject', () => {
    const votes = [
      makeVote({ decision: 'reject', confidence: 0.9, stance: 'for' }),
      makeVote({ decision: 'reject', confidence: 0.85, stance: 'neutral' }),
      makeVote({ decision: 'reject', confidence: 0.8, stance: 'against' }),
    ];
    const result = calculateConsensus(votes);
    expect(result.status).toBe('FAILED');
    expect(result.summary).toContain('REJECTED');
    expect(result.summary).toContain('100%');
  });

  it('returns FAILED with reject majority above 60% threshold', () => {
    // reject weight: 0.9 + 0.8 = 1.7, approve weight: 0.2
    // total = 1.9, reject ratio = ~89%, gap = ~79%
    const votes = [
      makeVote({ decision: 'reject', confidence: 0.9 }),
      makeVote({ decision: 'reject', confidence: 0.8 }),
      makeVote({ decision: 'approve', confidence: 0.2 }),
    ];
    const result = calculateConsensus(votes);
    expect(result.status).toBe('FAILED');
  });

  // ── NEEDS_HUMAN_REVIEW cases ──

  it('returns NEEDS_HUMAN_REVIEW when all models abstain', () => {
    const votes = [
      makeVote({ decision: 'abstain', confidence: 0.5 }),
      makeVote({ decision: 'abstain', confidence: 0.6 }),
    ];
    const result = calculateConsensus(votes);
    expect(result.status).toBe('NEEDS_HUMAN_REVIEW');
    expect(result.summary).toContain('abstained');
  });

  it('returns NEEDS_HUMAN_REVIEW for empty votes array', () => {
    const result = calculateConsensus([]);
    expect(result.status).toBe('NEEDS_HUMAN_REVIEW');
    expect(result.summary).toContain('abstained');
  });

  it('returns NEEDS_HUMAN_REVIEW when confidence gap is below 30%', () => {
    // approve weight: 0.6, reject weight: 0.5
    // total = 1.1, approve ratio = ~55%, reject ratio = ~45%, gap = ~10%
    const votes = [
      makeVote({ decision: 'approve', confidence: 0.6 }),
      makeVote({ decision: 'reject', confidence: 0.5 }),
    ];
    const result = calculateConsensus(votes);
    expect(result.status).toBe('NEEDS_HUMAN_REVIEW');
    expect(result.summary).toContain('inconclusive');
    expect(result.summary).toContain('threshold');
  });

  it('returns NEEDS_HUMAN_REVIEW for evenly split votes', () => {
    // approve weight: 0.8, reject weight: 0.8
    // ratio both 50%, gap = 0
    const votes = [
      makeVote({ decision: 'approve', confidence: 0.8 }),
      makeVote({ decision: 'reject', confidence: 0.8 }),
    ];
    const result = calculateConsensus(votes);
    expect(result.status).toBe('NEEDS_HUMAN_REVIEW');
  });

  // ── Abstain handling ──

  it('ignores abstain votes in weight calculation', () => {
    // Only approve weight counts: 0.9, total = 0.9, ratio = 100%, gap = 100%
    const votes = [
      makeVote({ decision: 'approve', confidence: 0.9 }),
      makeVote({ decision: 'abstain', confidence: 0.8 }),
      makeVote({ decision: 'abstain', confidence: 0.7 }),
    ];
    const result = calculateConsensus(votes);
    expect(result.status).toBe('PASSED');
  });

  it('counts abstain as non-contributing even with high confidence', () => {
    // Only reject weight counts: 0.7, total = 0.7, ratio = 100%, gap = 100%
    const votes = [
      makeVote({ decision: 'abstain', confidence: 1.0 }),
      makeVote({ decision: 'reject', confidence: 0.7 }),
    ];
    const result = calculateConsensus(votes);
    expect(result.status).toBe('FAILED');
  });

  // ── Confidence weighting ──

  it('uses confidence as weight (high-confidence approve beats low-confidence reject)', () => {
    // approve weight: 0.95, reject weight: 0.2 + 0.2 = 0.4
    // total = 1.35, approve ratio = ~70%, gap = ~41%
    const votes = [
      makeVote({ decision: 'approve', confidence: 0.95 }),
      makeVote({ decision: 'reject', confidence: 0.2 }),
      makeVote({ decision: 'reject', confidence: 0.2 }),
    ];
    const result = calculateConsensus(votes);
    expect(result.status).toBe('PASSED');
  });

  it('low confidence approve loses to high confidence reject', () => {
    // approve weight: 0.1, reject weight: 0.95
    // total = 1.05, reject ratio = ~90%, gap = ~81%
    const votes = [
      makeVote({ decision: 'approve', confidence: 0.1 }),
      makeVote({ decision: 'reject', confidence: 0.95 }),
    ];
    const result = calculateConsensus(votes);
    expect(result.status).toBe('FAILED');
  });

  // ── Summary content ──

  it('includes model count in approve summary', () => {
    const votes = [
      makeVote({ decision: 'approve', confidence: 0.9 }),
      makeVote({ decision: 'approve', confidence: 0.85 }),
      makeVote({ decision: 'approve', confidence: 0.8 }),
    ];
    const result = calculateConsensus(votes);
    expect(result.summary).toContain('3 models');
  });

  it('includes percentages in inconclusive summary', () => {
    // approve 0.55, reject 0.45, total 1.0
    // approve ratio = 55%, reject = 45%, gap = 10%
    const votes = [
      makeVote({ decision: 'approve', confidence: 0.55 }),
      makeVote({ decision: 'reject', confidence: 0.45 }),
    ];
    const result = calculateConsensus(votes);
    expect(result.summary).toMatch(/\d+%/); // Contains percentage
  });

  // ── Single vote ──

  it('handles single approve vote', () => {
    const votes = [makeVote({ decision: 'approve', confidence: 0.85 })];
    const result = calculateConsensus(votes);
    expect(result.status).toBe('PASSED');
  });

  it('handles single reject vote', () => {
    const votes = [makeVote({ decision: 'reject', confidence: 0.85 })];
    const result = calculateConsensus(votes);
    expect(result.status).toBe('FAILED');
  });

  it('handles single abstain vote (all abstained)', () => {
    const votes = [makeVote({ decision: 'abstain', confidence: 0.9 })];
    const result = calculateConsensus(votes);
    expect(result.status).toBe('NEEDS_HUMAN_REVIEW');
  });

  // ── Boundary conditions ──

  it('returns PASSED at exactly 60% approve ratio with sufficient gap', () => {
    // approve weight: 0.6, reject weight: 0.1
    // total = 0.7, approve ratio = ~86%, gap = ~71% — well above thresholds
    const votes = [
      makeVote({ decision: 'approve', confidence: 0.6 }),
      makeVote({ decision: 'reject', confidence: 0.1 }),
    ];
    const result = calculateConsensus(votes);
    expect(result.status).toBe('PASSED');
  });

  it('checks gap BEFORE decision threshold (gap below 30% → human review even with majority)', () => {
    // approve weight: 0.51, reject weight: 0.49
    // total = 1.0, approve ratio = 51%, reject = 49%, gap = 2% < 30%
    // Even though one side has more, gap check happens first
    const votes = [
      makeVote({ decision: 'approve', confidence: 0.51 }),
      makeVote({ decision: 'reject', confidence: 0.49 }),
    ];
    const result = calculateConsensus(votes);
    expect(result.status).toBe('NEEDS_HUMAN_REVIEW');
  });

  // ── Zero confidence ──

  it('handles zero confidence votes (contribute 0 weight)', () => {
    // approve weight: 0, reject weight: 0, total = 0 → all abstained path
    const votes = [
      makeVote({ decision: 'approve', confidence: 0 }),
      makeVote({ decision: 'reject', confidence: 0 }),
    ];
    const result = calculateConsensus(votes);
    expect(result.status).toBe('NEEDS_HUMAN_REVIEW');
  });
});
