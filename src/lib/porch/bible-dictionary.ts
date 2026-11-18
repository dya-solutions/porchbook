export type DictEntry = {
  word: string;
  pronunciation: string;
  definition: string;
  synonyms: string[];
  references: string[];
  related: string[];
  strong: string;
};

/** Short study notes written for Porchbook. Strong's numbers are left open for a later lexicon. */
export const DICTIONARY: DictEntry[] = [
  { word: "God", pronunciation: "god", definition: "The one living God, maker of heaven and earth, who speaks, saves, and keeps his people.", synonyms: ["Lord", "Maker"], references: ["Genesis 1:1", "John 1:1"], related: ["Lord", "Word", "Spirit"], strong: "" },
  { word: "Lord", pronunciation: "lord", definition: "A title of rule and honour. In the Old Testament it often stands for the personal name of God.", synonyms: ["God", "Master"], references: ["Psalm 23:1"], related: ["God", "Shepherd"], strong: "" },
  { word: "Jesus", pronunciation: "JEE-zus", definition: "The name of the Son of God, meaning the one who saves.", synonyms: ["Christ", "Saviour"], references: ["Matthew 1:21"], related: ["Christ", "Son", "Saviour"], strong: "" },
  { word: "Christ", pronunciation: "kryst", definition: "The Anointed One. The title of Jesus as the promised king and saviour.", synonyms: ["Messiah", "Anointed"], references: ["John 1:41"], related: ["Jesus", "Messiah", "King"], strong: "" },
  { word: "Messiah", pronunciation: "meh-SY-ah", definition: "The promised Anointed One of Israel, fulfilled in Jesus.", synonyms: ["Christ"], references: ["John 1:41"], related: ["Christ", "Jesus"], strong: "" },
  { word: "Word", pronunciation: "wurd", definition: "What God says. In John, the Word is the Son, who was with God and is God, and who became flesh.", synonyms: ["saying"], references: ["John 1:1", "John 1:14"], related: ["God", "Son", "Gospel"], strong: "" },
  { word: "Son", pronunciation: "sun", definition: "A male child. In Scripture it is also the title of Jesus, the only Son of the Father.", synonyms: ["child"], references: ["John 3:16"], related: ["Father", "Jesus"], strong: "" },
  { word: "Father", pronunciation: "FAH-ther", definition: "A parent. For Jesus, the Father is God, to whom he belongs and whom he makes known.", synonyms: ["parent"], references: ["John 3:16"], related: ["Son", "God"], strong: "" },
  { word: "Spirit", pronunciation: "SPIH-rit", definition: "The Holy Spirit, the personal presence of God who gives life, speaks, and dwells with his people.", synonyms: ["Holy Ghost"], references: ["John 3:5", "Genesis 1:2"], related: ["God", "Holy"], strong: "" },
  { word: "Holy", pronunciation: "HOH-lee", definition: "Set apart for God. Pure, and belonging to him.", synonyms: ["sacred"], references: ["Isaiah 6:3"], related: ["Spirit", "God"], strong: "" },
  { word: "beginning", pronunciation: "beh-GIN-ing", definition: "The first moment. Genesis and John both open before the world was made.", synonyms: ["start"], references: ["Genesis 1:1", "John 1:1"], related: ["created", "Word"], strong: "" },
  { word: "created", pronunciation: "kree-AY-ted", definition: "Made by God out of nothing, by his word.", synonyms: ["made"], references: ["Genesis 1:1"], related: ["God", "heaven", "earth"], strong: "" },
  { word: "heaven", pronunciation: "HEV-en", definition: "The sky God made, and also the dwelling of God.", synonyms: ["sky"], references: ["Genesis 1:1"], related: ["earth", "God"], strong: "" },
  { word: "earth", pronunciation: "urth", definition: "The world God made, and the ground under our feet.", synonyms: ["world", "land"], references: ["Genesis 1:1"], related: ["heaven", "world"], strong: "" },
  { word: "world", pronunciation: "wurld", definition: "The created order, and the people who live in it. God loved the world and gave his Son for it.", synonyms: ["earth"], references: ["John 3:16"], related: ["earth", "love"], strong: "" },
  { word: "loved", pronunciation: "luvd", definition: "The past of love. God set his love on the world and acted to save it.", synonyms: ["love"], references: ["John 3:16"], related: ["love", "world", "gave"], strong: "" },
  { word: "love", pronunciation: "luv", definition: "God's settled goodwill that gives and does not let go. It is also the love he calls his people to show.", synonyms: ["charity"], references: ["John 3:16", "1 John 4:8"], related: ["grace", "mercy"], strong: "" },
  { word: "gave", pronunciation: "gayv", definition: "Handed over as a gift. The Father gave his Son.", synonyms: ["given"], references: ["John 3:16"], related: ["Son", "love"], strong: "" },
  { word: "begotten", pronunciation: "beh-GOT-en", definition: "Brought forth as a son. Jesus is the only Son who comes from the Father.", synonyms: ["only"], references: ["John 3:16"], related: ["Son", "Father"], strong: "" },
  { word: "whosoever", pronunciation: "hoo-SO-ev-er", definition: "Any person at all. The gift is not kept for one group.", synonyms: ["whoever"], references: ["John 3:16"], related: ["believe"], strong: "" },
  { word: "believeth", pronunciation: "beh-LEE-veth", definition: "Trusts. To believe in the Son is to rely on him, not only to agree that he exists.", synonyms: ["believe", "trust"], references: ["John 3:16"], related: ["believe", "faith"], strong: "" },
  { word: "believe", pronunciation: "beh-LEEV", definition: "To trust God and rest on what he has said and done.", synonyms: ["trust", "faith"], references: ["John 3:16"], related: ["faith", "believeth"], strong: "" },
  { word: "faith", pronunciation: "fayth", definition: "Trust in God. Hebrews calls it the substance of things hoped for and the evidence of things not seen.", synonyms: ["trust", "belief"], references: ["Hebrews 11:1", "Romans 10:17"], related: ["believe", "hope"], strong: "" },
  { word: "substance", pronunciation: "SUB-stans", definition: "What is real and stands under something. Faith treats God's promise as already solid.", synonyms: ["reality"], references: ["Hebrews 11:1"], related: ["faith", "hope"], strong: "" },
  { word: "hope", pronunciation: "hohp", definition: "A sure waiting, because God has promised. It is not a guess.", synonyms: ["expectation"], references: ["Hebrews 11:1"], related: ["faith"], strong: "" },
  { word: "hoped", pronunciation: "hohpt", definition: "Looked ahead with trust to what God had promised.", synonyms: ["hope"], references: ["Hebrews 11:1"], related: ["hope", "faith"], strong: "" },
  { word: "evidence", pronunciation: "EV-i-dens", definition: "Proof that convinces. Faith is the proof, inside the believer, of what is not yet seen.", synonyms: ["proof"], references: ["Hebrews 11:1"], related: ["faith", "seen"], strong: "" },
  { word: "seen", pronunciation: "seen", definition: "Looked at with the eyes. Faith holds what the eyes have not yet been shown.", synonyms: ["visible"], references: ["Hebrews 11:1"], related: ["faith"], strong: "" },
  { word: "hearing", pronunciation: "HEER-ing", definition: "Listening so that the word can be received. Faith comes by hearing the word of God.", synonyms: ["listening"], references: ["Romans 10:17"], related: ["faith", "word"], strong: "" },
  { word: "word", pronunciation: "wurd", definition: "The message God speaks, especially the gospel that is preached and written.", synonyms: ["message"], references: ["Romans 10:17", "John 1:1"], related: ["Word", "Gospel", "faith"], strong: "" },
  { word: "perish", pronunciation: "PAIR-ish", definition: "To be lost and ruined. Those who trust the Son do not perish.", synonyms: ["lost"], references: ["John 3:16"], related: ["life", "saved"], strong: "" },
  { word: "life", pronunciation: "lyf", definition: "Being alive. Everlasting life is God's own life, given and not taken away.", synonyms: ["living"], references: ["John 3:16", "John 1:4"], related: ["light", "saved"], strong: "" },
  { word: "everlasting", pronunciation: "ev-er-LAS-ting", definition: "Without end. The life God gives does not run out.", synonyms: ["eternal"], references: ["John 3:16"], related: ["life"], strong: "" },
  { word: "eternal", pronunciation: "ee-TER-nal", definition: "Lasting forever, as God lasts.", synonyms: ["everlasting"], references: ["John 3:16"], related: ["life", "God"], strong: "" },
  { word: "light", pronunciation: "lyte", definition: "What lets us see. The Word is the light of people, and the darkness did not overcome it.", synonyms: ["brightness"], references: ["John 1:4"], related: ["Word", "life"], strong: "" },
  { word: "shepherd", pronunciation: "SHEP-erd", definition: "One who leads, feeds, and guards sheep. The Lord is the shepherd of his people.", synonyms: ["pastor"], references: ["Psalm 23:1"], related: ["Lord", "sheep"], strong: "" },
  { word: "sheep", pronunciation: "sheep", definition: "The flock a shepherd keeps. Scripture uses sheep for God's people.", synonyms: ["flock"], references: ["Psalm 23:1"], related: ["shepherd"], strong: "" },
  { word: "grace", pronunciation: "grayss", definition: "God's kindness given freely, not earned. We are saved by grace.", synonyms: ["favour", "kindness"], references: ["Ephesians 2:8"], related: ["mercy", "saved"], strong: "" },
  { word: "mercy", pronunciation: "MER-see", definition: "Kindness toward someone who needs it. God does not give his people what their sin deserves.", synonyms: ["compassion"], references: ["Psalm 23:6"], related: ["grace", "forgive"], strong: "" },
  { word: "sin", pronunciation: "sin", definition: "Turning from God's way. It is missing what he asked, and guilt before him.", synonyms: ["iniquity", "transgression"], references: ["Romans 3:23"], related: ["iniquity", "forgive", "repent"], strong: "" },
  { word: "iniquity", pronunciation: "in-IK-wih-tee", definition: "Twisted wrong. Sin that bends what God made straight.", synonyms: ["sin"], references: ["Psalm 51:2"], related: ["sin", "transgression"], strong: "" },
  { word: "transgression", pronunciation: "trans-GRESH-un", definition: "Stepping over a line God has drawn.", synonyms: ["sin"], references: ["Psalm 32:1"], related: ["sin", "law"], strong: "" },
  { word: "repent", pronunciation: "reh-PENT", definition: "To turn around. To leave sin and come back to God.", synonyms: ["turn"], references: ["Acts 2:38"], related: ["sin", "forgive"], strong: "" },
  { word: "forgive", pronunciation: "for-GIV", definition: "To let the debt of sin go, and not hold it against a person.", synonyms: ["pardon"], references: ["1 John 1:9"], related: ["mercy", "sin"], strong: "" },
  { word: "saved", pronunciation: "sayvd", definition: "Rescued by God from sin and death, and brought into his life.", synonyms: ["salvation"], references: ["Ephesians 2:8"], related: ["grace", "salvation"], strong: "" },
  { word: "salvation", pronunciation: "sal-VAY-shun", definition: "God's rescue. He saves a person and keeps them as his own.", synonyms: ["saved"], references: ["Romans 1:16"], related: ["saved", "grace", "gospel"], strong: "" },
  { word: "gospel", pronunciation: "GOS-pel", definition: "The good news of Jesus: his death, his rising, and the welcome God gives through him.", synonyms: ["good news"], references: ["Romans 1:16"], related: ["word", "salvation"], strong: "" },
  { word: "righteousness", pronunciation: "RY-chus-ness", definition: "Being right with God. It is his gift, not a record we build.", synonyms: ["rightness"], references: ["Romans 1:17"], related: ["faith", "justification"], strong: "" },
  { word: "justification", pronunciation: "jus-tih-fih-KAY-shun", definition: "God counting a person right with him, because of Jesus, received by faith.", synonyms: ["righteousness"], references: ["Romans 5:1"], related: ["righteousness", "faith"], strong: "" },
  { word: "covenant", pronunciation: "KUV-eh-nent", definition: "A binding promise God makes, and keeps, with his people.", synonyms: ["promise"], references: ["Genesis 17:7"], related: ["law", "blood"], strong: "" },
  { word: "law", pronunciation: "law", definition: "What God commanded, especially through Moses. It shows his will and our need.", synonyms: ["command"], references: ["Psalm 19:7"], related: ["covenant"], strong: "" },
  { word: "prayer", pronunciation: "prair", definition: "Speaking with God: asking, thanking, confessing, and staying near him.", synonyms: ["asking"], references: ["Matthew 6:9"], related: ["worship", "praise"], strong: "" },
  { word: "worship", pronunciation: "WER-ship", definition: "Giving God the honour that belongs to him, with the life as well as the mouth.", synonyms: ["praise"], references: ["John 4:24"], related: ["praise", "prayer"], strong: "" },
  { word: "praise", pronunciation: "prayz", definition: "Telling how great God is, out loud and with the life.", synonyms: ["worship"], references: ["Psalm 150:6"], related: ["worship"], strong: "" },
  { word: "kingdom", pronunciation: "KING-dum", definition: "The rule of God. Jesus announced that God's kingdom had come near.", synonyms: ["reign"], references: ["Mark 1:15"], related: ["King", "heaven"], strong: "" },
  { word: "King", pronunciation: "king", definition: "The one who rules. Jesus is the king God promised.", synonyms: ["Christ"], references: ["John 1:49"], related: ["kingdom", "Christ"], strong: "" },
  { word: "cross", pronunciation: "kross", definition: "The wooden cross on which Jesus died, and the death by which he bore sin.", synonyms: ["tree"], references: ["1 Corinthians 1:18"], related: ["blood", "saved"], strong: "" },
  { word: "blood", pronunciation: "blud", definition: "Life poured out. The blood of Jesus is the price of forgiveness.", synonyms: ["life"], references: ["Hebrews 9:22"], related: ["cross", "covenant", "forgive"], strong: "" },
  { word: "resurrection", pronunciation: "rez-uh-REK-shun", definition: "Being raised from the dead. God raised Jesus, and will raise his people.", synonyms: ["rising"], references: ["1 Corinthians 15:20"], related: ["life", "death"], strong: "" },
  { word: "death", pronunciation: "deth", definition: "The end of this life, and the wage of sin. Christ has broken its hold.", synonyms: ["dying"], references: ["Romans 6:23"], related: ["life", "resurrection"], strong: "" },
  { word: "church", pronunciation: "church", definition: "The people God has called together in Christ, not a building.", synonyms: ["assembly"], references: ["Matthew 16:18"], related: ["disciple"], strong: "" },
  { word: "disciple", pronunciation: "dih-SY-pul", definition: "A learner who follows Jesus and does what he says.", synonyms: ["follower"], references: ["Matthew 28:19"], related: ["apostle", "church"], strong: "" },
  { word: "apostle", pronunciation: "uh-POS-ul", definition: "One who is sent. The apostles were witnesses Jesus sent with the gospel.", synonyms: ["messenger"], references: ["Ephesians 2:20"], related: ["disciple", "gospel"], strong: "" },
  { word: "angel", pronunciation: "AYN-jel", definition: "A messenger of God, a spirit he sends.", synonyms: ["messenger"], references: ["Luke 1:26"], related: ["heaven"], strong: "" },
  { word: "prophet", pronunciation: "PROF-it", definition: "A person God sends to speak his word.", synonyms: ["seer"], references: ["Deuteronomy 18:18"], related: ["word"], strong: "" },
  { word: "peace", pronunciation: "peess", definition: "Wholeness with God. Not only a quiet feeling, but the quarrel ended.", synonyms: ["rest"], references: ["John 14:27"], related: ["grace"], strong: "" },
  { word: "joy", pronunciation: "joy", definition: "A gladness that stands even when the day is hard, because God is faithful.", synonyms: ["gladness"], references: ["John 15:11"], related: ["peace", "hope"], strong: "" },
  { word: "wisdom", pronunciation: "WIZ-dum", definition: "Seeing life as God sees it, and walking that way.", synonyms: ["understanding"], references: ["Proverbs 9:10"], related: ["fear"], strong: "" },
  { word: "fear", pronunciation: "feer", definition: "In Scripture, the fear of the Lord is awe and obedience, not panic.", synonyms: ["awe"], references: ["Proverbs 9:10"], related: ["wisdom", "Lord"], strong: "" },
  { word: "trust", pronunciation: "trust", definition: "Leaning your weight on God.", synonyms: ["faith", "believe"], references: ["Proverbs 3:5"], related: ["faith", "believe"], strong: "" },
  { word: "heart", pronunciation: "hart", definition: "The inner person: mind, will, and desire.", synonyms: ["inner person"], references: ["Proverbs 4:23"], related: ["soul"], strong: "" },
  { word: "soul", pronunciation: "sohl", definition: "The living person. God made us body and soul, and he keeps the soul.", synonyms: ["life"], references: ["Psalm 23:3"], related: ["heart", "life"], strong: "" },
  { word: "truth", pronunciation: "trooth", definition: "What is real, and what God says. Jesus called himself the truth.", synonyms: ["reality"], references: ["John 14:6"], related: ["Word"], strong: "" },
  { word: "glory", pronunciation: "GLOH-ree", definition: "The weight and brightness of who God is, shown so that he is honoured.", synonyms: ["honour"], references: ["John 1:14"], related: ["God", "worship"], strong: "" },
  { word: "power", pronunciation: "POW-er", definition: "The strength of God to do what he says, including raising the dead.", synonyms: ["strength"], references: ["Romans 1:16"], related: ["gospel", "Spirit"], strong: "" },
  { word: "baptism", pronunciation: "BAP-tiz-um", definition: "Washing with water that marks a person as belonging to Jesus.", synonyms: ["washing"], references: ["Matthew 28:19"], related: ["disciple", "water"], strong: "" },
  { word: "water", pronunciation: "WAW-ter", definition: "The water God made. It is also the sign of cleansing and of the river of life.", synonyms: ["river"], references: ["Revelation 22:1"], related: ["life", "baptism"], strong: "" },
  { word: "river", pronunciation: "RIV-er", definition: "A flowing stream. Revelation shows a river of the water of life from the throne of God.", synonyms: ["stream"], references: ["Revelation 22:1"], related: ["water", "life", "throne"], strong: "" },
  { word: "throne", pronunciation: "throhn", definition: "The seat of a king. God's throne is his rule.", synonyms: ["seat"], references: ["Revelation 22:1"], related: ["King", "kingdom"], strong: "" },
  { word: "sabbath", pronunciation: "SAB-ath", definition: "The seventh day, which God set apart for rest.", synonyms: ["rest"], references: ["Genesis 2:2"], related: ["holy"], strong: "" },
  { word: "temple", pronunciation: "TEM-pul", definition: "The house where God met his people. Jesus spoke of his body as the temple.", synonyms: ["house"], references: ["John 2:19"], related: ["altar", "worship"], strong: "" },
  { word: "altar", pronunciation: "AWL-ter", definition: "The place where a sacrifice was offered to God.", synonyms: ["place of offering"], references: ["Genesis 8:20"], related: ["sacrifice", "temple"], strong: "" },
  { word: "sacrifice", pronunciation: "SAK-rih-fyss", definition: "A gift offered to God, often a life given in place of another. Jesus is the final sacrifice.", synonyms: ["offering"], references: ["Hebrews 10:12"], related: ["blood", "altar"], strong: "" },
  { word: "atonement", pronunciation: "uh-TOHN-ment", definition: "The act that covers sin and makes a person at one with God.", synonyms: ["covering"], references: ["Romans 5:11"], related: ["sacrifice", "blood"], strong: "" },
  { word: "redemption", pronunciation: "reh-DEMP-shun", definition: "Being bought back and set free. Christ redeemed his people.", synonyms: ["ransom"], references: ["Ephesians 1:7"], related: ["blood", "saved"], strong: "" },
  { word: "bless", pronunciation: "bless", definition: "To speak good from God over someone, or to praise God for his goodness.", synonyms: ["favour"], references: ["Numbers 6:24"], related: ["praise"], strong: "" },
  { word: "neighbour", pronunciation: "NAY-ber", definition: "The person near you, whom Jesus said to love as yourself.", synonyms: ["neighbor"], references: ["Mark 12:31"], related: ["love", "brother"], strong: "" },
  { word: "brother", pronunciation: "BRUH-ther", definition: "A male sibling, and also a fellow believer.", synonyms: ["kinsman"], references: ["1 John 4:20"], related: ["love", "church"], strong: "" },
  { word: "servant", pronunciation: "SER-vant", definition: "One who serves. Jesus served, and he calls his people servants and friends.", synonyms: ["slave"], references: ["Mark 10:45"], related: ["disciple"], strong: "" },
];

const byWord = new Map<string, DictEntry>();
for (const entry of DICTIONARY) byWord.set(entry.word.toLowerCase(), entry);

export function dictionaryWord(raw: string): DictEntry | null {
  const cleaned = raw.toLowerCase().replace(/[^a-z]/g, "");
  if (!cleaned) return null;
  if (byWord.has(cleaned)) return byWord.get(cleaned) ?? null;
  const stems = [cleaned.replace(/est$/, ""), cleaned.replace(/eth$/, ""), cleaned.replace(/ed$/, ""), cleaned.replace(/ing$/, ""), cleaned.replace(/es$/, ""), cleaned.replace(/s$/, "")];
  for (const stem of stems) {
    if (stem.length > 2 && byWord.has(stem)) return byWord.get(stem) ?? null;
  }
  return null;
}

export function searchDictionary(raw: string): DictEntry[] {
  const needle = raw.trim().toLowerCase();
  if (!needle) return [];
  const exact: DictEntry[] = [];
  const partial: DictEntry[] = [];
  for (const entry of DICTIONARY) {
    const word = entry.word.toLowerCase();
    if (word === needle) exact.push(entry);
    else if (word.includes(needle)) partial.push(entry);
  }
  return [...exact, ...partial].slice(0, 40);
}
