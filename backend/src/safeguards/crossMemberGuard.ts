const MEMBER_ID_PATTERN = /\bM-\d{3,}\b/gi;
const CLAIM_ID_PATTERN = /\bC-\d{4,}\b/gi;

export async function detectCrossMemberReference(
  authenticatedMemberId: string,
  inquiry: string,
  lookupClaimOwner: (claimId: string) => Promise<string | null>,
): Promise<{ isViolation: true; reason: string } | { isViolation: false }> {
  const memberMatches = inquiry.match(MEMBER_ID_PATTERN) ?? [];
  for (const match of memberMatches) {
    const referencedId = match.toUpperCase();
    if (referencedId !== authenticatedMemberId) {
      return {
        isViolation: true,
        reason: `Inquiry references member ${referencedId}, which is not the authenticated member.`,
      };
    }
  }

  const claimMatches = inquiry.match(CLAIM_ID_PATTERN) ?? [];
  for (const match of claimMatches) {
    const claimId = match.toUpperCase();
    const owner = await lookupClaimOwner(claimId);
    if (owner !== null && owner !== authenticatedMemberId) {
      return {
        isViolation: true,
        reason: `Claim ${claimId} belongs to a different member.`,
      };
    }
  }

  return { isViolation: false };
}
