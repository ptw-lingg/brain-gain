/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,ts}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Open Sans"', '"Segoe UI"', 'system-ui', 'sans-serif'],
        mono: ['"Open Sans"', '"Segoe UI"', 'system-ui', 'sans-serif'],
      },
      colors: {
        // Petrol scale — the core brand color family (dark teal of the app chrome and tiles).
        petrol: {
          50: '#ECF4F4',
          100: '#D3E4E4',
          200: '#A8C9CA',
          300: '#79ADAE',
          400: '#4F9496',
          500: '#2E7D80',
          600: '#1D6B6E',
          700: '#14595C',
          800: '#0E4A4D',
          900: '#0A3638',
        },
        bg: {
          primary: '#EDF1F1',
          card: '#FFFFFF',
          sidebar: '#0E4A4D',
        },
        // Light, desaturated teal/gray tints used as chip + gradient accents across the pages.
        pastel: {
          blue: '#CCE0E1',
          cyan: '#CDE4E5',
          mint: '#CFE5DC',
          steel: '#D5DFE0',
          sky: '#E0E9E9',
          slate: '#DCE4E4',
        },
        ink: {
          DEFAULT: '#1A1A1A',
          muted: '#46595A',
          light: '#7A8E8F',
        },
        accent: {
          DEFAULT: '#156A6E',
          light: '#CDE4E5',
        },
        line: '#D8E0E0',
      },
      borderRadius: {
        sm: '3px',
        md: '4px',
        lg: '6px',
        xl: '8px',
      },
      boxShadow: {
        soft: '0 1px 3px rgba(10, 54, 56, 0.10), 0 1px 2px rgba(10, 54, 56, 0.06)',
        lift: '0 4px 14px rgba(10, 54, 56, 0.16)',
      },
    },
  },
  plugins: [],
};
