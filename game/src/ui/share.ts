/**
 * Saving and sharing a picture (the results screen's 「儲存到相簿」 / 「分享」).
 *
 * In the iOS / Android app: the app's own PhotoSaver plugin adds the PNG to the photo library (ios/App/App/AppDelegate.swift,
 * android/.../PhotoSaverPlugin.java), and @capacitor/share opens the system share sheet with the PNG written to the cache
 * by @capacitor/filesystem. On the web: a download, and navigator.share with the file where the browser can.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';

interface PhotoSaverPlugin { save(o: { data: string; name?: string }): Promise<void> }
const PhotoSaver = registerPlugin<PhotoSaverPlugin>('PhotoSaver');

const native = () => Capacitor.isNativePlatform();

function blobOf(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('無法產生圖片'))), 'image/png'));
}
const base64Of = (canvas: HTMLCanvasElement) => canvas.toDataURL('image/png').split(',')[1] ?? '';

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `${name}.png`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Saves the picture: into the photo library in the app, as a download on the web. */
export async function saveImage(canvas: HTMLCanvasElement, name: string): Promise<'saved' | 'downloaded'> {
  if (native()) { await PhotoSaver.save({ data: base64Of(canvas), name }); return 'saved'; }
  download(await blobOf(canvas), name);
  return 'downloaded';
}

/** Opens the share sheet with the picture; falls back to a download where sharing files is not possible. */
export async function shareImage(canvas: HTMLCanvasElement, name: string, text: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  if (native()) {
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')]);
    const { uri } = await Filesystem.writeFile({ path: `${name}.png`, data: base64Of(canvas), directory: Directory.Cache });
    try { await Share.share({ title: '大富翁4', text, files: [uri], dialogTitle: '分享成績' }); } catch (e) {
      if (/cancel/i.test(String((e as Error)?.message ?? e))) return 'cancelled';
      throw e;
    }
    return 'shared';
  }
  const blob = await blobOf(canvas);
  const file = new File([blob], `${name}.png`, { type: 'image/png' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try { await nav.share({ files: [file], title: '大富翁4', text }); return 'shared'; } catch (e) {
      if ((e as Error)?.name === 'AbortError') return 'cancelled';
    }
  }
  download(blob, name);
  return 'downloaded';
}
