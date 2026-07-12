/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        stage: {
          950: "#090d12",
          900: "#0d131a",
          850: "#111923",
          800: "#17212c",
          700: "#223142",
        },
      },
      boxShadow: {
        panel: "0 18px 50px rgba(0, 0, 0, 0.22)",
      },
    },
  },
  plugins: [],
};
