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
  agendaSchema,
  ceoEditSchema,
  decisionSchema,
  discussionBriefSummarySchema,
  discussionFacilitatorSchema,
  growthSummarySchema,
  interruptClassificationSchema,
  issueChairSummarySchema,
  issueExtractionSchema,
  planUpdateDetectionSchema,
  qualityBalancerSchema,
  type AgendaOutput,
  type CeoEditOutput,
  type DecisionOutput,
  type DiscussionBriefSummaryOutput,
  type DiscussionFacilitatorOutput,
  type GrowthSummaryOutput,
  type InterruptClassificationOutput,
  type IssueChairSummaryOutput,
  type IssueExtractionOutput,
  type PlanUpdateDetectionOutput,
  type QualityBalancerOutput,
} from "./schemas";

function chairSystem(member: MemberContext): string {
  return buildSystemPrompt(
    `あなたはCEO・編集者「${member.title}」です。\n${formatMember(member)}`,
  );
}

export async function runAgenda(args: {
  company: CompanyContext;
  project: ProjectContext;
  chair: MemberContext;
}): Promise<AgendaOutput> {
  return generateStructuredJson({
    system: chairSystem(args.chair),
    user: prompts.agendaUser(args.company, args.project),
    schema: agendaSchema,
    schemaName: "agenda",
  });
}

export async function runCeoEdit(args: {
  company: CompanyContext;
  project: ProjectContext;
  chair: MemberContext;
  interim: unknown;
  proposerAnswer: unknown;
  reReviews: unknown[];
  rebuttals: unknown[];
  reviewLevel: ReviewLevel;
}): Promise<CeoEditOutput> {
  return generateStructuredJson({
    system: chairSystem(args.chair),
    user: prompts.ceoEditUser(
      args.company,
      args.project,
      args.interim,
      args.proposerAnswer,
      args.reReviews,
      args.rebuttals,
      args.reviewLevel,
    ),
    schema: ceoEditSchema,
    schemaName: "ceoEdit",
  });
}

export async function runDecision(args: {
  company: CompanyContext;
  project: ProjectContext;
  chair: MemberContext;
  interim: unknown;
  proposerAnswer: unknown;
  reReviews: unknown[];
  ceoEdit: unknown;
  reviewLevel: ReviewLevel;
  agenda: unknown;
}): Promise<DecisionOutput> {
  return generateStructuredJson({
    system: chairSystem(args.chair),
    user: prompts.decisionUser(
      args.company,
      args.project,
      args.interim,
      args.proposerAnswer,
      args.reReviews,
      args.ceoEdit,
      args.reviewLevel,
      args.agenda,
    ),
    schema: decisionSchema,
    schemaName: "decision",
  });
}

export async function runGrowthSummary(args: {
  company: CompanyContext;
  project: ProjectContext;
  chair: MemberContext;
  coach: unknown;
  proposerAnswers: unknown[];
  ceoEdit: unknown;
  decision?: unknown;
}): Promise<GrowthSummaryOutput> {
  return generateStructuredJson({
    system: chairSystem(args.chair),
    user: prompts.growthSummaryUser(
      args.company,
      args.project,
      args.coach,
      args.proposerAnswers,
      args.ceoEdit,
      args.decision,
    ),
    schema: growthSummarySchema,
    schemaName: "growthSummary",
  });
}

export async function runIssueExtraction(args: {
  company: CompanyContext;
  project: ProjectContext;
  chair: MemberContext;
  reviews: unknown[];
  availableRoleKeys: string[];
  reviewLevel: ReviewLevel;
}): Promise<IssueExtractionOutput> {
  return generateStructuredJson({
    system: chairSystem(args.chair),
    user: prompts.issueExtractionUser(
      args.company,
      args.project,
      args.reviews,
      args.availableRoleKeys,
      args.reviewLevel,
    ),
    schema: issueExtractionSchema,
    schemaName: "issueExtraction",
  });
}

export async function runIssueChairSummary(args: {
  company: CompanyContext;
  project: ProjectContext;
  chair: MemberContext;
  issue: unknown;
  turns: unknown[];
  reviewLevel: ReviewLevel;
}): Promise<IssueChairSummaryOutput> {
  return generateStructuredJson({
    system: chairSystem(args.chair),
    user: prompts.issueChairSummaryUser(
      args.company,
      args.project,
      args.issue,
      args.turns,
      args.reviewLevel,
    ),
    schema: issueChairSummarySchema,
    schemaName: "issueChairSummary",
  });
}

export async function runQualityBalancer(args: {
  company: CompanyContext;
  project: ProjectContext;
  chair: MemberContext;
  issue: unknown;
  chairSummary: unknown;
  reviewLevel: ReviewLevel;
}): Promise<QualityBalancerOutput> {
  return generateStructuredJson({
    system: buildSystemPrompt(
      `あなたはQuality Balancerです。M(Simply)に従い過剰案を削ります。\n${formatMember(args.chair)}`,
    ),
    user: prompts.qualityBalancerUser(
      args.company,
      args.project,
      args.issue,
      args.chairSummary,
      args.reviewLevel,
    ),
    schema: qualityBalancerSchema,
    schemaName: "qualityBalancer",
  });
}

