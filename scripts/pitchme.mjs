#!/usr/bin/env node
// Helper for the Pitch.me skill. Plain Node, no dependencies, no network.
//
//   node pitchme.mjs init <project name> [--readme <file>]
//       Create a session folder under ./.pitchme/ and copy the README into it.
//
//   node pitchme.mjs score <session folder>
//       Check the six first reads and the debate, then print the computed
//       overall score. The Chair needs that number before writing the verdict.
//
//   node pitchme.mjs render <session folder> [--sequential] [--out <file>] [--no-open]
//       Check everything, write the pixel-boardroom replay (one HTML file) and
//       open it in the default browser.
//
// It only reads the session folder and this skill's own files, and only
// writes inside the session folder (or to --out).

import { spawn } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SEATS = ["ceo", "cto", "cfo", "cmo", "hr", "user"];
const SPEAKERS = [...SEATS, "chair"];
const PLACEHOLDER = "__PITCHME_SESSION__";

/* ── Scoring ──────────────────────────────────────────────────
   Kept identical to the Pitch.me site (src/lib/board/rules.ts);
   the build of this skill fails if the two ever disagree. */

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const halfStep = (n) => Math.round(clamp(n, 0, 10) * 2) / 2;

function labelFor(score) {
  if (score >= 80) return "FUND IT";
  if (score >= 65) return "PROMISING";
  if (score >= 50) return "NEEDS WORK";
  if (score >= 35) return "PIVOT";
  return "PASS";
}

export function computeScore(takes, revisions = []) {
  const scores = {};
  for (const take of takes) scores[take.role] = halfStep(take.score);
  const applied = [];
  for (const rev of revisions) {
    const from = scores[rev.role];
    if (from == null) continue;
    // Nobody swings more than two points in the debate.
    const to = halfStep(clamp(rev.newScore, from - 2, from + 2));
    if (to === from) continue;
    scores[rev.role] = to;
    applied.push({ role: rev.role, from, to, reason: rev.reason });
  }
  const mean = SEATS.reduce((sum, id) => sum + scores[id], 0) / SEATS.length;
  const score = Math.round(mean * 10);
  return { score, label: labelFor(score), scores, revisions: applied };
}

/* ── Reading and checking a session folder ────────────────── */

class Checker {
  constructor(dir) {
    this.dir = dir;
    this.problems = [];
  }

  fail(file, message) {
    this.problems.push(`${file}: ${message}`);
  }

  text(file, { min = 1 } = {}) {
    const full = path.join(this.dir, file);
    if (!existsSync(full)) return this.fail(file, "missing"), null;
    const text = readFileSync(full, "utf8").trim();
    if (text.length < min) {
      this.fail(file, min > 1 ? `too short (${text.length} characters, need at least ${min})` : "empty");
      return null;
    }
    return text;
  }

  json(file) {
    const full = path.join(this.dir, file);
    if (!existsSync(full)) return this.fail(file, "missing"), null;
    try {
      const value = JSON.parse(readFileSync(full, "utf8"));
      if (value && typeof value === "object") return value;
      this.fail(file, "must be a JSON object");
    } catch (err) {
      this.fail(file, `not valid JSON (${err.message})`);
    }
    return null;
  }

  /** A non-empty string, optionally capped so it fits its place in the replay. */
  str(file, obj, key, { max, optional = false } = {}) {
    const value = obj?.[key];
    if (value == null || value === "") {
      if (!optional) this.fail(file, `"${key}" is missing`);
      return;
    }
    if (typeof value !== "string") return this.fail(file, `"${key}" must be text`);
    if (max && value.length > max) {
      this.fail(file, `"${key}" is ${value.length} characters; it has to fit in ${max}`);
    }
  }

  num(file, obj, key, lo, hi) {
    const value = obj?.[key];
    if (typeof value !== "number" || Number.isNaN(value)) {
      return this.fail(file, `"${key}" must be a number`);
    }
    if (value < lo || value > hi) this.fail(file, `"${key}" is ${value}; it must be between ${lo} and ${hi}`);
  }

