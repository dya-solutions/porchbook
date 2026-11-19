/** Porchbook Clinic: what people are believing God for. Each card is named by the answer, not the problem. */

export type ClinicTopic = {
  key: string;
  word: string;
  emoji: string;
  line: string;
  verse: string;
  ref: string;
  /** Words in a sermon's title that suggest it belongs here (for an admin's suggestions). */
  hints: string[];
};

export const CLINIC_TOPICS: ClinicTopic[] = [
  {
    key: "provision",
    word: "PROVISION",
    emoji: "🌾",
    line: "When money is tight",
    verse: "But my God shall supply all your need according to his riches in glory by Christ Jesus.",
    ref: "Philippians 4:19",
    hints: ["money", "provision", "provide", "finance", "financial", "wealth", "debt", "prosper", "prosperity", "supply", "riches", "rich", "poverty", "poor", "giving", "give", "tithe", "seed", "harvest", "abundance", "lack", "increase"],
  },
  {
    key: "health",
    word: "HEALTH",
    emoji: "🩺",
    line: "Healing and strength",
    verse: "But he was wounded for our transgressions, he was bruised for our iniquities: the chastisement of our peace was upon him; and with his stripes we are healed.",
    ref: "Isaiah 53:5",
    hints: ["heal", "healed", "healing", "health", "healthy", "sick", "sickness", "disease", "body", "cure", "strength", "life", "medicine", "pain"],
  },
  {
    key: "marriage",
    word: "MARRIAGE",
    emoji: "💍",
    line: "Building a godly home",
    verse: "And if one prevail against him, two shall withstand him; and a threefold cord is not quickly broken.",
    ref: "Ecclesiastes 4:12",
    hints: ["marriage", "married", "marry", "wife", "husband", "home", "family", "spouse", "relationship", "relationships", "children", "dating", "wedding", "courtship", "parents"],
  },
  {
    key: "faith",
    word: "FAITH",
    emoji: "📖",
    line: "When it's hard to believe",
    verse: "But without faith it is impossible to please him: for he that cometh to God must believe that he is, and that he is a rewarder of them that diligently seek him.",
    ref: "Hebrews 11:6",
    hints: ["faith", "believe", "believing", "belief", "trust", "doubt", "confidence", "word"],
  },
  {
    key: "prayer",
    word: "PRAYER",
    emoji: "🙏",
    line: "",
    verse: "Call unto me, and I will answer thee, and shew thee great and mighty things, which thou knowest not.",
    ref: "Jeremiah 33:3",
    hints: ["prayer", "prayers", "pray", "praying", "intercession", "intercede", "fasting", "fast", "altar", "communion", "fellowship", "tongues", "worship"],
  },
  {
    key: "serving",
    word: "SERVING",
    emoji: "🛠",
    line: "Using your gifts for God",
    verse: "For, brethren, ye have been called unto liberty; only use not liberty for an occasion to the flesh, but by love serve one another.",
    ref: "Galatians 5:13",
    hints: ["serve", "serving", "service", "servant", "ministry", "minister", "gift", "gifts", "usher", "labour", "labor", "kingdom", "work of god", "volunteer"],
  },
  {
    key: "submission",
    word: "SUBMISSION",
    emoji: "🧎",
    line: "Yielding to God's way",
    verse: "Submit yourselves therefore to God. Resist the devil, and he will flee from you.",
    ref: "James 4:7",
    hints: ["submit", "submission", "obey", "obedience", "surrender", "yield", "humble", "humility", "honour", "honor", "authority", "lordship"],
  },
  {
    key: "purpose",
    word: "PURPOSE",
    emoji: "🔭",
    line: "Finding your direction",
    verse: "For I know the thoughts that I think toward you, saith the LORD, thoughts of peace, and not of evil, to give you an expected end.",
    ref: "Jeremiah 29:11",
    hints: ["purpose", "destiny", "direction", "calling", "called", "vision", "plan", "plans", "future", "will", "assignment", "guidance", "leading", "leadership"],
  },
];

export const TOPIC_KEYS = new Set(CLINIC_TOPICS.map((t) => t.key));

export function topicOf(key: string) {
  return CLINIC_TOPICS.find((t) => t.key === key) ?? null;
}

function words(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Does this sermon title sound like it belongs to the topic? */
export function titleSuits(title: string, topic: ClinicTopic) {
  const have = new Set(words(title));
  const text = ` ${words(title).join(" ")} `;
  return topic.hints.some((hint) => (hint.includes(" ") ? text.includes(` ${hint} `) : have.has(hint)));
}
