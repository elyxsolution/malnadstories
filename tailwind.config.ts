import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        // Claude Design "Foundations" typefaces, applied globally via the brand font
        // vars set on <body> (src/app/layout.tsx). Cormorant Garamond = display serif;
        // Work Sans = UI sans. Fallbacks match if the vars are ever absent.
        display: ['var(--font-display)', 'Cormorant Garamond', 'Georgia', 'serif'],
        ui: ['var(--font-ui)', 'Work Sans', 'system-ui', 'sans-serif'],
      },
      colors: {
        background: 'hsl(var(--background) / <alpha-value>)',
        foreground: 'hsl(var(--foreground) / <alpha-value>)',
        card: {
          DEFAULT: 'hsl(var(--card) / <alpha-value>)',
          foreground: 'hsl(var(--card-foreground) / <alpha-value>)',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover) / <alpha-value>)',
          foreground: 'hsl(var(--popover-foreground) / <alpha-value>)',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary) / <alpha-value>)',
          foreground: 'hsl(var(--primary-foreground) / <alpha-value>)',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary) / <alpha-value>)',
          foreground: 'hsl(var(--secondary-foreground) / <alpha-value>)',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted) / <alpha-value>)',
          foreground: 'hsl(var(--muted-foreground) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent) / <alpha-value>)',
          foreground: 'hsl(var(--accent-foreground) / <alpha-value>)',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive) / <alpha-value>)',
          foreground: 'hsl(var(--destructive-foreground) / <alpha-value>)',
        },
        success: {
          DEFAULT: 'hsl(var(--success) / <alpha-value>)',
          foreground: 'hsl(var(--success-foreground) / <alpha-value>)',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning) / <alpha-value>)',
          foreground: 'hsl(var(--warning-foreground) / <alpha-value>)',
        },
        // Accent gold — the Foundations "whisper" reserved for the rarest highlights.
        gold: 'hsl(var(--gold) / <alpha-value>)',
        info: 'hsl(var(--info) / <alpha-value>)',
        border: 'hsl(var(--border) / <alpha-value>)',
        input: 'hsl(var(--input) / <alpha-value>)',
        ring: 'hsl(var(--ring) / <alpha-value>)',
      },
      // Editorial 2px corner system (Foundations). Crisp by default; pills/avatars keep
      // `rounded-full`. Remapping xl/2xl/3xl too so existing cards/modals sharpen globally.
      borderRadius: {
        none: '0px',
        sm: '2px',
        DEFAULT: '2px',
        md: '2px',
        lg: '3px',
        xl: '3px',
        '2xl': '4px',
        '3xl': '6px',
        full: '9999px',
      },
      // Soft, warm-tinted elevation (green-black shadow). No harsh/loud shadows.
      boxShadow: {
        xs: '0 1px 2px 0 rgb(16 24 20 / 0.04)',
        sm: '0 1px 3px 0 rgb(16 24 20 / 0.06), 0 1px 2px -1px rgb(16 24 20 / 0.05)',
        card: '0 1px 2px rgb(16 24 20 / 0.04), 0 6px 16px -8px rgb(16 24 20 / 0.08)',
        elevated: '0 8px 24px -8px rgb(16 24 20 / 0.12), 0 2px 6px -2px rgb(16 24 20 / 0.06)',
        // Floating frosted panel on the bright workspace.
        panel: '0 1px 2px rgb(16 24 20 / 0.04), 0 16px 40px -18px rgb(16 24 20 / 0.22)',
        // Realistic printed-paper page floating on the dark editing stage.
        paper:
          '0 1px 1px rgb(0 0 0 / 0.22), 0 8px 18px -6px rgb(0 0 0 / 0.45), 0 28px 56px -20px rgb(0 0 0 / 0.6)',
        // Soft green glow for active drop targets.
        glow: '0 0 0 3px hsl(158 40% 45% / 0.35), 0 12px 28px -10px hsl(158 45% 30% / 0.45)',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        rise: {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.96)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        'book-close': {
          '0%': { transform: 'perspective(1400px) rotateY(-32deg)', opacity: '0' },
          '60%': { opacity: '1' },
          '100%': { transform: 'perspective(1400px) rotateY(0deg)', opacity: '1' },
        },
        'draw-line': {
          from: { width: '0' },
          to: { width: 'var(--dw, 240px)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.3s ease-out both',
        rise: 'rise 0.55s cubic-bezier(0.32, 0.72, 0, 1) both',
        'scale-in': 'scale-in 0.4s cubic-bezier(0.32, 0.72, 0, 1) both',
        shimmer: 'shimmer 1.5s infinite',
      },
      transitionTimingFunction: {
        premium: 'cubic-bezier(0.32, 0.72, 0, 1)',
        glide: 'cubic-bezier(0.4, 0, 0.2, 1)',
      },
    },
  },
  plugins: [],
};

export default config;
