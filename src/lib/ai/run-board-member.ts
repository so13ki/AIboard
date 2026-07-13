import {
  formatMember,
  prompts,
  type CompanyContext,
  type MemberContext,
  type ProjectContext,
} from "./prompts";
import type { ReviewLevel } from "./role-focus";
import { buildSystemPrompt, generateStructuredJson } from "./run-structured";
import {
  initialReviewSchema,
  issueDebateTurnSchema,
  discussionUtteranceSchema,
  productCoachSchema,
  rebuttalSchema,
  reReviewSchema,
  type InitialReviewOutput,
  type IssueDebateTurnOutput,
  type DiscussionUtteranceOutput,
  type ProductCoachOutput,
  type RebuttalOutput,
  type ReReviewOutput,
} from "./schemas";

function memberSystem(member: MemberContext): string {
  return buildSystemPrompt(
    `あなたは「${member.title}」です。\n${formatMember(member)}`,
  );
}

export async function runInitialReview(args: {
  company: CompanyContext;
  project: ProjectContext;
  member: MemberContext;
  agenda: unknown;
  reviewLevel: ReviewLevel;
  priorReviews: unknown[];
  signal?: AbortSignal;
}): Promise<InitialReviewOutput> {
  return generateStructuredJson({
    system: memberSystem(args.member),
    user: prompts.initialReviewUser(
      args.company,
      args.project,
      args.member,
      args.agenda,
      args.reviewLevel,
      args.priorReviews,
    ),
    schema: initialReviewSchema,
    schemaName: "initialReview",
    signal: args.signal,
  });
}

export async function runRebuttal(args: {
  company: CompanyContext;
  project: ProjectContext;
  member: MemberContext;
  assignedTarget: {
    memberTitle: string;
    roleKey: string;
    stance: string;
    content: unknown;
  };
  otherReviews: unknown[];
  reviewLevel: ReviewLevel;
  previousDecision: string;
}): Promise<RebuttalOutput> {
  return generateStructuredJson({
    system: memberSystem(args.member),
    user: prompts.rebuttalUser(
      args.company,
      args.project,
      args.member,
      args.assignedTarget,
      args.otherReviews,
      args.reviewLevel,
      args.previousDecision,
    ),
    schema: rebuttalSchema,
    schemaName: "mutualReview",
  });
}

export async function runIssueDebateTurn(args: {
  company: CompanyContext;
  project: ProjectContext;
  member: MemberContext;
  reviewLevel: ReviewLevel;
  issue: unknown;
  turnType: "claim" | "rebuttal" | "re_rebuttal";
  opponentTitle: string;
  priorTurns: unknown[];
  selfPreviousVote: string;
  selfPreviousCondition: string;
}): Promise<IssueDebateTurnOutput> {
  return generateStructuredJson({
    system: memberSystem(args.member),
    user: prompts.issueDebateTurnUser({
      company: args.company,
      project: args.project,
      member: args.member,
      reviewLevel: args.reviewLevel,
      issue: args.issue,
      turnType: args.turnType,
      opponentTitle: args.opponentTitle,
      priorTurns: args.priorTurns,
      selfPreviousVote: args.selfPreviousVote,
      selfPreviousCondition: args.selfPreviousCondition,
    }),
    schema: issueDebateTurnSchema,
    schemaName: "issueDebateTurn",
  });
}

export async function runDiscussionUtterance(args: {
  company: CompanyContext;
  project: ProjectContext;
  member: MemberContext;
  reviewLevel: ReviewLevel;
  transcript: unknown[];
  nominateReason: string;
  currentPlan: { version: number; summary: string };
  decisions: string[];
  rejectedItems: string[];
  openTopics: unknown[];
  proposerAnswers: string[];
  chairNotes: string[];
  signal?: AbortSignal;
}): Promise<DiscussionUtteranceOutput> {
  return generateStructuredJson({
    system: memberSystem(args.member),
    user: prompts.discussionUtteranceUser({
      company: args.company,
      project: args.project,
      member: args.member,
      transcript: args.transcript,
      reviewLevel: args.reviewLevel,
      nominateReason: args.nominateReason,
      currentPlan: args.currentPlan,
      decisions: args.decisions,
      rejectedItems: args.rejectedItems,
      openTopics: args.openTopics,
      proposerAnswers: args.proposerAnswers,
      chairNotes: args.chairNotes,
    }),
    schema: discussionUtteranceSchema,
    schemaName: "discussionUtterance",
    signal: args.signal,
  });
}

export async function runProductCoach(args: {
  company: CompanyContext;
  project: ProjectContext;
  coach: MemberContext;
  reviews: unknown[];
  mutualReviews: unknown[];
  reviewLevel: ReviewLevel;
  roundLabel: string;
}): Promise<ProductCoachOutput> {
  return generateStructuredJson({
    system: memberSystem(args.coach),
    user: prompts.productCoachUser(
      args.company,
      args.project,
      args.reviews,
      args.mutualReviews,
      args.reviewLevel,
      args.roundLabel,
    ),
    schema: productCoachSchema,
    schemaName: "productCoach",
  });
}

export async function runReReview(args: {
  company: CompanyContext;
  project: ProjectContext;
  member: MemberContext;
  interim: unknown;
  proposerAnswer: unknown;
  previousReview: unknown;
  reviewLevel: ReviewLevel;
  agenda: unknown;
}): Promise<ReReviewOutput> {
  return generateStructuredJson({
    system: memberSystem(args.member),
    user: prompts.reReviewUser(
      args.company,
      args.project,
      args.member,
      args.interim,
      args.proposerAnswer,
      args.previousReview,
      args.reviewLevel,
      args.agenda,
    ),
    schema: reReviewSchema,
    schemaName: "reReview",
  });
}
