import { sql } from "kysely";
import { z } from "zod";
import { db } from "../db";
import { authP } from "./base";
import { myTeamIds } from "./teamAccess";

/** Global fuzzy search across boards, card titles, card descriptions and
 *  comments. pg_trgm powers it: `ILIKE %q%` catches exact substrings,
 *  `word_similarity` catches typos; both ride the GIN trigram indexes.
 *  Ranked by word_similarity so closer matches float up. */

const LIMIT_PER_KIND = 8;

/** Substring OR fuzzy word match, as a reusable SQL fragment. The explicit
 *  word_similarity threshold (instead of the `<%` operator) is deliberately
 *  looser than pg_trgm's 0.6 default — multi-word typo queries like
 *  "birra artiganali" score ~0.59. Junk queries score ~0, so 0.45 keeps
 *  precision; the ILIKE leg still rides the GIN trigram index. */
const FUZZY_THRESHOLD = 0.45;

function matches(q: string, col: string) {
  const ref = sql.ref(col);
  return sql<boolean>`(${ref} ilike ${"%" + q + "%"} or word_similarity(${q}, ${ref}) >= ${FUZZY_THRESHOLD})`;
}

function rank(q: string, col: string) {
  return sql<number>`word_similarity(${q}, ${sql.ref(col)})`;
}

/** ±60 chars of context around the first hit, for result subtitles. */
function snippet(text: string, q: string): string {
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return text.slice(0, 120);
  const start = Math.max(0, idx - 40);
  const end = Math.min(text.length, idx + q.length + 80);
  return (
    (start > 0 ? "…" : "") +
    text.slice(start, end).replaceAll("\n", " ") +
    (end < text.length ? "…" : "")
  );
}

export const searchRouter = {
  global: authP
    .input(z.object({ query: z.string().trim().min(2).max(100) }))
    .handler(async (info) => {
      const q = info.input.query;
      // Results are scoped to the caller's teams.
      const teamIds = await myTeamIds(info.context.user.id);
      if (teamIds.length === 0) {
        return { boards: [], cards: [], comments: [] };
      }

      const [boards, cards, comments] = await Promise.all([
        db
          .selectFrom("boards")
          .where("boards.team_id", "in", teamIds)
          .where(matches(q, "boards.name"))
          .select(["id", "name", rank(q, "boards.name").as("rank")])
          .orderBy("rank", "desc")
          .limit(LIMIT_PER_KIND)
          .execute(),

        db
          .selectFrom("cards")
          .innerJoin("board_columns", "board_columns.id", "cards.column_id")
          .innerJoin("boards", "boards.id", "board_columns.board_id")
          .where("boards.team_id", "in", teamIds)
          .where((eb) =>
            eb.or([
              matches(q, "cards.title"),
              matches(q, "cards.description_text"),
            ]),
          )
          .select([
            "cards.id",
            "cards.title",
            "cards.description_text",
            "boards.id as boardId",
            "boards.name as boardName",
            sql<number>`greatest(${rank(q, "cards.title")}, ${rank(q, "cards.description_text")})`.as(
              "rank",
            ),
          ])
          .orderBy("rank", "desc")
          .limit(LIMIT_PER_KIND)
          .execute(),

        db
          .selectFrom("comments")
          .innerJoin("cards", "cards.id", "comments.entity_id")
          .innerJoin("board_columns", "board_columns.id", "cards.column_id")
          .innerJoin("boards", "boards.id", "board_columns.board_id")
          .leftJoin("users", "users.id", "comments.created_by")
          .where("comments.entity_type", "=", "card")
          .where("boards.team_id", "in", teamIds)
          .where(matches(q, "comments.body_text"))
          .select([
            "comments.id",
            "comments.body_text",
            "cards.id as cardId",
            "cards.title as cardTitle",
            "boards.id as boardId",
            "boards.name as boardName",
            "users.name as author",
            rank(q, "comments.body_text").as("rank"),
          ])
          .orderBy("rank", "desc")
          .limit(LIMIT_PER_KIND)
          .execute(),
      ]);

      return {
        boards: boards.map((b) => ({ id: b.id, name: b.name })),
        cards: cards.map((c) => ({
          id: c.id,
          title: c.title,
          boardId: c.boardId,
          boardName: c.boardName,
          snippet: snippet(c.description_text, q),
        })),
        comments: comments.map((c) => ({
          id: c.id,
          cardId: c.cardId,
          cardTitle: c.cardTitle,
          boardId: c.boardId,
          boardName: c.boardName,
          author: c.author,
          snippet: snippet(c.body_text, q),
        })),
      };
    }),
};
