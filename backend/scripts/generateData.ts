import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Claim, ClaimStatus, DenialCode, Member } from "../src/types.js";

const SEED = 20260521;

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(SCRIPT_DIR, "..", "data");
const POLICY_DOCS_DIR = join(DATA_DIR, "policyDocs");

function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

function pickInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function pickOne<T>(rng: () => number, arr: readonly T[]): T {
  const idx = Math.floor(rng() * arr.length);
  const value = arr[idx];
  if (value === undefined) {
    throw new Error("pickOne called on empty array");
  }
  return value;
}

function shuffle<T>(arr: readonly T[], rng: () => number): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = result[i];
    const b = result[j];
    if (a === undefined || b === undefined) continue;
    result[i] = b;
    result[j] = a;
  }
  return result;
}

const NATO_PHONETIC = [
  "Alpha",
  "Bravo",
  "Charlie",
  "Delta",
  "Echo",
  "Foxtrot",
  "Golf",
  "Hotel",
  "India",
  "Juliet",
  "Kilo",
  "Lima",
  "Mike",
  "November",
  "Oscar",
  "Papa",
  "Quebec",
  "Romeo",
  "Sierra",
  "Tango",
] as const;

const CLAIMS_PER_MEMBER = [
  5, 4, 4, 3, 2, 1, 0,
  5, 4, 3, 2, 1, 1, 0,
  5, 4, 3, 2, 1, 0,
] as const;

const PROVIDERS = [
  "Synthetic Family Practice",
  "Synthetic Specialty Clinic",
  "Synthetic Emergency Center",
  "Synthetic Imaging Group",
  "Synthetic Laboratory Services",
  "Synthetic Surgical Associates",
  "Synthetic Mental Health Practice",
  "Synthetic Physical Therapy",
  "Synthetic Pharmacy Network",
  "Synthetic Urgent Care",
] as const;

const DENIAL_CODES: DenialCode[] = [
  {
    code: "SYN-DENY-001",
    category: "Coverage",
    description: "Service not covered under member's plan.",
    appealable: true,
  },
  {
    code: "SYN-DENY-002",
    category: "Coverage",
    description: "Annual benefit maximum reached for this service category.",
    appealable: false,
  },
  {
    code: "SYN-DENY-003",
    category: "Documentation",
    description: "Required medical records not submitted within the 45-day window.",
    appealable: true,
  },
  {
    code: "SYN-DENY-004",
    category: "Documentation",
    description: "Missing or invalid diagnosis code on claim submission.",
    appealable: true,
  },
  {
    code: "SYN-DENY-005",
    category: "Network",
    description: "Provider not in-network for member's plan.",
    appealable: false,
  },
  {
    code: "SYN-DENY-006",
    category: "Network",
    description: "Out-of-network referral not obtained prior to service.",
    appealable: false,
  },
  {
    code: "SYN-DENY-007",
    category: "Authorization",
    description: "Prior authorization not obtained before service was rendered.",
    appealable: true,
  },
  {
    code: "SYN-DENY-008",
    category: "Authorization",
    description: "Authorization expired before date of service.",
    appealable: true,
  },
  {
    code: "SYN-DENY-009",
    category: "Coordination of Benefits",
    description: "Other primary insurance coverage indicated; coordinate with primary payer.",
    appealable: true,
  },
  {
    code: "SYN-DENY-010",
    category: "Coordination of Benefits",
    description: "Primary payer Explanation of Benefits required to process this claim.",
    appealable: true,
  },
];

function planTypeFor(index: number): string {
  if (index < 7) return "PPO Gold";
  if (index < 14) return "PPO Silver";
  return "HMO Bronze";
}

function generateMembers(rng: () => number): Member[] {
  return NATO_PHONETIC.map((lastName, i): Member => {
    const memberId = `M-${pad(i + 1, 3)}`;
    const dobYear = pickInt(rng, 1955, 1994);
    const dobMonth = pickInt(rng, 1, 12);
    const dobDay = pickInt(rng, 1, 28);
    const dateOfBirth = `${dobYear}-${pad(dobMonth)}-${pad(dobDay)}`;

    const peYear = pickInt(rng, 2024, 2025);
    const peMonth = pickInt(rng, 1, 12);
    const peDay = pickInt(rng, 1, 28);
    const planEffectiveDate = `${peYear}-${pad(peMonth)}-${pad(peDay)}`;

    return {
      memberId,
      planType: planTypeFor(i),
      firstName: "Member",
      lastName,
      dateOfBirth,
      planEffectiveDate,
    };
  });
}

