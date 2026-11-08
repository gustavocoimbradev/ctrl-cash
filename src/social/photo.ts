import { Platform } from 'react-native';

/** The photo is a small square JPEG (a data URL) made in the browser, so what is stored and sent stays tiny. */
export const photoSupported = Platform.OS === 'web';
const SIZE = 128;

/** Opens the file chooser and returns the picked image cropped to a centered square, 128px, as a JPEG data URL (null when cancelled or not an image). */
export function pickPhoto(): Promise<string | null> {
  return new Promise((resolve) => {
    if (!photoSupported) return resolve(null);
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.oncancel = () => resolve(null);
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file || !file.type.startsWith('image/')) return resolve(null);
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = SIZE;
        canvas.height = SIZE;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          URL.revokeObjectURL(url);
          return resolve(null);
        }
        const side = Math.min(img.width, img.height);
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, SIZE, SIZE);
        ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, SIZE, SIZE);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      img.src = url;
    };
    input.click();
  });
}
