import test from "node:test";
import assert from "node:assert/strict";
import { retrieveRelevantMemories, formatMemoryContext } from "./memory-retrieval.ts";

const memories = [
  { id: "m1", category: "technical", title: "Maya repository architecture", content: "Maya uses TypeScript, a task orchestrator, approval ledger and a file-backed task repository." },
  { id: "m2", category: "business", title: "Hotel GUDIYA pricing", content: "Three rooms with two different nightly rates and local hospitality operations." },
  { id: "m3", category: "design", title: "Dashboard visual style", content: "Dark navy interface with electric blue accents and responsive cards." },
];

test("retrieves relevant notes using title, category, and content relevance", () => {
  const results = retrieveRelevantMemories("Maya task orchestrator approval ledger", memories);
  assert.equal(results[0].id, "m1");
  assert.ok(results[0].score > results[1]?.score || results.length === 1);
});

test("returns no unrelated notes and handles stop-word-only queries", () => {
  assert.deepEqual(retrieveRelevantMemories("the and what is", memories), []);
  assert.deepEqual(retrieveRelevantMemories("astrology horoscope", memories), []);
});

test("bounds result count and excerpt length", () => {
  const long = [{ id: "long", category: "notes", title: "Long note", content: "keyword ".repeat(1000) }];
  const result = retrieveRelevantMemories("keyword", long, { limit: 99, maxExcerptChars: 120 });
  assert.equal(result.length, 1);
  assert.ok(result[0].excerpt.length <= 121);
});

test("formats retrieved notes as data rather than executable instructions", () => {
  const context = formatMemoryContext(retrieveRelevantMemories("hotel pricing", memories));
  assert.match(context, /Hotel GUDIYA pricing/);
  assert.doesNotMatch(context, /<script>/i);
});
