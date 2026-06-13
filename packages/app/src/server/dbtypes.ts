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

export interface Images {
  id: Generated<string>;
  path: string;
  /** JSON: { name, type, size } of the original upload. */
  metadata: unknown;
  user_id: string;
  created_at: Generated<Timestamp>;
}

export interface DB {
  images: Images;
  users: Users;
  sessions: Sessions;
  accounts: Accounts;
  verifications: Verifications;
}
