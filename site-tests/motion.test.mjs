/*
 * site-tests/motion.test.mjs (task D1-fix2)
 *
 * What it proves: nothing on the site waits on an animation to become visible.
 *   1. No @keyframes in public/styles.css starts hidden: its first frame (from / 0%, or the lowest
 *      percentage) never sets opacity below 0.5, visibility: hidden, display: none or a zero scale.
 *      Entrance animations only move things (transform), so if a browser, a hidden tab or a screenshot
 *      tool pauses or skips them, the text, menus and icons still show.
 *   2. The text and menu selectors that animate on load or on open (hero text, service-page heading,
 *      menu panel, menu items, Services dropdown, service icon) have no resting opacity below 1 and
 *      no visibility: hidden in any rule.
 *
 * When this fails: change the keyframe to animate transform only (or start it from a visible state),
 * or remove the opacity from the named rule. Then run `node site-tests/bump-asset-versions.mjs`,
 * because styles.css changed.
 *
 * Not covered here, on purpose: `.js-reveal .reveal` (scroll reveal) starts at opacity 0, but only when
 * script.js has added `.js-reveal` and reduced motion is off, and script.js reveals it; the toast and
 * hover glows are hidden until an action shows them. None of them is text that must show at rest.
 *
 * Node built-ins only. CI runs it with the other site tests: node --test site-tests/*.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CSS_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'styles.css');
const CSS = fs.readFileSync(CSS_PATH, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''); // comments out first

/** Parses a declaration block body ("a: b; c: d") into a Map of property to value. */
function parseDecls(body) {
  const decls = new Map();
  for (const d of body.split(';')) {
    const i = d.indexOf(':');
    if (i > 0) decls.set(d.slice(0, i).trim(), d.slice(i + 1).trim().replace(/\s*!important$/, ''));
  }
  return decls;
}

/**
 * Every @keyframes block as { name, frames: [{ offsets: number[], decls }] }.
 * Offsets are percentages (from = 0, to = 100). A keyframes body holds only frame blocks, so one
 * level of nested braces is enough to read it.
 */
function parseKeyframes(css) {
  const all = [];
  for (const m of css.matchAll(/@keyframes\s+([\w-]+)\s*\{((?:[^{}]*\{[^{}]*\})*)\s*\}/g)) {
    const frames = [];
    for (const f of m[2].matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const offsets = f[1].split(',').map((s) => {
        const t = s.trim().toLowerCase();
        if (t === 'from') return 0;
        if (t === 'to') return 100;
        return Number.parseFloat(t);
      });
      frames.push({ offsets, decls: parseDecls(f[2]) });
    }
    all.push({ name: m[1], frames });
  }
  return all;
}

/** Why a set of declarations would hide content, or null when it does not. */
function hidingReason(decls) {
  if (decls.has('opacity') && Number(decls.get('opacity')) < 0.5) return `opacity: ${decls.get('opacity')}`;
  if (decls.get('visibility') === 'hidden') return 'visibility: hidden';
  if (decls.get('display') === 'none') return 'display: none';
  const transform = decls.get('transform') ?? '';
  if (/scale[XY]?\(\s*0\s*[,)]/.test(transform)) return `transform: ${transform}`;
  return null;
}

const KEYFRAMES = parseKeyframes(CSS);

// Proves: every animation starts visible, so a paused or skipped animation never hides anything.
test('no @keyframes starts from a hidden state', () => {
  assert.ok(KEYFRAMES.length > 0, 'expected @keyframes in styles.css');
  const problems = [];
  for (const { name, frames } of KEYFRAMES) {
    const first = Math.min(...frames.flatMap((f) => f.offsets));
    // Only frames at the lowest offset set the first visible state; a later fade-out (ping) is fine.
    for (const frame of frames.filter((f) => f.offsets.includes(first))) {
      const reason = hidingReason(frame.decls);
      if (reason) problems.push(`@keyframes ${name} starts hidden (${first}%: ${reason})`);
    }
  }
  assert.deepEqual(problems, []);
});

// The text and menu parts that animate on load or on open. Each must be visible at rest.
const ANIMATED_TEXT = [
  '.hero-copy > *',
  '.service-hero > *',
  '.service-icon',
  '.mobile-panel',
  '.mobile-list li',
  '.nav-dropdown',
];

// Proves: the animated text and menu selectors have no hidden resting state of their own.
test('animated text and menu parts are visible at rest', () => {
  const problems = [];
  for (const m of CSS.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
    const selectors = m[1].split(',').map((s) => s.trim().replace(/\s+/g, ' '));
    const hit = selectors.filter((s) => ANIMATED_TEXT.includes(s));
    if (hit.length === 0) continue;
    const reason = hidingReason(parseDecls(m[2]));
    if (reason) problems.push(`${hit.join(', ')} { ${reason} }`);
  }
  // Each listed selector must still exist, or this test would silently check nothing.
  for (const selector of ANIMATED_TEXT) {
    assert.ok(
      [...CSS.matchAll(/([^{}@]+)\{/g)].some((m) => m[1].split(',').map((s) => s.trim().replace(/\s+/g, ' ')).includes(selector)),
      `styles.css no longer has "${selector}"; update ANIMATED_TEXT`,
    );
  }
  assert.deepEqual(problems, []);
});