export async function runDiscussionFacilitator(args: {
  company: CompanyContext;
  project: ProjectContext;
  chair: MemberContext;
  availableRoleKeys: string[];
  transcript: unknown[];
  reviewLevel: ReviewLevel;
  evolvedHints: string[];
  currentPlan: { version: number; summary: string };
  planVersions: unknown[];
  openTopics: unknown[];
  priorityIssues: string[];
  ceoQuestions: unknown[];
  decisions: string[];
  rejectedItems: string[];
  lastSpeakerRoleKey?: string | null;
  activeTheme?: string | null;
  closedThemes?: string[];
  signal?: AbortSignal;
}): Promise<DiscussionFacilitatorOutput> {
  return generateStructuredJson({
    system: buildSystemPrompt(
      `あなたは壁打ち会議の司会「${args.chair.title}」です。\n${formatMember(args.chair)}`,
    ),
    user: prompts.discussionFacilitatorUser({
      company: args.company,
      project: args.project,
      availableRoleKeys: args.availableRoleKeys,
      transcript: args.transcript,
      reviewLevel: args.reviewLevel,
      evolvedHints: args.evolvedHints,
      currentPlan: args.currentPlan,
      planVersions: args.planVersions,
      openTopics: args.openTopics,
      priorityIssues: args.priorityIssues,
      ceoQuestions: args.ceoQuestions,
      decisions: args.decisions,
      rejectedItems: args.rejectedItems,
      lastSpeakerRoleKey: args.lastSpeakerRoleKey,
      activeTheme: args.activeTheme,
      closedThemes: args.closedThemes,
    }),
    schema: discussionFacilitatorSchema,
    schemaName: "discussionFacilitator",
    signal: args.signal,
  });
}

export async function runPlanUpdateDetection(args: {
  company: CompanyContext;
  project: ProjectContext;
  chair: MemberContext;
  currentPlan: { version: number; summary: string };
  proposerMessage: string;
  revisedPlanNote?: string;
  signal?: AbortSignal;
}): Promise<PlanUpdateDetectionOutput> {
  return generateStructuredJson({
    system: buildSystemPrompt(
      `あなたは壁打ち会議の司会「${args.chair.title}」です。企画更新の判定だけを行います。\n${formatMember(args.chair)}`,
    ),
    user: prompts.planUpdateDetectionUser({
      company: args.company,
      project: args.project,
      currentPlan: args.currentPlan,
      proposerMessage: args.proposerMessage,
      revisedPlanNote: args.revisedPlanNote,
    }),
    schema: planUpdateDetectionSchema,
    schemaName: "planUpdateDetection",
    signal: args.signal,
  });
}

export async function runInterruptClassification(args: {
  company: CompanyContext;
  project: ProjectContext;
  chair: MemberContext;
  currentPlan: { version: number; summary: string };
  proposerMessage: string;
  targetRoleKey: string | null;
  messageType: string | null;
  availableRoleKeys: string[];
  signal?: AbortSignal;
}): Promise<InterruptClassificationOutput> {
  return generateStructuredJson({
    system: buildSystemPrompt(
      `あなたは壁打ち会議の司会です。割り込み意図を短く分類します。\n${formatMember(args.chair)}`,
    ),
    user: prompts.interruptClassificationUser({
      company: args.company,
      project: args.project,
      currentPlan: args.currentPlan,
      proposerMessage: args.proposerMessage,
      targetRoleKey: args.targetRoleKey,
      messageType: args.messageType,
      availableRoleKeys: args.availableRoleKeys,
    }),
    schema: interruptClassificationSchema,
    schemaName: "interruptClassification",
    signal: args.signal,
  });
}

export async function runDiscussionBriefSummary(args: {
  company: CompanyContext;
  project: ProjectContext;
  chair: MemberContext;
  currentPlan: { version: number; summary: string };
  transcript: unknown[];
  decisions?: string[];
  rejectedItems?: string[];
  openTopics?: unknown[];
  priorityIssues?: string[];
  signal?: AbortSignal;
}): Promise<DiscussionBriefSummaryOutput> {
  return generateStructuredJson({
    system: buildSystemPrompt(
      `あなたは壁打ち会議の司会です。簡潔な整理だけ行います。\n${formatMember(args.chair)}`,
    ),
    user: prompts.discussionBriefSummaryUser({
      company: args.company,
      project: args.project,
      currentPlan: args.currentPlan,
      transcript: args.transcript,
      decisions: args.decisions,
      rejectedItems: args.rejectedItems,
      openTopics: args.openTopics,
      priorityIssues: args.priorityIssues,
    }),
    schema: discussionBriefSummarySchema,
    schemaName: "discussionBriefSummary",
    signal: args.signal,
  });
}
