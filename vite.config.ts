import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { VitePWA } from "vite-plugin-pwa";
import { configDefaults } from "vitest/config";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
  },
  // Production optimizations
  esbuild: {
    // CRITICAL FIX: Only drop logs/debug, KEEP errors and warnings for mobile debugging
    pure: mode === "production" ? ["console.log", "console.debug", "console.info"] : [],
    drop: mode === "production" ? ["debugger"] : [],
  },
  build: {
    // Source maps for error tracking in production
    sourcemap: mode === "production" ? "hidden" : true,
    // Optimize for production
    minify: mode === "production" ? "esbuild" : false,
    // Target modern browsers for smaller bundles
    target: "es2020",
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;

          // Core React/runtime stack
          if (
            id.includes("react-dom") ||
            id.includes("react-router") ||
            /node_modules\/react[/\\]/.test(id) ||
            id.includes("scheduler")
          ) return "vendor-react";

          // 3D rendering stack - granularly split for optimized FCP
          if (id.includes("@react-three")) return "vendor-three-fiber";
          if (id.includes("troika-three-text") || id.includes("postprocessing")) return "vendor-three-effects";
          if (/node_modules\/three[/\\]/.test(id)) return "vendor-three-core";

          // Data-viz stack
          if (id.includes("recharts") || id.includes("d3-")) return "vendor-charts";

          // PDF/export stack - granularly split for on-demand loading
          if (id.includes("jspdf")) return "vendor-jspdf";
          if (id.includes("html2canvas")) return "vendor-html2canvas";
          if (id.includes("html2pdf.js")) return "vendor-html2pdf";

          // Data/cache/network stacks
          if (id.includes("@supabase/supabase-js") || id.includes("@supabase/")) return "vendor-supabase";
          if (id.includes("@tanstack/react-query")) return "vendor-query";

          // i18n stack
          if (id.includes("i18next") || id.includes("react-i18next")) return "vendor-i18n";

          // Animation stack
          if (id.includes("framer-motion") || id.includes("motion-dom")) return "vendor-motion";

          return undefined;
        },
      },
    },
  },
  test: {
    exclude: [...configDefaults.exclude, "**/supabase/functions/spiral-ai/**/*.test.ts", "temp_repo/**/*.test.ts", "APEX-OmniHub/**/*.test.ts", "APEX-OmniHub/**/*.spec.ts"],
    setupFiles: [path.resolve(__dirname, "./src/setupTests.ts")],
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: [
        "icons/icon.svg",
        "icons/favicon-32x32.png",
        "icons/favicon-16x16.png",
        "icons/apple-touch-icon.png"
      ],
      manifest: {
        name: "aSpiral - Transform Confusion into Clarity",
        short_name: "aSpiral",
        description: "Voice-first AI coaching that visualizes your thoughts and guides you to breakthrough clarity",
        theme_color: "#4a1a6b",
        background_color: "#4a1a6b",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        id: "/",
        scope: "/",
        icons: [
          {
            src: "/icons/icon-192x192.png",
            sizes: "192x192",
            type: "image/png"
          },
          {
            src: "/icons/icon-512x512.png",
            sizes: "512x512",
            type: "image/png"
          },
          {
            src: "/icons/maskable-icon-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable"
          }
        ]
      },
      workbox: {
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        globIgnores: ["**/demo-video*", "**/aspiral-heromark*"],
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api/, /^\/supabase/],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-cache",
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-webfonts",
              expiration: {
                maxEntries: 30,
                maxAgeSeconds: 60 * 60 * 24 * 365
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          }
        ]
      }
    })
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