function dayOffsetToDate(baseYear: number, baseMonth: number, baseDay: number, dayOffset: number): string {
  const base = Date.UTC(baseYear, baseMonth - 1, baseDay);
  const target = new Date(base + dayOffset * 86_400_000);
  const y = target.getUTCFullYear();
  const m = target.getUTCMonth() + 1;
  const d = target.getUTCDate();
  return `${y}-${pad(m)}-${pad(d)}`;
}

function generateClaims(
  rng: () => number,
  members: readonly Member[],
  denialCodes: readonly DenialCode[],
): Claim[] {
  const totalClaims = CLAIMS_PER_MEMBER.reduce<number>((sum, n) => sum + n, 0);

  const statusPool: ClaimStatus[] = [
    ...Array<ClaimStatus>(30).fill("paid"),
    ...Array<ClaimStatus>(13).fill("denied"),
    ...Array<ClaimStatus>(7).fill("pending"),
  ];
  if (statusPool.length !== totalClaims) {
    throw new Error(`Status pool size ${statusPool.length} != totalClaims ${totalClaims}`);
  }
  const shuffledStatuses = shuffle(statusPool, rng);

  const claims: Claim[] = [];
  let claimIndex = 0;

  members.forEach((member, memberIdx) => {
    const count = CLAIMS_PER_MEMBER[memberIdx] ?? 0;
    for (let k = 0; k < count; k++) {
      const claimNumber = claimIndex + 1;
      const claimId = `C-${pad(claimNumber, 4)}`;

      // Service date between 2025-01-01 and 2026-05-20 (roughly 505 days).
      const dayOffset = pickInt(rng, 0, 505);
      const dateOfService = dayOffsetToDate(2025, 1, 1, dayOffset);

      const providerName = pickOne(rng, PROVIDERS);

      const billedAmount = pickInt(rng, 50, 3000);
      const allowedRatio = 0.5 + rng() * 0.3; // 0.5 - 0.8
      const allowedAmount = Math.round(billedAmount * allowedRatio * 100) / 100;

      const status = shuffledStatuses[claimIndex];
      if (status === undefined) {
        throw new Error(`Missing status at index ${claimIndex}`);
      }

      let memberResponsibility: number;
      if (status === "paid") {
        const memberRatio = 0.1 + rng() * 0.2; // 10-30% of allowed
        memberResponsibility = Math.round(allowedAmount * memberRatio * 100) / 100;
      } else if (status === "denied") {
        memberResponsibility = allowedAmount;
      } else {
        memberResponsibility = 0;
      }

      const base: Claim = {
        claimId,
        memberId: member.memberId,
        dateOfService,
        providerName,
        billedAmount,
        allowedAmount,
        memberResponsibility,
        status,
      };

      if (status === "denied") {
        const denial = pickOne(rng, denialCodes);
        claims.push({
          ...base,
          denialCode: denial.code,
          denialReason: denial.description,
        });
      } else {
        claims.push(base);
      }

      claimIndex++;
    }
  });

  return claims;
}

