/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx,css}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', "'Segoe UI'", 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Consolas', "'Liberation Mono'", 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
}
