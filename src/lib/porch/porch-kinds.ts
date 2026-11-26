// Porch types (decision 38): a Church, or a Ministry with a ministry type.
// To add a ministry type later, add one line to MINISTRY_TYPES. Nothing else needs to change.

export const PORCH_KINDS = [
  { key: "church", name: "Church", hint: "A congregation. It has members, who join with the church's invite code and its admins' yes." },
  { key: "ministry", name: "Ministry", hint: "Run by a team of admins, with followers. No members: it posts on the public porch." },
] as const;
export type PorchKind = (typeof PORCH_KINDS)[number]["key"];

export const MINISTRY_TYPES = [
  { key: "music", name: "Music" },
  { key: "teaching", name: "Teaching" },
  { key: "other", name: "Other" },
] as const;
export type MinistryType = (typeof MINISTRY_TYPES)[number]["key"];

/** A ministry's description: long enough to say what it does, short enough to read at a glance. */
export const DESCRIPTION_MIN = 20;
export const DESCRIPTION_MAX = 400;

export function kindName(kind: string): string {
  return PORCH_KINDS.find((item) => item.key === kind)?.name ?? "Porch";
}

/** "Music ministry", "Teaching ministry", or the name an "Other" ministry gave its type. */
export function ministryTypeName(type: string, other = ""): string {
  if (type === "other") return other.trim() || "Other";
  return MINISTRY_TYPES.find((item) => item.key === type)?.name ?? "";
}