function goldPpoPolicyDoc(): string {
  return `# Synthetic Gold PPO Plan Summary

**Plan issuer:** Synthetic Health Plan Co.
**Plan year:** 2026
**Plan type:** Preferred Provider Organization (PPO), Gold tier

> This document is part of a synthetic-data demonstration. No real plan,
> insurer, member, or claim is represented. Coverage figures, denial codes,
> and contact details are fabricated.

## Cost-share at a glance

| Cost-share | In-network | Out-of-network |
| --- | --- | --- |
| Annual deductible | $500 individual / $1,000 family | $1,500 / $3,000 |
| Out-of-pocket maximum | $3,000 individual / $6,000 family | $9,000 / $18,000 |
| Coinsurance after deductible | 10% | 40% |
| Primary care visit copay | $20 | 40% after deductible |
| Specialist visit copay | $40 | 40% after deductible |
| Emergency room copay | $150 (waived if admitted) | Same |
| Generic prescription copay | $10 | $25 |
| Brand prescription copay | $35 | $70 |

## Covered services

Medically necessary services covered under this plan include preventive
care (no member cost-share when in-network), primary and specialty
office visits, inpatient and outpatient hospital services, emergency and
urgent care, mental health and substance use disorder services,
maternity care, prescription drugs on the Synthetic Health Plan Co.
formulary, laboratory and imaging services, and rehabilitative therapy
(physical, occupational, speech).

## Exclusions and limitations

The following services are not covered: cosmetic procedures (except
reconstructive surgery following injury), experimental or investigational
treatments, services covered by workers' compensation, services received
outside the United States (except emergency stabilization), and benefits
beyond plan-year maximums. Claims denied for non-covered services cite
**SYN-DENY-001**. Claims denied for exceeding an annual benefit maximum
cite **SYN-DENY-002**, which is not appealable.

## Prior authorization

The following require prior authorization before the date of service:
non-emergent inpatient admissions, outpatient surgery, advanced imaging
(MRI, CT, PET), durable medical equipment over $1,000, specialty-pharmacy
medications, and physical therapy beyond the initial evaluation visit.
Failure to obtain authorization results in denial under **SYN-DENY-007**
(prior authorization not obtained) or **SYN-DENY-008** (authorization
expired before the date of service). Both codes are appealable upon
submission of clinical justification.

## Network rules

This PPO plan does not require a primary care referral to see a
specialist. Using in-network providers materially lowers your cost-share.
Services billed by an out-of-network provider when an in-network option
was available may be denied under **SYN-DENY-005**. Out-of-network
referrals not obtained prior to service may be denied under
**SYN-DENY-006**. Network-rule denials are not appealable except in
documented emergent-care circumstances.

## Coordination of benefits

When a member is covered by more than one health plan, Synthetic Health
Plan Co. coordinates benefits according to standard order-of-benefits
rules. A claim may be denied under **SYN-DENY-009** when other primary
coverage is indicated but not on file, or under **SYN-DENY-010** when
the primary payer's Explanation of Benefits has not been submitted with
the claim. Both codes are appealable upon submission of the missing
documentation.

## Documentation requirements

All claims must include valid diagnosis (ICD) and procedure (CPT or
HCPCS) codes. Missing or invalid codes result in denial under
**SYN-DENY-004**, which is appealable. Records requested in support of a
claim must be received within 45 days of the request; failure to respond
within this window results in denial under **SYN-DENY-003**, also
appealable upon submission.

## Appeals procedure

You may appeal any adverse benefit determination within 180 days of the
denial. Submit a written appeal to the address below, including the
claim number, the denial code, and supporting documentation. Internal
review is completed within 30 days for pre-service claims and 60 days
for post-service claims. If your internal appeal is upheld, you may
request an external review through an independent third-party reviewer.

## Contact

Synthetic Health Plan Co.
Member Services: 1-555-SYN-PLAN (toll-free, synthetic)
TTY: 1-555-SYN-0711
Mailing address: 1 Fake Plaza, Synthetic City, ST 00000
Web: synthetic-health-plan.example.invalid

*Synthetic data only. Do not rely on any figures, codes, or contact details for real coverage decisions.*
`;
}

