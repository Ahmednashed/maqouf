import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: "#EF4444",
        ink: "#111827",
        mist: "#F8FAFC",
        line: "#E5E7EB",
      },
      boxShadow: {
        soft: "0 24px 80px -32px rgba(17, 24, 39, 0.18)",
      },
      backgroundImage: {
        "hero-grid":
          "linear-gradient(to right, rgba(17,24,39,0.05) 1px, transparent 1px), linear-gradient(to bottom, rgba(17,24,39,0.05) 1px, transparent 1px)",
      },
      fontFamily: {
        sans: [
          "IBM Plex Sans Arabic",
          "Segoe UI",
          "Tahoma",
          "Arial",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
};

export default config;
