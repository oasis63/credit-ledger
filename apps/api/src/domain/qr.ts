import QRCode from 'qrcode';

/** Render text (e.g. a upi://pay link) as a compact, self-contained SVG QR code. */
export async function qrSvg(text: string): Promise<string> {
  return QRCode.toString(text, { type: 'svg', errorCorrectionLevel: 'M', margin: 1, color: { dark: '#111827', light: '#ffffff' } });
}
