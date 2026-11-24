// Renders the Speed Cams app icons from SVG.
// Usage: npm run icons  -> regenerates assets/*.png from this SVG source; preview sheet is written to /tmp.
import sharp from 'sharp';
import path from 'node:path';

const [assets, previewDir] = process.argv.slice(2);

// Glyph on a 1024 canvas: a front-facing speed camera on a pole, with speed lines
// on the left. Kept inside the central ~60% so Android adaptive masks never clip it.
const glyph = (fill, accent, { lens = true, scale = 1 } = {}) => `
  <defs>
    <mask id="lensHole">
      <rect width="1024" height="1024" fill="#fff"/>
      <circle cx="572" cy="468" r="92" fill="#000"/>
    </mask>
  </defs>
  <g fill="${fill}" transform="translate(512 512) scale(${scale}) translate(-479 -524)">
    <!-- speed lines -->
    <rect x="236" y="384" width="104" height="34" rx="17" opacity="0.9"/>
    <rect x="196" y="451" width="144" height="34" rx="17"/>
    <rect x="236" y="518" width="104" height="34" rx="17" opacity="0.9"/>
    <!-- hood -->
    <rect x="482" y="296" width="180" height="56" rx="20"/>
    <!-- body with lens hole -->
    <rect x="382" y="330" width="380" height="276" rx="56" mask="url(#lensHole)"/>
    <!-- lens -->
    <circle cx="572" cy="468" r="50"/>
    ${lens ? `<circle cx="590" cy="450" r="16" fill="${accent}"/>` : ''}
    <!-- pole and base -->
    <rect x="544" y="600" width="56" height="128" rx="10"/>
    <rect x="470" y="712" width="204" height="40" rx="20"/>
  </g>`;

const background = `
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0.6" y2="1">
      <stop offset="0" stop-color="#F04438"/>
      <stop offset="1" stop-color="#A51C12"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" fill="url(#bg)"/>`;

const svg = (body) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">${body}</svg>`);

const fullIcon = svg(background + glyph('#FFFFFF', '#F04438', { scale: 1.18 }));
const fg = svg(glyph('#FFFFFF', '#F04438'));
const mono = svg(glyph('#FFFFFF', '#FFFFFF', { lens: false }));
const bgOnly = svg(background);
const splash = svg(glyph('#D92D20', '#FFFFFF', { scale: 1.18 }));

const out = (name) => path.join(assets, name);
await sharp(fullIcon).resize(1024).flatten({ background: '#A51C12' }).png().toFile(out('icon.png'));
await sharp(fg).resize(512).png().toFile(out('android-icon-foreground.png'));
await sharp(bgOnly).resize(512).png().toFile(out('android-icon-background.png'));
await sharp(mono).resize(432).png().toFile(out('android-icon-monochrome.png'));
await sharp(splash).resize(1024).png().toFile(out('splash-icon.png'));
await sharp(fullIcon).resize(48).png().toFile(out('favicon.png'));

// Preview sheet: iOS rounded square, Android circle mask, small size, monochrome.
const round = (r) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" rx="${r}" fill="#fff"/></svg>`);
const masked = async (buf, r) =>
  sharp(buf).resize(1024).composite([{ input: round(r), blend: 'dest-in' }]).png().toBuffer();
const ios = await sharp(await masked(fullIcon, 225)).resize(360).toBuffer();
const android = await sharp(await masked(svg(background + glyph('#FFFFFF', '#F04438')), 512)).resize(360).toBuffer();
const small = await sharp(await masked(fullIcon, 225)).resize(120).toBuffer();
const monoPrev = await sharp(
  svg(`<rect width="1024" height="1024" rx="512" fill="#3A3F47"/>` + glyph('#E6E8EB', '#E6E8EB', { lens: false })),
).resize(240).png().toBuffer();
await sharp({ create: { width: 1300, height: 480, channels: 4, background: '#F2F4F7' } })
  .composite([
    { input: ios, left: 40, top: 60 },
    { input: android, left: 440, top: 60 },
    { input: small, left: 840, top: 180 },
    { input: monoPrev, left: 1010, top: 120 },
  ])
  .png()
  .toFile(path.join(previewDir, 'icon-preview.png'));
console.log('ok');
