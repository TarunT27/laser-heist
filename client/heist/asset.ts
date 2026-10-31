/**
 * URL for a file in `public/`, honouring the build's base path. The Node server serves the game at `/`;
 * GitHub Pages serves it under `/<repo>/` (set with BASE_PATH at build time, see vite.config.ts).
 */
export const asset = (path: string) => import.meta.env.BASE_URL + path.replace(/^\//, '');
