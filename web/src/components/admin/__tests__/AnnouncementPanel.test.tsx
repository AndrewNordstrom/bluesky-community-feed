import { describe, expect, it, vi } from 'vitest';

import { openAnnouncementPost } from '../announcement-link';

describe('openAnnouncementPost', () => {
  it('opens outbound links with noopener and noreferrer flags', () => {
    const openMock = vi.fn();

    openAnnouncementPost('https://bsky.app/profile/test/post/123', openMock);

    expect(openMock).toHaveBeenCalledWith(
      'https://bsky.app/profile/test/post/123',
      '_blank',
      'noopener,noreferrer'
    );
  });
});
