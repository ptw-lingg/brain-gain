/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,ts}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
        mono: ['"DM Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        bg: {
          primary: '#F0F6FF',
          card: '#FFFFFF',
          sidebar: '#E0EDFF',
        },
        pastel: {
          blue: '#B8D8FF',
          cyan: '#B8F0F8',
          mint: '#B8F0E0',
          steel: '#C8DAEE',
          sky: '#D0EEFF',
          slate: '#D8E8F8',
        },
        ink: {
          DEFAULT: '#0F1E36',
          muted: '#4A6080',
          light: '#7A9AB8',
        },
        accent: {
          DEFAULT: '#2B78E4',
          light: '#B8D8FF',
        },
        line: '#CCE0F8',
      },
      borderRadius: {
        sm: '6px',
        md: '12px',
        lg: '18px',
        xl: '24px',
      },
      boxShadow: {
        soft: '0 8px 30px rgba(43, 120, 228, 0.07)',
        lift: '0 12px 36px rgba(43, 120, 228, 0.14)',
      },
    },
  },
  plugins: [],
};
