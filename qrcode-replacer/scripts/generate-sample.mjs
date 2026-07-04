import QRCode from 'qrcode';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.join(__dirname, '..', 'public', 'templates', 'qr-sample.png');

await QRCode.toFile(outPath, 'https://example.com/qr-sample', {
  width: 256,
  margin: 2,
  color: { dark: '#000000', light: '#ffffff' }
});

console.log('✓ qr-sample.png 已生成:', outPath);
