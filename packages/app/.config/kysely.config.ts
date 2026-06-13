import { defineConfig } from "kysely-ctl";
import { dialect } from "../src/server/db";

export default defineConfig({
  dialect,
});
