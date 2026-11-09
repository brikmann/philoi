import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { ART_KINDS, ART_SOURCE_LABEL, resolveArt, type ArtEntity, type ArtKind } from '@/lib/api/art';
import { getErrorMessage } from '@/lib/errors';

// THE TAG SHEET (ShareSpot §5) — "what are you into?" with the thing's REAL art.
//
// Pick a kind (Game · Song · Film · Show · Book), type, and the resolver answers with real artwork:
// "minecraft" shows Minecraft's key art, a song its album cover, a film its poster. Search runs
// server-side (resolve-art), debounced, and is cached there per (kind, query) — this sheet holds no
// keys and no SDKs. Picking hands the entity back; the composer attaches only its canonical id.

const DEBOUNCE_MS = 350;

export function ArtTagSheet({
  visible,
  onClose,
  onPick,
  initialKind = 'game',
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (entity: ArtEntity) => void;
  initialKind?: ArtKind;
}) {
  const [kind, setKind] = useState<ArtKind>(initialKind);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<ArtEntity[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  // Bumped per search, so a slow answer for "mine" can't overwrite the one for "minecraft".
  const run = useRef(0);

  const q = query.trim();
  const kindMeta = ART_KINDS.find((k) => k.key === kind) ?? ART_KINDS[0];

  // A query under two characters shows the prompt, whatever the last search left in state —
  // derived here at render rather than reset from the effect.
  const searching = visible && q.length >= 2;
  const results = searching ? found : null;
  const loading = searching && busy;
  const error = searching ? failed : null;

  useEffect(() => {
    const id = (run.current += 1);
    if (!visible || q.length < 2) return;
    const t = setTimeout(() => {
      setBusy(true);
      setFailed(null);
      resolveArt(kind, q)
        .then((r) => {
          if (id === run.current) setFound(r);
        })
        .catch((e) => {
          if (id === run.current) setFailed(getErrorMessage(e, 'Could not search right now.'));
        })
        .finally(() => {
          if (id === run.current) setBusy(false);
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [visible, kind, q]);

  function close() {
    setQuery('');
    setFound(null);
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={close} accessibilityLabel="Close" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.sheetWrap}>
        <View style={styles.sheet}>
          <View style={styles.head}>
            <Text style={styles.title}>Tag what you’re into</Text>
            <Pressable onPress={close} hitSlop={10} accessibilityLabel="Close">
              <Ionicons name="close" size={20} color={Colors.muted} />
            </Pressable>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.kinds}>
            {ART_KINDS.map((k) => (
              <Pressable
                key={k.key}
                onPress={() => setKind(k.key)}
                style={[styles.kind, kind === k.key && styles.kindOn]}
                accessibilityRole="button"
                accessibilityState={{ selected: kind === k.key }}>
                <Text style={[styles.kindText, kind === k.key && styles.kindTextOn]}>{k.label}</Text>
              </Pressable>
            ))}
          </ScrollView>

          <View style={styles.search}>
            <Ionicons name="search" size={16} color={Colors.textTertiary} />
            <TextInput
              style={styles.input}
              value={query}
              onChangeText={setQuery}
              placeholder={kindMeta.placeholder}
              placeholderTextColor={Colors.textTertiary}
              autoFocus
              autoCorrect={false}
              returnKeyType="search"
              accessibilityLabel={`Search ${kindMeta.label.toLowerCase()}s`}
            />
            {loading ? <ActivityIndicator size="small" color={Colors.navEmber2} /> : null}
          </View>

          <ScrollView style={styles.results} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.grid}>
            {error ? (
              <Text style={styles.empty}>{error}</Text>
            ) : results === null ? (
              <Text style={styles.empty}>Search for a {kindMeta.label.toLowerCase()} to show its real art on your post.</Text>
            ) : results.length === 0 && !loading ? (
              <Text style={styles.empty}>Nothing found for “{q}”.</Text>
            ) : (
              results.map((r) => (
                <Pressable
                  key={r.canonical_id}
                  style={styles.cell}
                  onPress={() => {
                    onPick(r);
                    close();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={[r.title, r.subtitle].filter(Boolean).join(', ')}>
                  <View style={[styles.art, { aspectRatio: kind === 'film' || kind === 'show' || kind === 'book' ? 2 / 3 : 1 }]}>
                    <Image source={{ uri: r.art_url }} style={StyleSheet.absoluteFill} contentFit="cover" transition={120} />
                  </View>
                  <Text style={styles.cellTitle} numberOfLines={2}>
                    {r.title}
                  </Text>
                  {r.subtitle ? (
                    <Text style={styles.cellSub} numberOfLines={1}>
                      {r.subtitle}
                    </Text>
                  ) : null}
                </Pressable>
              ))
            )}
          </ScrollView>
          {results?.length ? (
            <Text style={styles.credit}>Art via {Array.from(new Set(results.map((r) => ART_SOURCE_LABEL[r.source]))).join(', ')}</Text>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(5,3,14,0.6)' },
  sheetWrap: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '82%',
    minHeight: '62%',
    backgroundColor: '#140E26',
    borderTopWidth: 1,
    borderColor: Colors.spaceLine,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: Spacing.three,
    paddingBottom: Spacing.five,
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.twelve },
  title: { fontFamily: Fonts.bodyBold, fontSize: 15, color: Colors.ink },
  kinds: { gap: 7, paddingBottom: Spacing.twelve },
  kind: {
    borderRadius: Radius.pill,
    paddingHorizontal: 13,
    paddingVertical: 7,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  kindOn: { backgroundColor: Colors.navEmber, borderColor: 'transparent' },
  kindText: { fontFamily: Fonts.bodyBold, fontSize: 12, color: Colors.ink },
  kindTextOn: { color: Colors.onEmber },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderRadius: 13,
    paddingHorizontal: 13,
    paddingVertical: Platform.OS === 'ios' ? 11 : 4,
    backgroundColor: Colors.spacePanel,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
  },
  input: { flex: 1, fontFamily: Fonts.body, fontSize: 14, color: Colors.ink },
  results: { marginTop: Spacing.twelve },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  empty: { fontFamily: Fonts.body, fontSize: 12, lineHeight: 18, color: Colors.textTertiary, marginTop: Spacing.two },
  cell: { width: '31%' },
  art: { width: '100%', borderRadius: 10, overflow: 'hidden', backgroundColor: Colors.spacePanel },
  cellTitle: { fontFamily: Fonts.bodyBold, fontSize: 11.5, color: Colors.ink, marginTop: 5 },
  cellSub: { fontFamily: Fonts.body, fontSize: 10, color: Colors.textTertiary, marginTop: 1 },
  credit: { fontFamily: Fonts.body, fontSize: 9.5, color: Colors.spaceFaint, marginTop: Spacing.two, textAlign: 'right' },
});
