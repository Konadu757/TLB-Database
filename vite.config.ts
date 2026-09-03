import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    tsConfigPaths(),
    tailwindcss(),
    TanStackRouterVite({ autoCodeSplitting: true }),
    tanstackStart({ server: { entry: "server" } }),
    nitro({ preset: "vercel" }),
    react(),
  ],
});
