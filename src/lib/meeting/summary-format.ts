export function isWallChatSummary(summary: unknown): boolean {
  return (
    Boolean(summary) &&
    typeof summary === "object" &&
    !Array.isArray(summary) &&
    (summary as { format?: unknown }).format === "wall_chat"
  );
}

export function isIssueCardsSummary(summary: unknown): boolean {
  return (
    Boolean(summary) &&
    typeof summary === "object" &&
    !Array.isArray(summary) &&
    (summary as { format?: unknown }).format === "issue_cards" &&
    Array.isArray((summary as { issues?: unknown }).issues)
  );
}
