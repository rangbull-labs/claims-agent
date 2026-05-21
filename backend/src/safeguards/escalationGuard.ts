interface TriggerRule {
  category: string;
  patterns: ReadonlyArray<string | RegExp>;
}

/**
 * Curated trigger phrases keyed by escalation category. String patterns
 * are matched case-insensitively as substrings; regex patterns are used
 * for short ambiguous tokens that need word boundaries (e.g., "sue"
 * must not fire on "issue" or "tissue").
 *
 * The list is intentionally narrow: false positives route legitimate
 * inquiries away from the agent and degrade the demo. When in doubt,
 * prefer phrase-level matches over single-word matches.
 */
const TRIGGER_RULES: ReadonlyArray<TriggerRule> = [
  {
    category: "self-harm",
    patterns: [
      "kill myself",
      "kill me",
      "end my life",
      "end it all",
      "want to die",
      "don't want to live",
      "do not want to live",
      "harm myself",
      "hurt myself",
      /\b(suicide|suicidal)\b/i,
    ],
  },
  {
    category: "legal-action",
    patterns: [
      "lawsuit",
      "litigation",
      "lawyer",
      "attorney",
      "legal action",
      "department of insurance",
      "file a complaint with the state",
      /\b(sue|sued|suing)\b/i,
    ],
  },
  {
    category: "medical-advice",
    patterns: [
      "diagnose me",
      "what's my diagnosis",
      "what is my diagnosis",
      "should i take",
      "is it safe to take",
      "what medication should",
      "medical advice",
      "should i go to the er",
      "should i see a doctor",
      "is this serious",
      "is this normal",
    ],
  },
  {
    category: "employee-complaint",
    patterns: [
      "your rep was rude",
      "your representative was rude",
      "the rep was rude",
      "agent was rude",
      "file a complaint about",
      "complaint against your",
      "report your employee",
    ],
  },
  {
    category: "serious-illness",
    patterns: [
      "i am dying",
      "i'm dying",
      "i am going to die",
      "terminally ill",
      "terminal illness",
      "stage 4 cancer",
      "stage iv cancer",
      "hospice care",
    ],
  },
];

/**
 * Deterministic pre-agent escalation check. Examines `inquiry` against a
 * curated list of trigger phrases keyed by category. Returns the first
 * matching category as the escalation reason; returns
 * `{ escalate: false, reason: null }` if no rule fires.
 *
 * This function does NOT call the model. It is the first layer of the
 * safeguard stack (Section 5 of the design doc) and runs before
 * `runAgent` invokes anything else, so a `kill myself` or `I want to
 * sue` inquiry never reaches the LLM.
 *
 * Returning the matched category (not a verbose reason string) keeps
 * the audit field stable and indexable across the eval suite.
 */
export function shouldEscalate(
  inquiry: string,
): { escalate: boolean; reason: string | null } {
  const normalized = inquiry.toLowerCase();
  for (const rule of TRIGGER_RULES) {
    for (const pattern of rule.patterns) {
      const matched =
        pattern instanceof RegExp
          ? pattern.test(inquiry)
          : normalized.includes(pattern.toLowerCase());
      if (matched) {
        return { escalate: true, reason: rule.category };
      }
    }
  }
  return { escalate: false, reason: null };
}
