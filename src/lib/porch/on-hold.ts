/**
 * Features on hold (BUILD-BRIEF.md, section 4). They are hidden, not deleted: all their code stays.
 * To bring one back, change its `true` to `false` here. Every place that shows the feature checks this list.
 */
export const ON_HOLD = {
  /** Porchbook Radio: the radio door, on-air bar, studio, control room, jingles, nuggets and listening. */
  radio: true,
  /** The PorchGuy (AI helper): the header button and his page. */
  porchGuy: true,
  /** PorchWay, the driving game (/city). */
  porchWay: true,
  /** Group calls of any size, including open porch calls: the Call door on the tour. One-to-one calls stay. */
  groupCalls: true,
  /** The Clinic door on the tour (Feedback takes its place again). */
  clinic: true,
  /** The devotional read aloud (ElevenLabs, Azure or Google voices) and the AI-credit warning strip. */
  devotionVoice: true,
  /** Machine translation of the devotional (Sunbird). Phaneroo's own Runyankore and Luganda still show. */
  machineTranslation: true,
  /** The Message (MSG) and Amplified Classic (AMPC) Bibles (uploaded versions and "Read in…" links), until JT confirms permission (decision 5). */
  permissionBibles: true,
} as const;

export type OnHoldFeature = keyof typeof ON_HOLD;

/** True when the feature is switched on (not on hold). */
export function shown(feature: OnHoldFeature): boolean {
  return !ON_HOLD[feature];
}
