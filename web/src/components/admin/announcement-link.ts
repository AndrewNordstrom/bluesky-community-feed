export function openAnnouncementPost(
  postUrl: string,
  openFn: (url?: string | URL, target?: string, features?: string) => WindowProxy | null = window.open
): void {
  openFn(postUrl, '_blank', 'noopener,noreferrer');
}