  oneOf(file, obj, key, allowed, { optional = false } = {}) {
    const value = obj?.[key];
    if (value == null && optional) return;
    if (!allowed.includes(value)) {
      this.fail(file, `"${key}" must be one of: ${allowed.join(", ")}`);
    }
  }

  list(file, obj, key, { min = 0, max = Infinity } = {}) {
    const value = obj?.[key];
    if (!Array.isArray(value)) return this.fail(file, `"${key}" must be a list`), [];
    if (value.length < min || value.length > max) {
      const range = max === Infinity ? `at least ${min}` : `${min} to ${max}`;
      this.fail(file, `"${key}" has ${value.length} items; it needs ${range}`);
    }
    return value;
  }

  strings(file, obj, key, range) {
    for (const item of this.list(file, obj, key, range)) {
      if (typeof item !== "string" || !item.trim()) {
        this.fail(file, `every item in "${key}" must be a line of text`);
        break;
      }
    }
  }
}

function checkPitch(c) {
  const pitch = c.json("pitch.json");
  if (pitch) {
    c.str("pitch.json", pitch, "name", { max: 60 });
    c.str("pitch.json", pitch, "tagline", { max: 140 });
    for (const key of ["demoUrl", "category", "stage", "founder"]) {
      c.str("pitch.json", pitch, key, { optional: true });
    }
    if (pitch.demoUrl && !/^https?:\/\//i.test(pitch.demoUrl)) {
      c.fail("pitch.json", '"demoUrl" must start with http:// or https:// (or be left empty)');
    }
  }
  const readme = c.text("readme.md", { min: 200 });
  return pitch && readme ? { ...pitch, demoUrl: pitch.demoUrl ?? "", readme } : null;
}

function checkResearch(c) {
  const text = c.text("brief.md");
  const research = c.json("research.json");
  if (research) {
    if (typeof research.grounded !== "boolean") {
      c.fail("research.json", '"grounded" must be true (web research was done) or false');
    }
    for (const source of c.list("research.json", research, "sources")) {
      if (typeof source?.title !== "string" || typeof source?.url !== "string") {
        c.fail("research.json", 'every source needs a "title" and a "url"');
        break;
      }
    }
    if (research.log != null) c.strings("research.json", research, "log");
  }
  if (!text || !research) return null;
  return {
    brief: { text, sources: research.sources ?? [], grounded: research.grounded === true },
    researchLog: research.log ?? [],
  };
}

function checkTakes(c) {
  const takes = [];
  for (const role of SEATS) {
    const file = `takes/${role}.json`;
    const take = c.json(file);
    if (!take) continue;
    c.oneOf(file, take, "stance", ["bullish", "cautious", "bearish"]);
    c.num(file, take, "score", 0, 10);
    c.str(file, take, "headline", { max: 110 });
    c.str(file, take, "say", { max: 220 });
    for (const point of c.list(file, take, "points", { min: 2, max: 4 })) {
      c.str(file, point, "text");
      c.oneOf(file, point, "confidence", ["high", "medium", "low"]);
      c.str(file, point, "source");
    }
    c.str(file, take, "recommendation");
    c.str(file, take, "keyAssumption");
    c.str(file, take, "changeMyMind");
    takes.push({ ...take, role });
  }
  return takes.length === SEATS.length ? takes : null;
}

