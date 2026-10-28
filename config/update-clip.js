const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { execFileSync } = require('child_process');

const W = 1200;
const H = 600;
const BAND = 112;
const RULE = 4;
const PAD = 40;
const BODY_TOP = BAND + RULE + 18;
const BODY_H = H - BODY_TOP - 34;
const NAVY = '#13294b';
const ORANGE = '#ff5f05';
const PILLS = { new: ['NEW', NAVY], before: ['BEFORE', '#6b7280'], after: ['AFTER', ORANGE] };
const FONT = 'Helvetica, Arial, sans-serif';

const USAGE = `Usage: npm run update-clip -- <clip.json>

clip.json:
{
  "out": "docs/site/updates/2026-10",
  "title": "Drafts now keep up with your changes",
  "brand": "GiesChat · October 2026",
  "poster": {
    "before": "shots/before.png", "beforeNote": "What the screen looked like",
    "after": "shots/after.png", "afterNote": "What it looks like now",
    "seconds": 4
  },
  "frames": [
    { "label": "before", "caption": "…", "image": "shots/before.png", "seconds": 2.5 },
    { "label": "after", "caption": "…", "image": "shots/after.png", "overlay": "shots/toast.png" }
  ]
}
Image paths are relative to clip.json. Record screens from local test accounts only:
the clip is served from the public docs site.`;

