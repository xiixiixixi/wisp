import type { Config } from 'tailwindcss';

export default {
  darkMode: ['class'],
  content: ['./apps/client/index.html', './apps/client/src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      colors: {
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        xp: {
          bg: 'var(--xp-bg)',
          surface: 'rgb(var(--xp-surface-rgb) / <alpha-value>)',
          'surface-light': 'rgb(var(--xp-surface-light-rgb) / <alpha-value>)',
          popover: 'var(--xp-popover)',
          blue: 'rgb(var(--xp-blue-rgb) / <alpha-value>)',
          'blue-dark': 'rgb(var(--xp-blue-dark-rgb) / <alpha-value>)',
          accent: 'rgb(var(--xp-accent-rgb) / <alpha-value>)',
          'accent-hover': 'rgb(var(--xp-accent-hover-rgb) / <alpha-value>)',
          purple: 'rgb(var(--xp-purple-rgb) / <alpha-value>)',
          pink: 'rgb(var(--xp-pink-rgb) / <alpha-value>)',
          green: 'rgb(var(--xp-green-rgb) / <alpha-value>)',
          orange: 'rgb(var(--xp-orange-rgb) / <alpha-value>)',
          yellow: 'rgb(var(--xp-yellow-rgb) / <alpha-value>)',
          red: 'rgb(var(--xp-red-rgb) / <alpha-value>)',
          cyan: 'rgb(var(--xp-cyan-rgb) / <alpha-value>)',
          lime: 'rgb(var(--xp-lime-rgb) / <alpha-value>)',
          text: 'var(--xp-text)',
          'text-secondary': 'var(--xp-text-secondary)',
          'text-muted': 'var(--xp-text-muted)',
          'on-accent': 'var(--xp-on-accent)',
          'selection-bg': 'var(--xp-selection-bg)',
          'selection-border': 'var(--xp-selection-border)',
          border: 'var(--xp-border)',
          'border-light': 'var(--xp-border-light)',
          'sidebar-bg': 'var(--xp-sidebar-bg)',
        },
        card: {
          DEFAULT: 'var(--card)',
          foreground: 'var(--card-foreground)',
        },
        popover: {
          DEFAULT: 'var(--popover)',
          foreground: 'var(--popover-foreground)',
        },
        primary: {
          DEFAULT: 'var(--primary)',
          foreground: 'var(--primary-foreground)',
        },
        secondary: {
          DEFAULT: 'var(--secondary)',
          foreground: 'var(--secondary-foreground)',
        },
        muted: {
          DEFAULT: 'var(--muted)',
          foreground: 'var(--muted-foreground)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          foreground: 'var(--accent-foreground)',
        },
        destructive: {
          DEFAULT: 'var(--destructive)',
          foreground: 'var(--destructive-foreground)',
        },
        border: 'var(--border)',
        input: 'var(--input)',
        ring: 'var(--ring)',
        chart: {
          '1': 'var(--chart-1)',
          '2': 'var(--chart-2)',
          '3': 'var(--chart-3)',
          '4': 'var(--chart-4)',
          '5': 'var(--chart-5)',
        },
        sidebar: {
          DEFAULT: 'var(--sidebar-background)',
          foreground: 'var(--sidebar-foreground)',
          primary: 'var(--sidebar-primary)',
          'primary-foreground': 'var(--sidebar-primary-foreground)',
          accent: 'var(--sidebar-accent)',
          'accent-foreground': 'var(--sidebar-accent-foreground)',
          border: 'var(--sidebar-border)',
          ring: 'var(--sidebar-ring)',
        },
      },
      keyframes: {
        'accordion-down': {
          from: {
            height: '0',
          },
          to: {
            height: 'var(--radix-accordion-content-height)',
          },
        },
        'accordion-up': {
          from: {
            height: 'var(--radix-accordion-content-height)',
          },
          to: {
            height: '0',
          },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [require('tailwindcss-animate'), require('@tailwindcss/typography')],
} satisfies Config;
