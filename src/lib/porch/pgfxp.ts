/**
 * pgfxp
 *
 * The porch guy is not in the app. These are his functions, kept by this name.
 * When the user says "pgfxp", put this list into the studio they have built.
 * Do not add the man. Do not build a second room unless they ask.
 *
 * - A screen that stays blank until something asks it to play.
 * - The Porchbook butterfly on that screen when nothing is playing. The wings move every 3 seconds.
 * - Events, worship, and office-walk videos open on that screen. Rhema Clip does not.
 * - A worship video fills the billboard. Next and Previous still move through that group.
 *   If that group has no other video, the same one plays again.
 * - The video keeps playing while the person looks around.
 * - Talk. He answers about Porchbook. He can greet and laugh. He does not do tasks.
 *   If asked to do one, he says: "sorry i cant handle that, but the team can assist you if you reach out to them through Feedback in the menu under your name at the top."
 * - The founder adds and removes worship links on the front billboard. Other people see the videos there.
 * - No walls, no ceiling, and no floor. The city model is the room.
 */
export const PGFXP = "pgfxp" as const;
