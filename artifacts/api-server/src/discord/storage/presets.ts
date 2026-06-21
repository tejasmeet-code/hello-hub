/**
 * Built-in config presets.
 * Presets are hardcoded into the bot — only devs can add new ones by editing
 * this file. Any server manager can apply a preset; it copies modules + all
 * per-module settings while leaving channels, managers, and roles untouched.
 */
import type { TransferableConfig } from "./templates";

export interface Preset {
  id: string;
  name: string;
  description: string;
  /** Human-readable bullet list of what this preset configures. */
  highlights: string[];
  config: TransferableConfig;
}

export const PRESETS: Record<string, Preset> = {
  neku: {
    id: "neku",
    name: "Neku Standard",
    description: "Default settings used across Neku-managed servers. 60 messages or 3 mod actions per week, Friday week start.",
    highlights: [
      "staffMgmt, quota & auditLog enabled",
      "Quota: 60 messages OR 3 mod actions/week",
      "Week starts on Friday",
      "Strikes expire after 30 days",
      "Auto-demotion on 3+ active strikes",
      "Quota failures: warning → strike → termination",
    ],
    config: {
      modules: {
        staffMgmt: true,
        quota: true,
        auditLog: true,
        moderation: false,
        infractions: true,
        appeals: false,
        loa: false,
        partnership: false,
        verify: false,
        banRequest: false,
        roleMemory: false,
        antiNuke: false,
        automations: false,
        serverMaintenance: false,
      },
      quotaConfig: { messages: 60, modActions: 3, weekStartDay: 5 },
      infractionsConfig: {
        strikeExpiryDays: 30,
        dmOnInfraction: false,
        autoDemotionEnabled: true,
        strikeAction1: "warning",
        strikeAction2: "strike",
        strikeAction3plus: "termination",
      },
      quotaFailureConfig: {
        failure1: "warning",
        failure2: "strike",
        failure3plus: "termination",
      },
    },
  },

  standard: {
    id: "standard",
    name: "Standard",
    description: "A balanced setup suitable for most servers. All main modules enabled with sensible defaults.",
    highlights: [
      "All modules on (anti-nuke off by default)",
      "Strikes expire after 30 days",
      "Auto-demotion on 3+ active strikes",
      "Quota: 100 messages or 10 mod actions/week",
      "Quota failures: warning → strike → termination",
      "DM members on promotions, demotions & infractions",
    ],
    config: {
      modules: {
        staffMgmt: true,
        quota: true,
        auditLog: true,
        moderation: true,
        infractions: true,
        appeals: true,
        loa: true,
        partnership: false,
        verify: false,
        banRequest: false,
        roleMemory: true,
        antiNuke: false,
        automations: false,
        serverMaintenance: false,
      },
      quotaConfig: { messages: 100, modActions: 10, weekStartDay: 1 },
      infractionsConfig: {
        strikeExpiryDays: 30,
        dmOnInfraction: true,
        autoDemotionEnabled: true,
        strikeAction1: "warning",
        strikeAction2: "strike",
        strikeAction3plus: "termination",
      },
      moderationConfig: { dmOnAction: true },
      promotionsConfig: { dmMember: true },
      demotionsConfig: { dmMember: true },
      appealsConfig: { autoCloseDays: 0 },
      loaConfig: { maxDurationDays: 30, requireReason: true },
      quotaFailureConfig: {
        failure1: "warning",
        failure2: "strike",
        failure3plus: "termination",
      },
    },
  },

  strict: {
    id: "strict",
    name: "Strict Staff",
    description: "Tighter standards for staff management. Shorter strike windows, faster escalation, mandatory quota.",
    highlights: [
      "Strikes expire after 14 days",
      "Auto-demotion on 3+ active strikes",
      "Quota failures escalate faster (warning → strike → termination)",
      "Quota: 150 messages or 15 mod actions/week",
      "LOA requires a reason, max 14 days",
      "DM members on all actions",
    ],
    config: {
      modules: {
        staffMgmt: true,
        quota: true,
        auditLog: true,
        moderation: true,
        infractions: true,
        appeals: true,
        loa: true,
        partnership: false,
        verify: false,
        banRequest: false,
        roleMemory: true,
        antiNuke: false,
        automations: false,
        serverMaintenance: false,
      },
      quotaConfig: { messages: 150, modActions: 15, weekStartDay: 1 },
      infractionsConfig: {
        strikeExpiryDays: 14,
        dmOnInfraction: true,
        autoDemotionEnabled: true,
        strikeAction1: "strike",
        strikeAction2: "demotion",
        strikeAction3plus: "termination",
      },
      moderationConfig: { dmOnAction: true },
      promotionsConfig: { dmMember: true },
      demotionsConfig: { dmMember: true },
      appealsConfig: { autoCloseDays: 7 },
      loaConfig: { maxDurationDays: 14, requireReason: true },
      quotaFailureConfig: {
        failure1: "strike",
        failure2: "demotion",
        failure3plus: "termination",
      },
    },
  },

  moderation: {
    id: "moderation",
    name: "Moderation Focus",
    description: "For servers where moderation is the main priority. Enables appeals, ban requests, anti-nuke, and role memory.",
    highlights: [
      "Moderation, appeals, ban-request, role memory & anti-nuke all enabled",
      "Appeals auto-close after 14 days",
      "DM users on all moderation actions",
      "Infractions: strikes expire after 60 days",
      "Staff quota optional (lower targets)",
    ],
    config: {
      modules: {
        staffMgmt: true,
        quota: false,
        auditLog: true,
        moderation: true,
        infractions: true,
        appeals: true,
        loa: false,
        partnership: false,
        verify: false,
        banRequest: true,
        roleMemory: true,
        antiNuke: true,
        automations: false,
        serverMaintenance: false,
      },
      infractionsConfig: {
        strikeExpiryDays: 60,
        dmOnInfraction: true,
        autoDemotionEnabled: true,
        strikeAction1: "warning",
        strikeAction2: "strike",
        strikeAction3plus: "termination",
      },
      moderationConfig: { dmOnAction: true },
      promotionsConfig: { dmMember: false },
      demotionsConfig: { dmMember: true },
      appealsConfig: { autoCloseDays: 14 },
    },
  },

  minimal: {
    id: "minimal",
    name: "Minimal",
    description: "Only the core modules — staff management, audit log, and quota. Everything else is off.",
    highlights: [
      "Only staffMgmt, quota & auditLog enabled",
      "No moderation, appeals, LOA, anti-nuke, etc.",
      "Strikes expire after 30 days",
      "Quota: 50 messages or 5 mod actions/week",
      "Good starting point — enable more modules as needed",
    ],
    config: {
      modules: {
        staffMgmt: true,
        quota: true,
        auditLog: true,
        moderation: false,
        infractions: true,
        appeals: false,
        loa: false,
        partnership: false,
        verify: false,
        banRequest: false,
        roleMemory: false,
        antiNuke: false,
        automations: false,
        serverMaintenance: false,
      },
      quotaConfig: { messages: 50, modActions: 5, weekStartDay: 1 },
      infractionsConfig: {
        strikeExpiryDays: 30,
        dmOnInfraction: false,
        autoDemotionEnabled: true,
        strikeAction1: "warning",
        strikeAction2: "strike",
        strikeAction3plus: "termination",
      },
      quotaFailureConfig: {
        failure1: "warning",
        failure2: "strike",
        failure3plus: "termination",
      },
    },
  },

  partnership: {
    id: "partnership",
    name: "Partnership Server",
    description: "For servers that run a partnership programme. Enables the partnership module alongside standard staff management.",
    highlights: [
      "Partnership module enabled (quota: 3 per week)",
      "Standard staff modules on",
      "Verify module on for member verification",
      "LOA and appeals enabled",
      "Failure to meet partnership quota: warning → strike → termination",
    ],
    config: {
      modules: {
        staffMgmt: true,
        quota: true,
        auditLog: true,
        moderation: true,
        infractions: true,
        appeals: true,
        loa: true,
        partnership: true,
        verify: true,
        banRequest: false,
        roleMemory: true,
        antiNuke: false,
        automations: false,
        serverMaintenance: false,
      },
      quotaConfig: { messages: 75, modActions: 5, weekStartDay: 1 },
      infractionsConfig: {
        strikeExpiryDays: 30,
        dmOnInfraction: true,
        autoDemotionEnabled: true,
        strikeAction1: "warning",
        strikeAction2: "strike",
        strikeAction3plus: "termination",
      },
      moderationConfig: { dmOnAction: true },
      promotionsConfig: { dmMember: true },
      demotionsConfig: { dmMember: true },
      appealsConfig: { autoCloseDays: 0 },
      loaConfig: { maxDurationDays: 30, requireReason: true },
      partnershipConfig: {
        quota: 3,
        failureActions: { 1: "warning", 2: "strike", 3: "termination" },
      },
      quotaFailureConfig: {
        failure1: "warning",
        failure2: "strike",
        failure3plus: "termination",
      },
    },
  },
};

export function getPreset(id: string): Preset | null {
  return PRESETS[id] ?? null;
}

export function listPresets(): Preset[] {
  return Object.values(PRESETS);
}
