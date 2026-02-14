/** @type {import('tailwindcss').Config} */
module.exports = {
    presets: [require('./themes/hugo-saasify-theme/tailwind.config.js')],
    content: [
      "./themes/hugo-saasify-theme/layouts/**/*.html",
      "./layouts/**/*.html",
      "./content/**/*.{html,md}"
    ],
    theme: {
      extend: {
        colors: {
          primary: {
            50: '#e9f2f6',
            100: '#d3e5ed',
            200: '#a7cbdc',
            300: '#7bb1ca',
            400: '#4f97b9',
            500: '#2e7fa3',
            600: '#246684',
            700: '#1b4d64',
            800: '#123445',
            900: '#0a1c26',
          },
          secondary: {
            50: '#fff5eb',
            100: '#ffe7cf',
            200: '#ffd0a3',
            300: '#ffb977',
            400: '#ffa24b',
            500: '#f08b2e',
            600: '#c96f22',
            700: '#a05418',
            800: '#7a3b10',
            900: '#53260a',
          },
        },
        fontFamily: {
          sans: ['Manrope', 'system-ui', 'sans-serif'],
          heading: ['Newsreader', 'serif'],
        },
      },
    },
    plugins: [
      require('@tailwindcss/forms'),
      require('@tailwindcss/typography'),
    ],
  }
