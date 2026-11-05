/**
 * Reads a QR from a picture or a camera frame, on the phone. jsQR is pure JavaScript, so it works the same on the old phones that
 * have no `BarcodeDetector`. A picture with no code in it is null; a reader that can't load throws, because that is no such thing.
 */
const CAMERA_WIDTH = 960;
const PHOTO_WIDTH = 1600;

type Drawable = HTMLVideoElement | ImageBitmap;

const sizeOf = (source: Drawable) =>
    source instanceof HTMLVideoElement
        ? { width: source.videoWidth, height: source.videoHeight }
        : { width: source.width, height: source.height };

/** Once: it is what makes the page work offline, so it is fetched while there is a connection. */
export const loadReader = async () => (await import('jsqr')).default;

// one canvas for every frame: a new one each time is real work for a cheap phone
let canvas: HTMLCanvasElement | undefined;

async function read(source: Drawable, maxWidth: number, thorough: boolean): Promise<string | null> {
    const jsQR = await loadReader();
    const { width, height } = sizeOf(source);
    if (width === 0 || height === 0) return null;
    const scale = Math.min(1, maxWidth / width);
    canvas ??= document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    // a camera tries again in a moment, so a frame takes the quick pass; a photo gets only the one chance
    const found = jsQR(image.data, image.width, image.height, {
        inversionAttempts: thorough ? 'attemptBoth' : 'dontInvert'
    });
    return found?.data ?? null;
}

export const readFrame = (video: HTMLVideoElement) => read(video, CAMERA_WIDTH, false);

/** A file that isn't a picture the browser can open is a picture with no code in it. */
export async function readPhoto(file: Blob): Promise<string | null> {
    const bitmap = await createImageBitmap(file).catch(() => null);
    if (!bitmap) return null;
    try {
        return await read(bitmap, PHOTO_WIDTH, true);
    } finally {
        bitmap.close();
    }
}
