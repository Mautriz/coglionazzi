/** Rendering for the MCP tools. Everything here is PURE so it can be tested
 *  without a database — the shapes mirror what `board.getCard` and `chat.open`
 *  return, narrowed to the fields a reader actually needs. */

export interface TaskAttachment {
  id: string;
  /** Storage id — what `get_attachment` takes. */
  path: string;
  name: string;
  type: string;
}

export interface TaskRelation {
  cardId: string;
  title: string;
  kind: "blocks" | "blocked_by" | "related";
}

export interface TaskCard {
  id: string;
  title: string;
  description_text: string | null;
  tags: string[] | null;
  boardName: string | null;
  columnName: string | null;
  archived_at: Date | null;
  archived_origin: string | null;
  created_at: Date;
  assignees: { id: string; name: string }[];
  relations: TaskRelation[];
  attachments: TaskAttachment[];
}

export interface TaskComment {
  id: string;
  /** null = a support-room customer message (see the chat model). */
  authorName: string | null;
  body_text: string | null;
  created_at: Date;
}

const RELATION_LABELS: Record<TaskRelation["kind"], string> = {
  blocks: "blocks",
  blocked_by: "blocked by",
  related: "related to",
};

const day = (date: Date): string => date.toISOString().slice(0, 10);

/** One markdown document carrying EVERYTHING about a task: fields, body,
 *  discussion, attachments and relations.
 *
 *  The point is that assigning a task costs one tool call rather than five —
 *  so this deliberately inlines the comments and the attachment list instead
 *  of returning ids to chase. */
export function renderTask(card: TaskCard, comments: TaskComment[]): string {
  const lines: string[] = [];

  lines.push(`# ${card.title}`);
  lines.push("");
  lines.push(`- Task id: \`${card.id}\``);

  if (card.archived_at) {
    lines.push(
      `- **Archived** on ${day(card.archived_at)}${
        card.archived_origin ? ` (was in ${card.archived_origin})` : ""
      }`,
    );
  } else if (card.boardName || card.columnName) {
    lines.push(
      `- Board: ${card.boardName ?? "—"} / Column: ${card.columnName ?? "—"}`,
    );
  }

  if (card.tags?.length) lines.push(`- Tags: ${card.tags.join(", ")}`);

  lines.push(
    `- Assignees: ${
      card.assignees.length
        ? card.assignees.map((a) => a.name).join(", ")
        : "nobody"
    }`,
  );
  lines.push(`- Created: ${day(card.created_at)}`);

  if (card.relations.length) {
    lines.push("");
    lines.push("## Relations");
    for (const relation of card.relations) {
      lines.push(
        `- This task ${RELATION_LABELS[relation.kind]} “${relation.title}” (\`${relation.cardId}\`)`,
      );
    }
  }

  lines.push("");
  lines.push("## Description");
  lines.push(card.description_text?.trim() || "_No description._");

  lines.push("");
  lines.push(`## Comments (${comments.length})`);
  if (comments.length === 0) {
    lines.push("_No comments._");
  } else {
    for (const message of comments) {
      // A null author is the customer side of a support room.
      const who = message.authorName ?? "Customer";
      lines.push(`- **${who}** (${day(message.created_at)}): ${
        message.body_text?.trim() || "_(empty)_"
      }`);
    }
  }

  lines.push("");
  lines.push(`## Attachments (${card.attachments.length})`);
  if (card.attachments.length === 0) {
    lines.push("_No attachments._");
  } else {
    for (const attachment of card.attachments) {
      lines.push(
        `- ${attachment.name} (${attachment.type}) — id \`${attachment.path}\``,
      );
    }
    lines.push("");
    lines.push(
      "Read one with the `get_attachment` tool, passing the id above.",
    );
  }

  return lines.join("\n");
}

/** Compact one-line summary used by the list/search tools, where the point is
 *  scanning many tasks rather than reading one. */
export function renderTaskLine(card: {
  id: string;
  title: string;
  tags: string[] | null;
  assignees: { name: string }[];
}): string {
  const bits = [`\`${card.id}\``, card.title];
  if (card.tags?.length) bits.push(`[${card.tags.join(", ")}]`);
  if (card.assignees.length) {
    bits.push(`→ ${card.assignees.map((a) => a.name).join(", ")}`);
  }
  return `- ${bits.join(" · ")}`;
}
