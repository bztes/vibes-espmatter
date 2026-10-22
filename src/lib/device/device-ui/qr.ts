// QR code decoding for the device web interface and the vibes-espmatter app (both import this file).
// Uses the browser's BarcodeDetector where available (Chrome, Android); elsewhere (Safari,
// Firefox) jsQR is loaded from a CDN on first use, so it doesn't take up space on the device.

// A plain script (sets `window.jsQR`), pinned by hash: on the device it runs with the admin's session.
const JSQR_URL = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
const JSQR_SRI = 'sha384-b5Ya4Bq3qCyz39m2ISh+4DxjAIljdeFwK/BsXLuj9gugaNwAcj/ia15fxNZL9Nlx';

type JsQr = (
	data: Uint8ClampedArray,
	w: number,
	h: number,
	options?: { inversionAttempts?: string }
) => { data: string } | null;

interface Detector {
	detect(image: ImageBitmapSource): Promise<{ rawValue: string }[]>;
}
interface DetectorClass {
	new (o: { formats: string[] }): Detector;
	getSupportedFormats(): Promise<string[]>;
}

/** Reads all QR codes in an image, a video frame or a canvas. */
export type QrDecoder = (source: HTMLVideoElement | ImageBitmap) => Promise<string[]>;

let jsQrLoading: Promise<JsQr> | undefined;

function loadJsQr(): Promise<JsQr> {
	jsQrLoading ??= new Promise<JsQr>((resolve, reject) => {
		const script = document.createElement('script');
		script.src = JSQR_URL;
		script.integrity = JSQR_SRI;
		script.crossOrigin = 'anonymous';
		script.onload = () => resolve((window as unknown as { jsQR: JsQr }).jsQR);
		script.onerror = () => {
			jsQrLoading = undefined;
			script.remove();
			reject(
				new Error(
					'This browser can’t read QR codes offline and the decoder could not be loaded – type the code instead.'
				)
			);
		};
		document.head.append(script);
	});
	return jsQrLoading;
}

/** Native detector if the browser has one for QR codes, else jsQR on a downscaled canvas. */
export async function qrDecoder(maxSide = 1280): Promise<QrDecoder> {
	const Native = (window as unknown as { BarcodeDetector?: DetectorClass }).BarcodeDetector;
	if (
		Native &&
		(await Native.getSupportedFormats().catch((): string[] => [])).includes('qr_code')
	) {
		const detector = new Native({ formats: ['qr_code'] });
		return async (source) => (await detector.detect(source)).map((c) => c.rawValue);
	}
	const jsQR = await loadJsQr();
	const canvas = document.createElement('canvas');
	const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
	return async (source) => {
		const w = source instanceof HTMLVideoElement ? source.videoWidth : source.width;
		const h = source instanceof HTMLVideoElement ? source.videoHeight : source.height;
		if (!w || !h) return [];
		const scale = Math.min(1, maxSide / Math.max(w, h));
		canvas.width = Math.round(w * scale);
		canvas.height = Math.round(h * scale);
		ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
		const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
		const code = jsQR(pixels.data, pixels.width, pixels.height, {
			inversionAttempts: 'attemptBoth'
		});
		return code ? [code.data] : [];
	};
}

/** The Matter setup payload among decoded codes ("MT:…"), if any. */
export const matterPayload = (codes: string[]) =>
	codes.map((c) => c.trim()).find((c) => c.toUpperCase().startsWith('MT:'));

/** Live camera scanning needs a secure context (https or localhost). */
export const canScanLive = () =>
	typeof window !== 'undefined' && window.isSecureContext && !!navigator.mediaDevices?.getUserMedia;
