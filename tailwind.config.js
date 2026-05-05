/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'turno-m':   '#dbeafe',  // blue-100
        'turno-p':   '#dcfce7',  // green-100
        'turno-l':   '#fef9c3',  // yellow-100
        'turno-rep': '#fee2e2',  // red-100
        'turno-rm':  '#ede9fe',  // violet-100
        'turno-rp':  '#fce7f3',  // pink-100
        'festivo':   '#fef3c7',  // amber-100
        'ferie':     '#d1fae5',  // emerald-100
      },
    },
  },
  plugins: [],
}
