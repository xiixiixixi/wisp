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
          surface: 'var(--xp-surface)',
          'surface-light': 'var(--xp-surface-light)',
          popover: 'var(--xp-popover)',
          blue: 'var(--xp-blue)',
          'blue-dark': 'var(--xp-blue-dark)',
          accent: 'var(--xp-accent)',
          'accent-hover': 'var(--xp-accent-hover)',
          purple: 'var(--xp-purple)',
          pink: 'var(--xp-pink)',
          green: 'var(--xp-green)',
          orange: 'var(--xp-orange)',
          yellow: 'var(--xp-yellow)',
          red: 'var(--xp-red)',
          cyan: 'var(--xp-cyan)',
          text: 'var(--xp-text)',
          'text-secondary': 'var(--xp-text-secondary)',
          'text-muted': 'var(--xp-text-muted)',
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
