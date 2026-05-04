/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{html,ts}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        'dashboard-bg': '#111827',
        'dashboard-surface': '#1f2937',
        'dashboard-border': '#374151',
        'dashboard-primary': '#3b82f6',
        'dashboard-success-bg': 'rgba(16, 185, 129, 0.15)',
        'dashboard-success-text': '#34d399',
        'on-background': '#dce3f0',
      },
      fontFamily: {
        'body-sm': ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        'label-caps': ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        'code-mono': [
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Monaco',
          'Consolas',
          'monospace',
        ],
        'title-sm': ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        inter: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        'display-lg': ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        'headline-md': ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
