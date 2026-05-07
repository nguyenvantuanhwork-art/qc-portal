/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{html,ts}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        /* Đồng bộ tông VS Code (editor #1e1e1e, sidebar/list #252526). */
        'dashboard-bg': '#1e1e1e',
        'dashboard-surface': '#252526',
        'dashboard-border': '#3c3c3c',
        'dashboard-hover': 'rgba(255, 255, 255, 0.06)',
        /** Viền / icon / nhấn mạnh (VS focus #007fd4). */
        'dashboard-primary': '#0078d4',
        'dashboard-primary-hover': '#1177bb',
        /** Nút filled chính (VS `--button.background` ~ #0e639c). */
        'dashboard-filled': '#0e639c',
        'dashboard-filled-hover': '#1177bb',
        /** Ô nhập như VS Code settings. */
        'dashboard-input-bg': '#3c3c3c',
        'dashboard-focus': '#007fd4',
        /** Text link / badge xanh nhạt trên nền tối. */
        'dashboard-link': '#8ec8ff',
        'dashboard-success-bg': 'rgba(16, 185, 129, 0.15)',
        'dashboard-success-text': '#34d399',
        'on-background': '#cccccc',
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
