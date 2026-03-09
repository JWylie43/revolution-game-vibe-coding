/** @type {import('tailwindcss').Config} */
export default {
  // "content" tells Tailwind which files to scan for class names.
  // Tailwind only generates CSS for classes it finds in these files.
  // This keeps the final CSS bundle small — unused utility classes are excluded.
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",  // All JS/TS files in src/
  ],

  theme: {
    extend: {
      // Add custom colors for the Revolution game theme.
      // These become available as Tailwind classes: bg-gold, text-blackmail, etc.
      colors: {
        gold: {
          50:  "#fffbeb",
          500: "#f59e0b",
          600: "#d97706",
        },
        blackmail: {
          500: "#7c3aed",
          600: "#6d28d9",
        },
        force: {
          500: "#dc2626",
          600: "#b91c1c",
        },
      },
    },
  },

  plugins: [],
};
