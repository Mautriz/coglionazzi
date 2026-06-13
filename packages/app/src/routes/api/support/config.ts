import { createFileRoute } from "@tanstack/react-router";
import {
  errorResponse,
  jsonResponse,
  preflightResponse,
} from "../../../server/http";
import { listCategories, teamByWidgetKey } from "../../../server/support";

/** Public widget config: the team's display name + categories, so the widget
 *  can render the start form. Gated by the (public) widget key. */
export const Route = createFileRoute("/api/support/config")({
  server: {
    handlers: {
      OPTIONS: () => preflightResponse(),
      GET: async ({ request }) => {
        try {
          const widgetKey = new URL(request.url).searchParams.get("widgetKey");
          if (!widgetKey) return jsonResponse({ error: "Missing widgetKey" }, 400);
          const team = await teamByWidgetKey(widgetKey);
          const categories = await listCategories(team.id);
          return jsonResponse({
            teamName: team.name,
            categories: categories.map((c) => ({ id: c.id, name: c.name })),
          });
        } catch (err) {
          return errorResponse(err);
        }
      },
    },
  },
});
