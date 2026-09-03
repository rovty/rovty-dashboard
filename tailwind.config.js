/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      // Same "Modernist" palette as rovty.com (see rovty.com/tailwind.config.js) —
      // kept identical so the dashboard reads as the same product, not a
      // different app the user was handed off to.
      colors: {
        ink: '#000000',
        paper: '#f3f2f2',
        line: {
          300: '#d7d3d3',
          400: '#bab6b6',
          500: '#9b9797',
          600: '#7d7979',
          700: '#605d5d',
          800: '#444141',
          900: '#2d2b2b',
        },
      },
      fontFamily: {
        archivo: ['Archivo', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
