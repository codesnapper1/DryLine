/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        'carbon': '#070709',
        'carbon-panel': 'rgba(255, 255, 255, 0.03)',
        'neon-cyan': '#00F0FF',
        'neon-cyan-muted': 'rgba(0, 240, 255, 0.2)',
        'neon-purple': '#B026FF',
        'neon-purple-muted': 'rgba(176, 38, 255, 0.2)',
        'racing-red': '#FF2A2A',
        'status-damp': '#F5A623',
        'status-wet': '#4A90E2',
      },
      fontFamily: {
        'sans': ['Inter', 'sans-serif'],
        'display': ['Space Grotesk', 'sans-serif'],
        'mono': ['JetBrains Mono', 'monospace'],
      },
      boxShadow: {
        'neon-cyan': '0 0 10px rgba(0, 240, 255, 0.3), 0 0 20px rgba(0, 240, 255, 0.1)',
        'neon-purple': '0 0 10px rgba(176, 38, 255, 0.3), 0 0 20px rgba(176, 38, 255, 0.1)',
        'panel': '0 4px 24px -4px rgba(0, 0, 0, 0.5)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in': 'fadeIn 0.5s ease-out forwards',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        }
      }
    },
  },
  plugins: [],
};
