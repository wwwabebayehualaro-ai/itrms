/**
 * Reads a QR from a picture or a camera frame, on the phone. jsQR is pure JavaScript, so it works the same on the old phones that
 * have no `BarcodeDetector`, and it loads only when a scan starts.
 */
const CAMERA_WIDTH = 960;
const PHOTO_WIDTH = 1600;

type Drawable = HTMLVideoElement | ImageBitmap;

const sizeOf = (source: Drawable) =>
    source instanceof HTMLVideoElement
        ? { width: source.videoWidth, height: source.videoHeight }
        : { width: source.width, height: source.height };

async function read(source: Drawable, maxWidth: number, thorough: boolean): Promise<string | null> {
    const { width, height } = sizeOf(source);
    if (width === 0 || height === 0) return null;
    const scale = Math.min(1, maxWidth / width);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    const { default: jsQR } = await import('jsqr');
    // a camera tries again in a moment, so a frame takes the quick pass; a photo gets only the one chance
    const found = jsQR(image.data, image.width, image.height, {
        inversionAttempts: thorough ? 'attemptBoth' : 'dontInvert'
    });
    return found?.data ?? null;
}

export const readFrame = (video: HTMLVideoElement) => read(video, CAMERA_WIDTH, false);

export async function readPhoto(file: Blob): Promise<string | null> {
    try {
        const bitmap = await createImageBitmap(file);
        try {
            return await read(bitmap, PHOTO_WIDTH, true);
        } finally {
            bitmap.close();
        }
    } catch {
        return null;
    }
}
