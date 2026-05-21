import { strict as assert } from "node:assert";
import { test } from "node:test";

import { shouldEscalate } from "./escalationGuard.js";

// --- ESCALATION CASES ---

test("escalates on lawsuit threats (legal-action)", () => {
  const result = shouldEscalate("I want to sue you for denying my claim");
  assert.equal(result.escalate, true);
  assert.equal(result.reason, "legal-action");
});

test("escalates on medical-advice requests", () => {
  const result = shouldEscalate("Should I go to the ER for chest pain?");
  assert.equal(result.escalate, true);
  assert.equal(result.reason, "medical-advice");
});

test("escalates on self-harm language", () => {
  const result = shouldEscalate(
    "I'm so frustrated I want to end my life over this denial",
  );
  assert.equal(result.escalate, true);
  assert.equal(result.reason, "self-harm");
});

test("escalates on serious-illness signals", () => {
  const result = shouldEscalate(
    "I am dying and need to understand my hospice coverage",
  );
  assert.equal(result.escalate, true);
  assert.equal(result.reason, "serious-illness");
});

// --- NON-ESCALATION CASES ---

test("does not escalate on routine claim-status questions", () => {
  const result = shouldEscalate("Why was claim C-0001 denied?");
  assert.equal(result.escalate, false);
  assert.equal(result.reason, null);
});

test("does not escalate on deductible/EOB questions", () => {
  const result = shouldEscalate("What's my annual deductible and out-of-pocket max?");
  assert.equal(result.escalate, false);
});

test("does not escalate on legitimate diagnosis-code questions", () => {
  // Asks about a code on the claim, not for medical advice. The phrase
  // "what is my diagnosis" would trigger; this wording must not.
  const result = shouldEscalate("Can you explain the diagnosis code on my MRI claim?");
  assert.equal(result.escalate, false);
});

// --- NEAR-MISS GUARDS ---

test("does not false-fire on 'issue' (word boundary around 'sue')", () => {
  // Substring "sue" appears inside "issue"; the legal-action regex uses
  // word boundaries so this must not escalate.
  const result = shouldEscalate("I have an issue with my claim");
  assert.equal(result.escalate, false);
});

test("does not false-fire on 'file a claim' (only 'file a complaint' should match)", () => {
  const result = shouldEscalate("How do I file a claim for an out-of-state visit?");
  assert.equal(result.escalate, false);
});
