import { defineConfig } from 'vite';
// BASE_PATH lets the same build run under a sub-path, e.g. GitHub Pages at /laser-heist/ (see .github/workflows/pages.yml).
export default defineConfig({base:process.env.BASE_PATH??'/',server:{host:'0.0.0.0',proxy:{'/ws':{target:'ws://127.0.0.1:3000',ws:true},'/heist/ws':{target:'ws://127.0.0.1:3000',ws:true},'/health':'http://127.0.0.1:3000'}},build:{target:'es2022',rollupOptions:{input:{main:'index.html',laser:'laser/index.html',orbit:'orbit/index.html'}}}});
