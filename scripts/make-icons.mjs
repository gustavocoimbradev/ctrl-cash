// Generates the home-screen icons from code (no image tools needed):
//   npm run icons    ->  public/: icon-512, icon-192, apple-touch-icon (180), favicon-32, favicon.ico, logo-512
//                        assets/: icon, favicon, splash-icon and the Android adaptive icons
// The mark: a keycap (rounded square outline) with a "C" on the deep navy of the brand. The same
// shapes are in public/favicon.svg; if you change one, change the other. Needs `pngjs` (it comes with Expo).
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const { PNG } = createRequire(import.meta.url)('pngjs');
const BG = [11, 25, 44];
const FG = [255, 255, 255];

/** Coverage (0 or 1) of the mark at a point in the 32x32 design space: 1 = white mark, 0 = navy. */
function mark(x, y) {
  // keycap: rounded square outline, half-size 9, corner radius 5, stroke 1.8
  const qx = Math.abs(x - 16) - (9 - 5);
  const qy = Math.abs(y - 16) - (9 - 5);
  const sdf = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - 5;
  if (Math.abs(sdf) <= 0.9) return 1;
  // "C": ring of radius 4.6 and width 2, open on the right (+-40 degrees), with round ends
  const dx = x - 16;
  const dy = y - 16;
  const d = Math.hypot(dx, dy);
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (Math.abs(d - 4.6) <= 1 && Math.abs(angle) >= 40) return 1;
  for (const s of [-1, 1]) {
    const a = (s * 40 * Math.PI) / 180;
    if (Math.hypot(x - (16 + 4.6 * Math.cos(a)), y - (16 + 4.6 * Math.sin(a))) <= 1) return 1;
  }
  return 0;
}

/** mode "full": navy background + white mark; "mark": white mark on transparent; "bg": solid navy. */
function render(size, file, mode = 'full') {
  const png = new PNG({ width: size, height: size });
  const SS = 4; // 4x4 samples per pixel: smooth edges
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let on = 0;
      if (mode !== 'bg') for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) on += mark(((px + (sx + 0.5) / SS) / size) * 32, ((py + (sy + 0.5) / SS) / size) * 32);
      const t = on / (SS * SS);
      const i = (py * size + px) * 4;
      if (mode === 'mark') {
        png.data[i] = png.data[i + 1] = png.data[i + 2] = 255;
        png.data[i + 3] = Math.round(255 * t);
      } else {
        for (let k = 0; k < 3; k++) png.data[i + k] = Math.round(BG[k] + (FG[k] - BG[k]) * t);
        png.data[i + 3] = 255;
      }
    }
  }
  const buffer = PNG.sync.write(png);
  writeFileSync(file, buffer);
  console.log('wrote', file);
  return buffer;
}

// the web (public/)
render(512, 'public/icon-512.png');
render(512, 'public/logo-512.png');
render(192, 'public/icon-192.png');
render(180, 'public/apple-touch-icon.png');
render(32, 'public/favicon-32.png');
// favicon.ico: an ICO container holding PNGs (every current browser reads them)
const sizes = [16, 32, 48];
const images = sizes.map((s) => render(s, `/tmp/ctrlcash-favicon-${s}.png`));
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((s, n) => {
  const at = 6 + 16 * n;
  header.writeUInt8(s, at); header.writeUInt8(s, at + 1); header.writeUInt8(0, at + 2); header.writeUInt8(0, at + 3);
  header.writeUInt16LE(1, at + 4); header.writeUInt16LE(32, at + 6);
  header.writeUInt32LE(images[n].length, at + 8); header.writeUInt32LE(offset, at + 12);
  offset += images[n].length;
});
writeFileSync('public/favicon.ico', Buffer.concat([header, ...images]));
console.log('wrote public/favicon.ico');
// the Expo / native assets (assets/)
render(1024, 'assets/icon.png');
render(48, 'assets/favicon.png');
render(1024, 'assets/android-icon-foreground.png', 'mark');
render(1024, 'assets/android-icon-background.png', 'bg');
render(1024, 'assets/android-icon-monochrome.png', 'mark');
render(512, 'assets/splash-icon.png', 'mark');
