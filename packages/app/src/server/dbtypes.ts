/**
 * Kysely DB types. Hand-written to match the better-auth migration for now;
 * regenerate from the live database with `npm run genDbTypes` (kysely-codegen
 * overwrites this file) after running migrations.
 */
import type { ColumnType } from "kysely";

export type Generated<T> =
  T extends ColumnType<infer S, infer I, infer U>
    ? ColumnType<S, I | undefined, U>
    : ColumnType<T, T | undefined, T>;

export type Timestamp = ColumnType<Date, Date | string, Date | string>;

export interface Users {
  id: string;
  name: string;
  email: string;
  email_verified: boolean;
  image: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface Sessions {
  id: string;
  expires_at: Timestamp;
  token: string;
  created_at: Timestamp;
  updated_at: Timestamp;
  ip_address: string | null;
  user_agent: string | null;
  user_id: string;
}

export interface Accounts {
  id: string;
  account_id: string;
  provider_id: string;
  user_id: string;
  access_token: string | null;
  refresh_token: string | null;
  id_token: string | null;
  access_token_expires_at: Timestamp | null;
  refresh_token_expires_at: Timestamp | null;
  scope: string | null;
  password: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface Verifications {
  id: string;
  identifier: string;
  value: string;
  expires_at: Timestamp;
  created_at: Timestamp | null;
  updated_at: Timestamp | null;
}

export interface Files {
  id: Generated<string>;
  path: string;
  /** JSON: { name, type, size } of the original upload. */
  metadata: unknown;
  user_id: string;
  created_at: Generated<Timestamp>;
}

export interface Boards {
  id: Generated<string>;
  name: string;
  team_id: string;
  created_by: string | null;
  created_at: Generated<Timestamp>;
}

export interface Teams {
  id: Generated<string>;
  name: string;
  created_by: string | null;
  created_at: Generated<Timestamp>;
}

export interface TeamMembers {
  team_id: string;
  user_id: string;
  role: Generated<"owner" | "member">;
  created_at: Generated<Timestamp>;
}

export interface BoardColumns {
  id: Generated<string>;
  board_id: string;
  name: string;
  position: number;
}

export interface Cards {
  id: Generated<string>;
  column_id: string;
  title: string;
  /** Serialized Lexical editor state (JSON). */
  description: unknown | null;
  /** Plain text extracted from `description` — search only. */
  description_text: Generated<string>;
  tags: Generated<string[]>;
  position: number;
  created_by: string | null;
  created_at: Generated<Timestamp>;
}

export interface Comments {
  id: Generated<string>;
  /** Commentable entity kind — see `commentEntityType` in the comments router. */
  entity_type: string;
  entity_id: string;
  /** Serialized Lexical editor state (JSON). */
  body: unknown;
  /** Plain text extracted from `body` — search only. */
  body_text: Generated<string>;
  created_by: string | null;
  created_at: Generated<Timestamp>;
}

export interface CardAttachments {
  card_id: string;
  file_id: string;
  created_at: Generated<Timestamp>;
}

export interface CardAssignees {
  card_id: string;
  user_id: string;
  created_at: Generated<Timestamp>;
}

/** Card↔card relation. kind 'related' is undirected (rows normalized with
 *  card_id < related_card_id); kind 'blocks' is directed (card_id blocks
 *  related_card_id). */
export interface CardRelations {
  card_id: string;
  related_card_id: string;
  kind: Generated<"related" | "blocks">;
  created_at: Generated<Timestamp>;
}

export interface DB {
  comments: Comments;
  files: Files;
  boards: Boards;
  teams: Teams;
  team_members: TeamMembers;
  board_columns: BoardColumns;
  cards: Cards;
  card_attachments: CardAttachments;
  card_assignees: CardAssignees;
  card_relations: CardRelations;
  users: Users;
  sessions: Sessions;
  accounts: Accounts;
  verifications: Verifications;
}