function checkDebate(c) {
  const file = "debate.json";
  const debate = c.json(file);
  if (!debate) return null;
  const critique = debate.critique;
  if (!critique || typeof critique !== "object") {
    c.fail(file, '"critique" is missing');
  } else {
    c.oneOf(file, critique, "consensus", ["genuine", "suspicious", "split"]);
    c.str(file, critique, "uncomfortableTruth");
    c.strings(file, critique, "unvalidatedAssumptions", { min: 1, max: 3 });
    c.strings(file, critique, "missingVoices", { max: 3 });
  }
  const turns = c.list(file, debate, "turns", { min: 6, max: 14 });
  for (const turn of turns) {
    c.oneOf(file, turn, "speaker", SPEAKERS);
    c.oneOf(file, turn, "to", [...SPEAKERS, "all"], { optional: true });
    c.str(file, turn, "text", { max: 260 });
  }
  if (turns.length && turns[0]?.speaker !== "chair") c.fail(file, "the Chair opens the cross-examination");
  const silent = SEATS.filter((role) => !turns.some((t) => t?.speaker === role));
  if (turns.length && silent.length) c.fail(file, `every seat speaks at least once; missing: ${silent.join(", ")}`);
  for (const rev of c.list(file, debate, "revisions")) {
    c.oneOf(file, rev, "role", SEATS);
    c.num(file, rev, "newScore", 0, 10);
    c.str(file, rev, "reason");
  }
  return debate;
}

function checkVerdict(c) {
  const file = "verdict.json";
  const v = c.json(file);
  if (!v) return null;
  c.str(file, v, "headline", { max: 260 });
  c.str(file, v, "summary");
  if (!v.survival || typeof v.survival !== "object") c.fail(file, '"survival" is missing');
  else {
    c.num(file, v.survival, "oneYear", 0, 100);
    c.num(file, v.survival, "threeYear", 0, 100);
    c.str(file, v.survival, "reasoning");
  }
  if (!v.worth || typeof v.worth !== "object") c.fail(file, '"worth" is missing');
  else {
    c.num(file, v.worth, "lowUsd", 0, 1e13);
    c.num(file, v.worth, "highUsd", 0, 1e13);
    c.str(file, v.worth, "basis");
  }
  if (!v.market || typeof v.market !== "object") c.fail(file, '"market" is missing');
  else {
    c.str(file, v.market, "size");
    c.str(file, v.market, "trend");
    for (const rival of c.list(file, v.market, "competitors", { max: 5 })) {
      c.str(file, rival, "name");
      c.str(file, rival, "note");
    }
  }
  c.strings(file, v, "strengths", { min: 1, max: 4 });
  c.strings(file, v, "risks", { min: 1, max: 4 });
  c.strings(file, v, "agree", { min: 1, max: 3 });
  for (const split of c.list(file, v, "disagree", { max: 3 })) {
    c.str(file, split, "topic");
    c.str(file, split, "sides");
  }
  for (const action of c.list(file, v, "actions", { min: 1, max: 5 })) {
    c.str(file, action, "action");
    c.oneOf(file, action, "owner", SEATS);
    c.str(file, action, "when");
  }
  return v;
}

function stopIfBroken(c) {
  if (!c.problems.length) return;
  console.error(`Not ready. Fix these in ${c.dir} and run the command again:\n`);
  for (const problem of c.problems) console.error(`  - ${problem}`);
  process.exit(1);
}

function describe(result) {
  const seats = SEATS.map((id) => `${id.toUpperCase()} ${result.scores[id]}`).join(", ");
  const lines = [`Overall: ${result.score}/100 (${result.label})`, `Final seat scores: ${seats}`];
  if (result.revisions.length) {
    const moves = result.revisions.map((r) => `${r.role.toUpperCase()} ${r.from} -> ${r.to}`).join(", ");
    lines.push(`Score changes from the debate: ${moves}`);
  }
  return lines.join("\n");
}

/* ── Commands ─────────────────────────────────────────────── */

function slugOf(name) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return slug || "pitch";
}

