import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

const assets = {
  'public/assets/tilda-sans.woff2':
    'https://static.tildacdn.com/fonts/tildasans/TildaSans-VF.woff2',
  'public/assets/hero.png':
    'https://static.tildacdn.com/tild3061-6562-4366-b335-363531643861/018c31207560d6211fe3.png',
  'public/assets/about.jpg':
    'https://static.tildacdn.com/tild3438-3565-4363-b832-613365343262/nastuhabootalebi2848.jpg',
  'public/assets/suzuki-jimny-main.jpg':
    'https://static.tildacdn.com/tild6534-3835-4235-b638-613062613134/photo_2026-02-18_09-.jpg',
  'public/assets/suzuki-jimny-hover.jpg':
    'https://static.tildacdn.com/tild6638-6536-4438-b930-383337353963/photo_2026-02-18_09-.jpg',
  'public/assets/toyota-chr-main.jpg':
    'https://static.tildacdn.com/tild3630-3731-4530-a137-313333643537/photo_2026-02-18_09-.jpg',
  'public/assets/toyota-chr-hover.jpg':
    'https://static.tildacdn.com/tild6637-3862-4731-b633-613463636362/photo_2026-02-18_09-.jpg',
  'public/assets/toyota-roomy-main.jpg':
    'https://static.tildacdn.com/tild3332-3838-4639-a137-323638396131/photo_2026-02-18_09-.jpg',
  'public/assets/toyota-roomy-hover.jpg':
    'https://static.tildacdn.com/tild3830-6165-4531-a361-386465323735/photo_2026-02-18_09-.jpg',
  'public/assets/honda-stepwgn-main.jpg':
    'https://static.tildacdn.com/tild3761-3162-4236-b365-666630303261/photo_2026-02-18_09-.jpg',
  'public/assets/honda-stepwgn-hover.jpg':
    'https://static.tildacdn.com/tild6566-3962-4234-a131-346136343338/photo_2026-02-18_09-.jpg',
  'public/assets/quiz-korea.png':
    'https://static.tildacdn.com/tild3862-3662-4763-b639-613031373363/8d1e7989064b0164cef7.png',
  'public/assets/quiz-japan.png':
    'https://static.tildacdn.com/tild3562-3466-4661-b234-626362613261/1255d1666fa1575f5057.png',
  'public/assets/quiz-china.png':
    'https://static.tildacdn.com/tild3634-6637-4038-b535-616636346539/88b7fe11023c7aab59c8.png',
  'public/assets/discount.svg':
    'https://static.tildacdn.com/tild6336-3430-4236-b237-656430373837/design_create.svg',
  'public/assets/logo-white.png':
    'https://static.tildacdn.com/tild6433-3935-4133-a365-323361393431/logo_w.png',
  'public/assets/og-image.png':
    'https://static.tildacdn.com/tild6562-3432-4630-a334-333035343564/logo.png',
  'public/assets/favicon.png':
    'https://static.tildacdn.com/tild6339-3630-4861-b062-363062383266/logo.png',
};

async function download(relativePath, url) {
  const destination = resolve(root, relativePath);
  await mkdir(dirname(destination), { recursive: true });

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      await writeFile(destination, buffer);
      console.log(`${relativePath} (${buffer.length} bytes)`);
      return;
    } catch (error) {
      if (attempt === 3) throw error;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 1000));
    }
  }
}

for (const [relativePath, url] of Object.entries(assets)) {
  await download(relativePath, url);
}
