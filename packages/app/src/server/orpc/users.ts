import { db } from "../db";
import { authP } from "./base";

export const userRouter = {
  /** Everyone in the crew — assignee pickers etc. */
  list: authP.handler(async () => {
    return db
      .selectFrom("users")
      .select(["id", "name", "image"])
      .orderBy("name", "asc")
      .execute();
  }),
};
