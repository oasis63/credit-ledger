import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

/** Turn HTML into a PDF and open the share sheet (WhatsApp, email, Drive…). On web, opens the print dialog. */
export async function sharePdf(html: string, title: string): Promise<void> {
  if (Platform.OS === 'web') {
    await Print.printAsync({ html });
    return;
  }
  const { uri } = await Print.printToFileAsync({ html, base64: false });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: title, UTI: 'com.adobe.pdf' });
  } else {
    await Print.printAsync({ uri });
  }
}

export const esc = (s: string | null | undefined) =>
  (s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export const PDF_CSS = `
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Roboto, 'Noto Sans', Arial, sans-serif; color: #0f172a; margin: 28px; font-size: 13px; }
  h1 { color: #0f766e; margin: 0 0 4px; font-size: 22px; }
  .muted { color: #64748b; }
  .row { display: flex; justify-content: space-between; gap: 20px; }
  .box { border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px 16px; margin-top: 14px; }
  .big { font-size: 28px; font-weight: 800; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  th { text-align: left; background: #f1f5f9; font-size: 11px; text-transform: uppercase; color: #475569; padding: 7px; }
  td { padding: 7px; border-bottom: 1px solid #e2e8f0; }
  .num { text-align: right; white-space: nowrap; }
  .qr svg { width: 130px; height: 130px; }
  .total td { font-weight: 800; font-size: 15px; border-top: 2px solid #0f766e; }
  .label { font-size: 10px; letter-spacing: .1em; text-transform: uppercase; color: #64748b; font-weight: 700; }
`;
