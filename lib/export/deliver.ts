/**
 * Hand a generated workbook to the user: the phone share sheet when the
 * browser offers one, a plain download otherwise. One implementation on
 * purpose — the files-only rule below was learned the hard way and must not
 * drift between the export button and history re-downloads.
 */
export async function deliverFile(blob: Blob, filename: string): Promise<void> {
  const file = new File([blob], filename, { type: blob.type });
  const nav = navigator as Navigator & {
    canShare?: (data: { files: File[] }) => boolean;
    share?: (data: { files: File[] }) => Promise<void>;
  };

  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      // Files only — passing `title`/`text` makes iOS attach a second,
      // useless .txt item alongside the workbook in the share sheet.
      await nav.share({ files: [file] });
      return;
    } catch {
      // User cancelled the share sheet, or it failed — fall back to download.
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
