// Dish photo upload: one file, at most 2 MB, held in memory, and accepted only if its contents
// (not its extension or the browser's claimed type) are JPEG, PNG or WebP.
import multer from 'multer';
import { fileTypeFromBuffer } from 'file-type';

export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const parser = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PHOTO_BYTES, files: 1, fields: 0, parts: 1 },
}).single('photo');

export function photoUpload(req, res, next) {
  parser(req, res, async (err) => {
    if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'The photo must be 2 MB or smaller' });
    if (err instanceof multer.MulterError) return res.status(400).json({ error: 'Send one photo in the "photo" field' });
    if (err) return next(err);
    if (!req.file) return res.status(400).json({ error: 'Choose a photo to upload' });
    const type = await fileTypeFromBuffer(req.file.buffer);
    if (!type || !PHOTO_TYPES.includes(type.mime)) {
      return res.status(400).json({ error: 'The photo must be a JPEG, PNG or WebP image' });
    }
    req.file.detectedType = type.mime;
    next();
  });
}
