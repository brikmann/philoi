import type { RefObject } from 'react';
import type { View } from 'react-native';

import { shareCardImage } from '@/lib/share-card';

export async function shareFireCompleteStory(cardRef: RefObject<View | null>): Promise<void> {
  await shareCardImage(cardRef, 'Share to your story');
}