function init(args) {
  const name = args.positional.join(" ").trim();
  if (!name) usage('Give the project a name: init "My Project"');
  const base = path.resolve(".pitchme");
  const dir = path.join(base, slugOf(name));
  mkdirSync(path.join(dir, "takes"), { recursive: true });

  // Keep sessions out of version control unless the founder decides otherwise.
  const ignore = path.join(base, ".gitignore");
  if (!existsSync(ignore)) writeFileSync(ignore, "*\n");

  const pitchFile = path.join(dir, "pitch.json");
  if (!existsSync(pitchFile)) {
    const blank = { name, tagline: "", demoUrl: "", category: "", stage: "", founder: "" };
    writeFileSync(pitchFile, `${JSON.stringify(blank, null, 2)}\n`);
  }

  const readme = args.flags.readme ?? ["README.md", "readme.md", "Readme.md"].find((f) => existsSync(f));
  const target = path.join(dir, "readme.md");
  if (readme && existsSync(readme) && !existsSync(target)) copyFileSync(readme, target);

  console.log(`Session folder: ${dir}`);
  console.log(existsSync(target) ? `README copied from ${readme}.` : "No README found: write the pitch into readme.md yourself.");
  console.log("Fill in pitch.json, then brief.md, research.json, takes/<seat>.json, debate.json and verdict.json.");
}

function score(args) {
  const dir = sessionDir(args);
  const c = new Checker(dir);
  checkPitch(c);
  checkResearch(c);
  const takes = checkTakes(c);
  const debate = checkDebate(c);
  stopIfBroken(c);
  console.log(describe(computeScore(takes, debate.revisions)));
  console.log("\nWrite verdict.json so that it is consistent with this score and label, then run render.");
}

function render(args) {
  const dir = sessionDir(args);
  const c = new Checker(dir);
  const pitch = checkPitch(c);
  const research = checkResearch(c);
  const takes = checkTakes(c);
  const debate = checkDebate(c);
  const verdict = checkVerdict(c);
  stopIfBroken(c);

  const session = {
    pitch,
    ...research,
    takes,
    debate,
    verdict,
    meta: {
      ranAt: new Date().toISOString(),
      isolation: args.flags.sequential ? "sequential" : "subagents",
    },
  };

  const templateFile = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "assets", "boardroom.html");
  const template = readFileSync(templateFile, "utf8");
  if (!template.includes(PLACEHOLDER)) {
    console.error(`The replay template at ${templateFile} is damaged. Reinstall the skill.`);
    process.exit(1);
  }
  // "<" is escaped so nothing in the README can close the script tag it sits in.
  const data = JSON.stringify(session).replace(/</g, "\\u003c");
  const out = path.resolve(args.flags.out ?? path.join(dir, "boardroom.html"));
  writeFileSync(out, template.replace(PLACEHOLDER, () => data));

  console.log(describe(computeScore(takes, debate.revisions)));
  console.log(`\nReplay written to ${out}`);
  if (!args.flags["no-open"]) open(out);
}

function open(file) {
  const [command, params] =
    process.platform === "darwin"
      ? ["open", [file]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", file]]
        : ["xdg-open", [file]];
  try {
    spawn(command, params, { stdio: "ignore", detached: true }).on("error", () => {}).unref();
  } catch {
    // No browser to hand it to; the path was already printed.
  }
}

function sessionDir(args) {
  const dir = args.positional[0];
  if (!dir) usage("Give the session folder, for example: .pitchme/my-project");
  if (!existsSync(dir)) usage(`No such folder: ${dir}`);
  return path.resolve(dir);
}

function usage(message) {
  if (message) console.error(`${message}\n`);
  console.error(
    [
      "Usage:",
      '  node pitchme.mjs init "<project name>" [--readme <file>]',
      "  node pitchme.mjs score <session folder>",
      "  node pitchme.mjs render <session folder> [--sequential] [--out <file>] [--no-open]",
    ].join("\n"),
  );
  process.exit(message ? 1 : 0);
}

function parse(argv) {
  const positional = [];
  const flags = {};
  const takesValue = new Set(["readme", "out"]);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) positional.push(arg);
    else if (takesValue.has(arg.slice(2))) flags[arg.slice(2)] = argv[++i];
    else flags[arg.slice(2)] = true;
  }
  return { positional, flags };
}

function main() {
  const [command, ...rest] = process.argv.slice(2);
  const args = parse(rest);
  if (command === "init") init(args);
  else if (command === "score") score(args);
  else if (command === "render") render(args);
  else usage(command ? `Unknown command: ${command}` : "");
}

// Run only when executed directly, so the build can import computeScore.
if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) main();