function silverPpoPolicyDoc(): string {
  return `# Synthetic Silver PPO Plan Summary

**Plan issuer:** Synthetic Health Plan Co.
**Plan year:** 2026
**Plan type:** Preferred Provider Organization (PPO), Silver tier

> This document is part of a synthetic-data demonstration. No real plan,
> insurer, member, or claim is represented. Coverage figures, denial codes,
> and contact details are fabricated.

## Cost-share at a glance

| Cost-share | In-network | Out-of-network |
| --- | --- | --- |
| Annual deductible | $2,000 individual / $4,000 family | $4,000 / $8,000 |
| Out-of-pocket maximum | $6,500 individual / $13,000 family | $13,000 / $26,000 |
| Coinsurance after deductible | 25% | 50% |
| Primary care visit copay | $35 | 50% after deductible |
| Specialist visit copay | $65 | 50% after deductible |
| Emergency room copay | $300 (waived if admitted) | Same |
| Generic prescription copay | $15 | $30 |
| Brand prescription copay | $50 | $100 |

## Covered services

The Silver PPO covers the same categories of medically necessary
services as the Gold PPO, with the higher cost-share shown above.
Preventive care remains no-cost-share when received from an in-network
provider. Specialist visits do not require a primary care referral.

## Exclusions and limitations

The Silver PPO uses the same exclusions list as the Gold PPO. Claims
denied for non-covered services cite **SYN-DENY-001**. Claims denied for
exceeding an annual benefit maximum cite **SYN-DENY-002**, which is not
appealable. Members at the Silver tier should be especially attentive to
annual visit caps on rehabilitative therapy and durable medical
equipment, which are lower than at the Gold tier.

## Prior authorization

Prior authorization rules at the Silver tier mirror the Gold tier with
two additions: outpatient infusion therapy and home health visits beyond
the initial evaluation also require prior authorization. Denials cite
**SYN-DENY-007** (prior authorization not obtained) or **SYN-DENY-008**
(authorization expired before the date of service). Both codes are
appealable.

## Network rules

The Silver PPO does not require a primary care referral. Out-of-network
services carry the higher cost-share shown above, and out-of-network
denials follow the same pattern as the Gold tier: **SYN-DENY-005** for
non-network providers, **SYN-DENY-006** for missing out-of-network
referrals. Neither code is routinely appealable.

## Coordination of benefits

If you are covered by another plan, Synthetic Health Plan Co.
coordinates benefits under standard order-of-benefits rules. Denials
cite **SYN-DENY-009** when other primary coverage is indicated but not
on file, or **SYN-DENY-010** when the primary payer's Explanation of
Benefits has not been submitted. Both are appealable upon submission.

## Documentation requirements

Claims must include valid diagnosis (ICD) and procedure (CPT or HCPCS)
codes. Missing or invalid codes result in **SYN-DENY-004**, which is
appealable. Requested records not received within 45 days result in
**SYN-DENY-003**, also appealable.

## Appeals procedure

Appeals follow the same procedure as the Gold PPO: written submission
within 180 days, internal review within 30 days (pre-service) or 60 days
(post-service), and external review available if the internal appeal is
upheld.

## Contact

Synthetic Health Plan Co.
Member Services: 1-555-SYN-PLAN (toll-free, synthetic)
TTY: 1-555-SYN-0711
Mailing address: 1 Fake Plaza, Synthetic City, ST 00000
Web: synthetic-health-plan.example.invalid

*Synthetic data only. Do not rely on any figures, codes, or contact details for real coverage decisions.*
`;
}