const escapeXml = (text) =>
  String(text).replace(
    /[<>&'"]/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c],
  );

/** The white caption band: a pill (NEW / BEFORE / AFTER) and one line of caption, over an orange rule. */
function band(label, caption) {
  const [text, color] = PILLS[label];
  const pillW = text.length * 15 + 30;
  return Buffer.from(`<svg width="${W}" height="${BAND + RULE}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${BAND}" fill="#ffffff"/>
  <rect y="${BAND}" width="${W}" height="${RULE}" fill="${ORANGE}"/>
  <rect x="${PAD}" y="${BAND / 2 - 19}" width="${pillW}" height="38" rx="19" fill="${color}"/>
  <text x="${PAD + pillW / 2}" y="${BAND / 2 + 7}" font-family="${FONT}" font-size="20" font-weight="bold" letter-spacing="1.2" fill="#ffffff" text-anchor="middle">${text}</text>
  <text x="${PAD + pillW + 20}" y="${BAND / 2 + 12}" font-family="${FONT}" font-size="33" font-weight="bold" fill="${NAVY}">${escapeXml(caption)}</text>
</svg>`);
}

const brandMark = (text) =>
  Buffer.from(`<svg width="${W}" height="30" xmlns="http://www.w3.org/2000/svg">
  <text x="${W - 22}" y="20" font-family="${FONT}" font-size="14" font-weight="bold" fill="#64748b" text-anchor="end">${escapeXml(text)}</text>
</svg>`);

/** A screenshot shrunk to fit the box, with rounded corners, a hairline border and a soft shadow. */
async function card(file, maxW, maxH) {
  const image = sharp(file).resize({
    width: maxW,
    height: maxH,
    fit: 'inside',
    withoutEnlargement: false,
  });
  const { data, info } = await image.png().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const mask = Buffer.from(
    `<svg width="${width}" height="${height}"><rect width="${width}" height="${height}" rx="12" fill="#fff"/></svg>`,
  );
  const rounded = await sharp(data)
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();
  const pad = 24;
  const shadow =
    Buffer.from(`<svg width="${width + pad * 2}" height="${height + pad * 2}" xmlns="http://www.w3.org/2000/svg">
  <defs><filter id="s" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="10"/></filter></defs>
  <rect x="${pad}" y="${pad + 6}" width="${width}" height="${height}" rx="12" fill="${NAVY}" opacity="0.16" filter="url(#s)"/>
  <rect x="${pad - 0.5}" y="${pad - 0.5}" width="${width + 1}" height="${height + 1}" rx="12.5" fill="none" stroke="#c9d3e3"/>
</svg>`);
  const input = await sharp(shadow)
    .composite([{ input: rounded, top: pad, left: pad }])
    .png()
    .toBuffer();
  return { input, width: width + pad * 2, height: height + pad * 2, pad };
}

async function slide(layers, caption, labelKey, brand) {
  return sharp({ create: { width: W, height: H, channels: 4, background: '#eef3fb' } })
    .composite([
      { input: band(labelKey, caption), top: 0, left: 0 },
      ...layers,
      { input: brandMark(brand), top: H - 32, left: 0 },
    ])
    .png()
    .toBuffer();
}

async function frame(spec, dir, brand) {
  const shot = await card(path.resolve(dir, spec.image), W - PAD * 2, BODY_H);
  const top = BODY_TOP + Math.round((BODY_H - shot.height + shot.pad * 2) / 2) - shot.pad;
  const layers = [{ input: shot.input, top, left: Math.round((W - shot.width) / 2) }];
  if (spec.overlay) {
    const toast = await sharp(path.resolve(dir, spec.overlay))
      .resize({ height: 64 })
      .png()
      .toBuffer();
    const { width } = await sharp(toast).metadata();
    layers.push({ input: toast, top: BODY_TOP + 6, left: Math.round((W - width) / 2) });
  }
  return slide(layers, spec.caption, spec.label, brand);
}

/** Greedy word wrap for SVG text, which has none: about half an em per character. */
function wrap(text, width, size) {
  const max = Math.floor(width / (size * 0.52));
  return String(text)
    .split(/\s+/)
    .reduce((lines, word) => {
      const last = lines[lines.length - 1];
      if (last !== undefined && `${last} ${word}`.length <= max) {
        lines[lines.length - 1] = `${last} ${word}`;
      } else {
        lines.push(word);
      }
      return lines;
    }, []);
}

/** A column heading ("Before" / "After") and, below the screen, its note. */
function columnText({ heading, color, note, width, cardHeight }) {
  const NOTE_SIZE = 21;
  const lines = note ? wrap(note, width, NOTE_SIZE) : [];
  const noteTop = 44 + cardHeight + 30;
  const height = noteTop + lines.length * 30;
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <text y="26" font-family="${FONT}" font-size="24" font-weight="bold" fill="${color}">${escapeXml(heading)}</text>
  ${lines
    .map(
      (line, i) =>
        `<text y="${noteTop + i * 30}" font-family="${FONT}" font-size="${NOTE_SIZE}" fill="#334155">${escapeXml(line)}</text>`,
    )
    .join('')}
</svg>`;
  return { input: Buffer.from(svg), height };
}

/**
 * Before on the left, after on the right, each with its note. It is the first frame on
 * purpose: classic Outlook on Windows shows only the first frame of a GIF.
 */
async function poster(spec, title, dir, brand) {
  const SIDE = 28;
  const GAP = 24;
  const column = Math.floor((W - SIDE * 2 - GAP) / 2);
  const files = [spec.before, spec.after].map((file) => path.resolve(dir, file));
  const [before, after] = await Promise.all(files.map((file) => card(file, column, BODY_H)));
  const visible = (shot) => shot.height - shot.pad * 2;
  const columns = [
    { shot: before, heading: 'Before', color: '#6b7280', note: spec.beforeNote, left: SIDE },
    {
      shot: after,
      heading: 'After',
      color: ORANGE,
      note: spec.afterNote,
      left: SIDE + column + GAP,
    },
  ].map((col) => ({
    ...col,
    text: columnText({ ...col, width: column, cardHeight: visible(col.shot) }),
  }));
  const blockHeight = Math.max(...columns.map((col) => col.text.height));
  const top = BODY_TOP + Math.max(0, Math.round((BODY_H - blockHeight) / 2)) - 8;
  return slide(
    columns.flatMap((col) => [
      { input: col.text.input, top, left: col.left },
      { input: col.shot.input, top: top + 44 - col.shot.pad, left: col.left - col.shot.pad },
    ]),
    title,
    'new',
    brand,
  );
}

async function buildClip(specPath) {
  const dir = path.dirname(path.resolve(specPath));
  const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  const out = path.resolve(spec.out);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'update-clip-'));
  const entries = [
    {
      png: await poster(spec.poster, spec.title, dir, spec.brand),
      seconds: spec.poster.seconds ?? 3,
    },
  ];
  for (const item of spec.frames) {
    entries.push({ png: await frame(item, dir, spec.brand), seconds: item.seconds ?? 2.5 });
  }
  const list = entries
    .map(({ png, seconds }, index) => {
      const file = path.join(work, `f${index}.png`);
      fs.writeFileSync(file, png);
      return `file '${file}'\nduration ${seconds}`;
    })
    .join('\n');
  /** The concat demuxer ignores the last entry's duration unless the file is listed again. */
  fs.writeFileSync(
    path.join(work, 'list.txt'),
    `${list}\nfile '${path.join(work, `f${entries.length - 1}.png`)}'\n`,
  );
  fs.mkdirSync(out, { recursive: true });
  const input = [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    path.join(work, 'list.txt'),
  ];
  execFileSync('ffmpeg', [
    ...input,
    '-vf',
    'fps=25,format=yuv420p',
    '-c:v',
    'libx264',
    '-crf',
    '22',
    '-movflags',
    '+faststart',
    path.join(out, 'main.mp4'),
  ]);
  execFileSync('ffmpeg', [
    ...input,
    '-vf',
    'fps=4,scale=1072:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4',
    '-loop',
    '0',
    path.join(out, 'main.gif'),
  ]);
  fs.copyFileSync(path.join(work, 'f0.png'), path.join(work, 'poster.png'));
  return { out, work, frames: entries.length };
}

module.exports = { buildClip };

if (require.main === module) {
  const specPath = process.argv[2];
  if (!specPath) {
    console.log(USAGE);
    process.exit(1);
  }
  buildClip(specPath)
    .then(({ out, work, frames }) => {
      const size = (file) => `${Math.round(fs.statSync(path.join(out, file)).size / 1024)} KB`;
      console.log(
        `${frames} frames → ${out}/main.gif (${size('main.gif')}), main.mp4 (${size('main.mp4')})`,
      );
      console.log(`Frames kept in ${work}`);
    })
    .catch((error) => {
      console.error(`update-clip: ${error.message}`);
      process.exit(1);
    });
}
