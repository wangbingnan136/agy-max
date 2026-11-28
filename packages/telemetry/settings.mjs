export const TELEMETRY_DEFAULTS = Object.freeze({
  overviewRange: 'weeklyQuota',
  contextRing: true,
  speedStats: true,
  composerIndicatorTone: 'semantic',
  composerIndicatorCompact: false,
  composerQuota: false,
  composerQuotaWindow: 'auto',
  progress: true,
  overviewQuota: false,
  subagentTelemetry: true,
  timing: true,
  toolDetails: true
});

export const TELEMETRY_KEYS = Object.freeze(Object.keys(TELEMETRY_DEFAULTS));
