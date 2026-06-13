import { deckRouter } from "./decks";
import { sessionRouter } from "./sessions";
import { versusRouter } from "./versus";

/** The game framework router. `decks` is the shared content layer, `sessions`
 *  the shared lobby lifecycle; per-game modules (versus today, future
 *  rating/tierlist) plug in their own mechanic procedures. */
export const gameRouter = {
  decks: deckRouter,
  sessions: sessionRouter,
  versus: versusRouter,
};
