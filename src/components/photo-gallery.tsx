import { Image } from 'expo-image';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Colors, Radius } from '@/constants/theme';

// Measures its own width via onLayout rather than assuming window width, since the card this
// sits inside may have its own horizontal padding/margins in a list — pagingEnabled then
// snaps to that same measured width automatically. Shared by FeedItem and LockInEventCard.
export function PhotoGallery({ uris }: { uris: string[] }) {
  const [width, setWidth] = useState(0);
  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {width > 0 && (
        <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}>
          {uris.map((uri, index) => (
            <Image key={index} source={{ uri }} style={[styles.photo, { width }]} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  photo: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: Radius.input,
    backgroundColor: Colors.line,
  },
});
