// Configured pdfmake instance. pdfmake 0.3.x exports the virtual font filesystem (Roboto) directly
// from build/vfs_fonts, so we assign it onto pdfMake.vfs before any createPdf() call.
import pdfMake from 'pdfmake/build/pdfmake';
import vfsFonts from 'pdfmake/build/vfs_fonts';
import type { TDocumentDefinitions, TCreatedPdf } from 'pdfmake/interfaces';

const fonts = vfsFonts as unknown as Record<string, string>;
(pdfMake as unknown as { vfs: Record<string, string> }).vfs = fonts;

export function createPdf(def: TDocumentDefinitions): TCreatedPdf {
  return pdfMake.createPdf(def);
}