function bronzeHmoPolicyDoc(): string {
  return `# Synthetic Bronze HMO Plan Summary

**Plan issuer:** Synthetic Health Plan Co.
**Plan year:** 2026
**Plan type:** Health Maintenance Organization (HMO), Bronze tier

> This document is part of a synthetic-data demonstration. No real plan,
> insurer, member, or claim is represented. Coverage figures, denial codes,
> and contact details are fabricated.

## Cost-share at a glance

| Cost-share | In-network only |
| --- | --- |
| Annual deductible | $7,000 individual / $14,000 family |
| Out-of-pocket maximum | $9,450 individual / $18,900 family |
| Coinsurance after deductible | 40% |
| Primary care visit copay | $50 |
| Specialist visit copay (with referral) | $90 |
| Emergency room copay | $500 (waived if admitted) |
| Generic prescription copay | $20 |
| Brand prescription copay | $80 |

## How the HMO works

The Bronze HMO requires that you select a primary care provider (PCP)
from the Synthetic Health Plan Co. in-network directory. With the
exception of true emergencies, all specialist visits, imaging, and
non-routine services require a referral from your PCP before the
service is rendered. There is no out-of-network coverage except in
emergency circumstances; services delivered out-of-network without an
approved referral are not covered.

## Covered services

The Bronze HMO covers medically necessary services in the same broad
categories as the PPO plans — preventive care, primary care, specialty
care (with referral), hospital services, emergency care, mental health
and substance use services, maternity care, and prescription drugs on
the Synthetic Health Plan Co. formulary. The lower premium of the
Bronze tier is offset by the higher cost-share shown above and by the
referral and network requirements described below.

## Exclusions and limitations

Excluded services match the PPO list: cosmetic procedures (except
post-injury reconstructive surgery), experimental or investigational
treatments, services covered under workers' compensation, services
received outside the United States (except emergency stabilization),
and benefits beyond plan-year maximums. Non-covered service denials
cite **SYN-DENY-001**. Annual-maximum denials cite **SYN-DENY-002**,
which is not appealable.

## Prior authorization and referrals

This is the most consequential difference between the Bronze HMO and
the PPO plans: every specialist visit requires a PCP referral, and a
broad set of services require prior authorization in addition to the
referral. Authorizable services include inpatient admissions, outpatient
surgery, advanced imaging, durable medical equipment, specialty
pharmacy, and most therapy services beyond initial evaluation.

Common denial patterns under this plan:

- **SYN-DENY-006** is the most frequent denial code on the Bronze HMO: it indicates that an out-of-network or non-referred specialist visit was rendered without an approved PCP referral. This code is not appealable except in documented emergent-care circumstances.
- **SYN-DENY-005** applies when a member receives services from a provider not in the Synthetic Health Plan Co. network at all. Also not appealable.
- **SYN-DENY-007** indicates a service that requires prior authorization was rendered without one. Appealable upon submission of clinical justification.
- **SYN-DENY-008** indicates a prior authorization existed but had expired before the date of service. Appealable.

## Coordination of benefits

If you are covered by another plan, coordination of benefits follows
the same order-of-benefits rules as the PPO plans. Denials cite
**SYN-DENY-009** when other primary coverage is indicated but not on
file, and **SYN-DENY-010** when the primary payer's Explanation of
Benefits has not been submitted. Both are appealable upon submission.

## Documentation requirements

Claims must include valid diagnosis (ICD) and procedure (CPT or HCPCS)
codes. Missing or invalid codes result in **SYN-DENY-004**. Requested
medical records not received within 45 days result in **SYN-DENY-003**.
Both are appealable upon submission of the missing material.

## Appeals procedure

Appeals on the Bronze HMO follow the same process as the PPO plans:
written appeal within 180 days, internal review within 30 days
(pre-service) or 60 days (post-service), and external review available
if internal review is upheld. Note that the highest-volume denial code
on this plan (**SYN-DENY-006**) is generally not appealable, so the
practical first line of defense is to obtain referrals before
specialist services.

## Contact

Synthetic Health Plan Co.
Member Services: 1-555-SYN-PLAN (toll-free, synthetic)
TTY: 1-555-SYN-0711
Mailing address: 1 Fake Plaza, Synthetic City, ST 00000
Web: synthetic-health-plan.example.invalid

*Synthetic data only. Do not rely on any figures, codes, or contact details for real coverage decisions.*
`;
}

function generatePolicyDocs(): Record<string, string> {
  return {
    "gold-ppo-plan-summary.md": goldPpoPolicyDoc(),
    "silver-ppo-plan-summary.md": silverPpoPolicyDoc(),
    "bronze-hmo-plan-summary.md": bronzeHmoPolicyDoc(),
  };
}

function writeJson(path: string, data: unknown): void {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

function main(): void {
  const rng = createRng(SEED);

  const members = generateMembers(rng);
  const claims = generateClaims(rng, members, DENIAL_CODES);
  const policyDocs = generatePolicyDocs();

  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(POLICY_DOCS_DIR, { recursive: true });

  writeJson(join(DATA_DIR, "members.json"), members);
  writeJson(join(DATA_DIR, "claims.json"), claims);
  writeJson(join(DATA_DIR, "denialCodes.json"), DENIAL_CODES);

  for (const [filename, content] of Object.entries(policyDocs)) {
    writeFileSync(join(POLICY_DOCS_DIR, filename), content);
  }

  console.log(
    `Generated ${members.length} members, ${claims.length} claims, ${DENIAL_CODES.length} denial codes, ${Object.keys(policyDocs).length} policy docs.`,
  );
}

main();
