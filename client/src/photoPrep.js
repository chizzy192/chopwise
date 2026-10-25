// Gets a dish photo ready to upload. The server accepts JPEG, PNG or WebP up to 2 MB (and re-encodes
// it), but phone photos are often 3–8 MB. Those are shrunk here first, in the browser: at most 1600 px
// on the longer side, saved as JPEG, stepping the quality down until the file fits.
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIDE = 1600;

/** Returns a File that fits the upload limit, or throws an Error with a message for the caterer. */
export async function preparePhoto(file) {
  if (!PHOTO_TYPES.includes(file.type)) throw new Error('Choose a JPEG, PNG or WebP photo');
  if (file.size <= MAX_PHOTO_BYTES) return file;
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error("That photo couldn't be read. Try a different one.");
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  for (const quality of [0.85, 0.72, 0.6]) {
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (blob && blob.size <= MAX_PHOTO_BYTES) return new File([blob], 'photo.jpg', { type: 'image/jpeg' });
  }
  throw new Error('That photo is too large, even after shrinking it. Try a smaller one.');
}
