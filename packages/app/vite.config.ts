import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Centralized env: read .env / .env.${mode} from packages/.
  envDir: "..",
  server: {
    port: 3300,
  },
  plugins: [
    tsConfigPaths({
      projects: ["./tsconfig.json"],
    }),
    tanstackStart(),
    nitro({
      features: { websocket: true },
      handlers: [
        {
          route: "/api/rpc-ws",
          handler: fileURLToPath(
            new URL("./src/server/ws/rpcHandler.ts", import.meta.url),
          ),
        },
      ],
    }),
    react(),
    tailwindcss(),
  ],
});
