export const ROOMS = ["proclaim", "inform", "ask"] as const;
export const FILTERS = ["all", ...ROOMS] as const;
export const REACTIONS = ["care", "thanks", "insight", "cheer"] as const;

export type Room = (typeof ROOMS)[number];
export type FeedFilter = (typeof FILTERS)[number];
export type ReactionKind = (typeof REACTIONS)[number];

export type Profile = {
  userId: string;
  displayName: string;
  email: string | null;
  imageUrl: string | null;
  role: string;
  team: string;
  bio: string;
  spiritualIdentity: string;
  spiritualResponsibility: string;
  createdAt: string;
};

export type PublicProfile = Omit<Profile, "email">;

export type Comment = {
  id: number;
  postId: number;
  authorId: string;
  authorName: string;
  authorImage: string | null;
  body: string;
  createdAt: string;
  editedAt: string | null;
  reactions: ReactionSummary[];
  kept: boolean;
};

export type ReactionSummary = {
  kind: ReactionKind;
  count: number;
  mine: boolean;
};

export type Post = {
  id: number;
  room: Room;
  body: string;
  createdAt: string;
  editedAt: string | null;
  authorId: string;
  authorName: string;
  authorImage: string | null;
  authorRole: string;
  authorTeam: string;
  reactions: ReactionSummary[];
  noticed: string[];
  noticedCount: number;
  kept: boolean;
  locked: boolean;
  afloat: boolean;
  pinned: boolean;
  photo: string | null;
  comments: Comment[];
  // Inquire, asked of one person: only they answer, then everyone can join in.
  askedTo: { id: string; name: string } | null;
  answered: boolean;
};

export type FeedPage = {
  posts: Post[];
  hasMore: boolean;
  peopleCount: number;
  me: Profile;
};

export const CHAT_REACTS = ["❤️", "🙏", "👍", "😂"] as const;

export type ChatReact = { emoji: string; count: number; mine: boolean };

export type DirectMessage = {
  id: number;
  authorId: string;
  body: string;
  createdAt: string;
  mine: boolean;
  edited: boolean;
  deleted: boolean;
  replyTo: number | null;
  replyBody: string;
  starred: boolean;
  reactions: ChatReact[];
  canEdit: boolean;
  canDeleteAll: boolean;
};

export type ThreadPage = {
  profile: PublicProfile | null;
  messages: DirectMessage[];
  truncated: boolean;
  isSelf: boolean;
  responding: boolean;
  pinned: { id: number; body: string } | null;
};

export type ThreadSummary = {
  otherUserId: string;
  otherName: string;
  otherImage: string | null;
  otherRole: string;
  otherTeam: string;
  lastBody: string;
  lastAt: string;
  lastMine: boolean;
  unread: number;
};

export type ProfilePost = {
  id: number;
  room: Room;
  body: string;
  createdAt: string;
  commentCount: number;
  reactionCount: number;
  photo: string | null;
};

export type PersonPage = {
  profile: Profile | null;
  posts: ProfilePost[];
  isSelf: boolean;
};

export type Seed = {
  displayName: string;
  email: string | null;
  imageUrl: string | null;
};

export const ROOM_META: Record<
  Room,
  { label: string; hint: string; placeholder: string; idle: string; on: string; mark: string; rule: string }
> = {
  proclaim: {
    label: "Inspire",
    hint: "Break bread🍞",
    placeholder: "Break bread🍞",
    idle: "text-ink",
    on: "bg-pine text-on-pine",
    mark: "text-ink",
    rule: "border-l-4 border-l-pine",
  },
  inform: {
    label: "Inform",
    hint: "Make it known📢",
    placeholder: "Make it known📢",
    idle: "text-post",
    on: "bg-post text-on-pine",
    mark: "text-post",
    rule: "border-l-4 border-l-post",
  },
  ask: {
    label: "Inquire",
    hint: "Enlighten me💡",
    placeholder: "Enlighten me💡",
    idle: "text-muted",
    on: "green-weave text-on-pine",
    mark: "text-muted",
    rule: "border-l-4 border-l-muted",
  },
};

export const FILTER_META: Record<FeedFilter, { label: string }> = {
  all: { label: "All" },
  proclaim: { label: "Inspire" },
  inform: { label: "Inform" },
  ask: { label: "Inquire" },
};

export const REACTION_META: Record<ReactionKind, { label: string }> = {
  care: { label: "Love" },
  thanks: { label: "Like" },
  insight: { label: "Touching" },
  cheer: { label: "Deep" },
};

export const DETAIL_WORD_LIMIT = 50;

export function wordCount(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

export function clipWords(value: string, max = DETAIL_WORD_LIMIT): string {
  const collapsed = value.replace(/\s+/g, " ");
  const trailing = collapsed.endsWith(" ");
  const words = collapsed.trim().split(" ").filter(Boolean).slice(0, max);
  if (words.length === 0) return "";
  const text = words.join(" ");
  return trailing && words.length < max ? `${text} ` : text;
}

export function formatWhen(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const seconds = Math.round((Date.now() - t) / 1000);
  if (seconds < 45) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
