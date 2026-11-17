import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PatronCrestTile } from '@/components/patron/patron-crest-tile';
import { PatronPicker } from '@/components/patron/patron-picker';
import { EmberFill } from '@/components/ui/ember-fill';
import { Icon } from '@/components/ui/icon';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { fetchProgramsForUniversity, setMyProgram } from '@/lib/api/house';
import { epicLockup, fetchPatronRoster, setMyPatron, type Patron } from '@/lib/api/patrons';
import { useAuth } from '@/lib/auth/auth-context';
import { getErrorMessage } from '@/lib/errors';
import { invalidateIdentityBadge } from '@/lib/house/identity-badges';
import type { ProgramRow } from '@/types/house';

// ─────────────── GYM SPARK · SETUP 2 of 2 — the Program + Patron selector rows (mock 405) ───────────────
//
// v2-fixes §2: program and patron are explicit selectors under the interest chips — not blended into
// them. Each SAVES ON PICK, through the same paths as the profile's Edit flow, so both are already on
// the profile when Continue runs the matching reveal. Neither is required to continue.
//
//   Program → profiles.program_id via set_my_program (the only writer; house/change-program.tsx does
//             the same + invalidateIdentityBadge + refreshProfile). The list is the user's own school's
//             (get_programs_for_university). No school, or a school with none → a disabled row.
//   Patron  → profiles.patron_key via setMyPatron (set_my_patron; it drops the cached identity badge
//             itself) + refreshProfile — as house/patron.tsx does. The picker IS PatronPicker.
//
// The patron reads as the app's Phase 9 lockup — epicLockup(patron, null), the bare persona name —
// not the retired "Heir to …" phrasing.

type ProgramLoad =
  | { state: 'none' }
  | { state: 'loading' }
  | { state: 'ready'; rows: ProgramRow[] }
  | { state: 'error' };

export function SparkIdentitySelectors() {
  const { profile, refreshProfile } = useAuth();
  const userId = profile?.id ?? null;
  const university = profile?.university ?? null;

  const [programs, setPrograms] = useState<ProgramRow[] | null>(null);
  const [programsFailed, setProgramsFailed] = useState(false);
  const [programsKey, setProgramsKey] = useState(0);
  const [roster, setRoster] = useState<Patron[] | null>(null);
  // What was picked here, shown until refreshProfile lands it on `profile`.
  const [pickedProgramId, setPickedProgramId] = useState<string | null>(null);
  const [pickedPatronKey, setPickedPatronKey] = useState<string | null>(null);
  const [sheet, setSheet] = useState<'program' | 'patron' | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!university) return;
    let live = true;
    fetchProgramsForUniversity(university)
      .then((rows) => {
        if (!live) return;
        setPrograms(rows);
        setProgramsFailed(false);
      })
      .catch((e) => {
        console.warn('[spark-identity] could not load programs:', e);
        if (live) setProgramsFailed(true);
      });
    return () => {
      live = false;
    };
  }, [university, programsKey]);

  useEffect(() => {
    let live = true;
    fetchPatronRoster()
      .then((r) => {
        if (live) setRoster(r);
      })
      .catch(() => {}); // The row falls back to its placeholder; the sheet shows its own failure.
    return () => {
      live = false;
    };
  }, []);

  const load: ProgramLoad = !university
    ? { state: 'none' }
    : programs
      ? { state: 'ready', rows: programs }
      : programsFailed
        ? { state: 'error' }
        : { state: 'loading' };

  const programId = pickedProgramId ?? profile?.program_id ?? null;
  const program = load.state === 'ready' ? (load.rows.find((p) => p.program_id === programId) ?? null) : null;
  const patronKey = pickedPatronKey ?? profile?.patron_key ?? null;
  const patron = roster?.find((p) => p.key === patronKey) ?? null;
  const noPrograms = load.state === 'none' || (load.state === 'ready' && load.rows.length === 0);

  function open(which: 'program' | 'patron') {
    setError(null);
    setSheet(which);
  }

  function close() {
    if (!saving) setSheet(null);
  }

  async function pickProgram(p: ProgramRow) {
    if (!userId || saving) return;
    if (p.program_id === programId) {
      setSheet(null);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await setMyProgram(p.program_id);
      setPickedProgramId(p.program_id);
      // The identity stack beside your name is cached for 10 min.
      invalidateIdentityBadge(userId);
      await refreshProfile();
      setSheet(null);
    } catch (e) {
      setError(getErrorMessage(e, 'Could not save your program — try again.'));
    } finally {
      setSaving(false);
    }
  }

  async function pickPatron(p: Patron) {
    if (!userId || saving) return;
    if (p.key === patronKey) {
      setSheet(null);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await setMyPatron(userId, p.key);
      setPickedPatronKey(p.key);
      await refreshProfile();
      setSheet(null);
    } catch (e) {
      setError(getErrorMessage(e, 'Could not save your patron — try again.'));
    } finally {
      setSaving(false);
    }
  }

  const programValue = program
    ? `${program.name}${program.program_abbrev ? ` (${program.program_abbrev})` : ''}`
    : noPrograms
      ? 'No programs listed for your school'
      : load.state === 'error'
        ? 'Couldn’t load programs — tap to retry'
        : 'Pick your program';

  return (
    <View style={styles.rows}>
      <SelectorRow
        label="Program"
        value={programValue}
        set={!!program}
        disabled={noPrograms || load.state === 'loading'}
        busy={load.state === 'loading'}
        tile={
          <View style={[styles.tile, styles.tileProgram]}>
            <Icon name="study" size={20} color="#0b1a2e" />
          </View>
        }
        onPress={() => {
          if (load.state === 'error') setProgramsKey((k) => k + 1);
          else open('program');
        }}
      />
      <SelectorRow
        label="Patron"
        value={patron ? (epicLockup(patron.name, null) ?? patron.name) : 'Pick your patron'}
        set={!!patron}
        ember
        tile={
          patron ? (
            <PatronCrestTile patronKey={patron.key} name={patron.name} size={46} />
          ) : (
            <EmberFill radius={12} style={styles.tile}>
              <Icon name="bolt" size={20} color={INK_ON_EMBER} />
            </EmberFill>
          )
        }
        onPress={() => open('patron')}
      />

      <Sheet visible={sheet === 'program'} onClose={close} title="Your program" sub={university ?? undefined}>
        {load.state === 'ready' ? (
          <ProgramList rows={load.rows} currentId={programId} saving={saving} onPick={(p) => void pickProgram(p)} />
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </Sheet>

      <Sheet
        visible={sheet === 'patron'}
        onClose={close}
        title="Your patron"
        sub="Just your vibe — pick the one that fits. Your program rides beside it.">
        <ScrollView style={styles.patronScroll} contentContainerStyle={styles.patronBody}>
          <PatronPicker value={patronKey} onChange={(p) => void pickPatron(p)} />
        </ScrollView>
        {saving ? <ActivityIndicator color={Colors.navEmber} style={styles.sheetBusy} /> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </Sheet>
    </View>
  );
}

function SelectorRow({
  label,
  value,
  set,
  ember = false,
  disabled = false,
  busy = false,
  tile,
  onPress,
}: {
  label: string;
  value: string;
  set: boolean;
  ember?: boolean;
  disabled?: boolean;
  busy?: boolean;
  tile: ReactNode;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.row, disabled && styles.rowDisabled, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityLabel={`${label}: ${value}`}>
      {tile}
      <View style={styles.rowText}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text
          style={[styles.rowValue, !set && styles.rowPlaceholder, set && ember && styles.rowValueEmber]}
          numberOfLines={1}>
          {value}
        </Text>
      </View>
      {busy ? (
        <ActivityIndicator size="small" color={Colors.spaceDim} />
      ) : disabled ? null : (
        <Icon name="forward" size={16} color={Colors.spaceDim} />
      )}
    </Pressable>
  );
}

function Sheet({
  visible,
  onClose,
  title,
  sub,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  sub?: string;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.three }]}>
          <View style={styles.grab} />
          <Text style={styles.sheetTitle}>{title}</Text>
          {sub ? <Text style={styles.sheetSub}>{sub}</Text> : null}
          {children}
        </View>
      </View>
    </Modal>
  );
}

/** The school's programs with a search on top (same name/short-form match as ProgramPicker). A tap saves. */
function ProgramList({
  rows,
  currentId,
  saving,
  onPick,
}: {
  rows: ProgramRow[];
  currentId: string | null;
  saving: boolean;
  onPick: (p: ProgramRow) => void;
}) {
  const [query, setQuery] = useState('');
  const [tapped, setTapped] = useState<string | null>(null);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((p) => p.name.toLowerCase().includes(q) || (p.program_abbrev?.toLowerCase().includes(q) ?? false));
  }, [rows, query]);

  return (
    <>
      <View style={styles.search}>
        <Icon name="search" size={16} color={Colors.spaceDim} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search your program"
          placeholderTextColor={Colors.spaceDim}
          style={styles.searchInput}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
        />
      </View>
      <FlatList
        data={matches}
        keyExtractor={(p) => p.program_id}
        style={styles.programList}
        contentContainerStyle={styles.programListBody}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => {
          const on = item.program_id === currentId;
          return (
            <Pressable
              onPress={() => {
                setTapped(item.program_id);
                onPick(item);
              }}
              disabled={saving}
              style={({ pressed }) => [styles.progRow, on && styles.progRowOn, pressed && styles.pressed]}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={item.name}>
              <Text style={styles.progName} numberOfLines={1}>
                {item.name}
              </Text>
              {saving && tapped === item.program_id ? (
                <ActivityIndicator size="small" color={Colors.navEmber} />
              ) : on ? (
                <Icon name="check" size={15} color={Colors.navEmber2} />
              ) : item.program_abbrev ? (
                <Text style={styles.progAbbrev}>{item.program_abbrev}</Text>
              ) : null}
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <Text style={styles.empty}>Nothing matches &quot;{query.trim()}&quot; — try its full name or a short form.</Text>
        }
      />
    </>
  );
}

const INK_ON_EMBER = '#160d26';

const styles = StyleSheet.create({
  rows: {
    gap: 10,
    marginTop: Spacing.three,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    backgroundColor: 'rgba(26,18,48,0.6)',
  },
  rowDisabled: {
    opacity: 0.6,
  },
  pressed: {
    opacity: 0.85,
  },
  tile: {
    width: 46,
    height: 46,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  tileProgram: {
    backgroundColor: '#4FB8E0',
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    color: Colors.spaceDim,
  },
  rowValue: {
    fontFamily: Fonts.bodyBold,
    fontSize: 15,
    color: Colors.ink,
    marginTop: 2,
  },
  rowValueEmber: {
    color: Colors.navEmber2,
  },
  rowPlaceholder: {
    fontFamily: Fonts.bodySemiBold,
    color: Colors.spaceDim,
  },
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(6,4,10,0.55)',
  },
  sheet: {
    maxHeight: '86%',
    backgroundColor: 'rgba(14,10,28,0.98)',
    borderTopWidth: 1,
    borderTopColor: Colors.spaceLine,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingTop: 8,
    paddingHorizontal: Spacing.three,
  },
  grab: {
    width: 38,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: Colors.spaceLine,
    alignSelf: 'center',
    marginTop: 4,
    marginBottom: 14,
  },
  sheetTitle: {
    fontFamily: Fonts.black,
    fontSize: 18,
    color: Colors.ink,
  },
  sheetSub: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    lineHeight: 18,
    color: Colors.spaceDim,
    marginTop: 3,
  },
  sheetBusy: {
    marginTop: Spacing.two,
  },
  // The first patron card used to sit flush against the scroll edge and read as clipped (v2 §0.4).
  // flexShrink lets the list scroll inside the sheet's maxHeight instead of overflowing it.
  patronScroll: {
    flexShrink: 1,
    marginTop: Spacing.two,
  },
  patronBody: {
    paddingTop: Spacing.three,
    paddingBottom: Spacing.three,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginTop: Spacing.three,
    backgroundColor: 'rgba(26,18,48,0.6)',
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    borderRadius: 13,
    paddingHorizontal: 14,
  },
  searchInput: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 13.5,
    letterSpacing: 0,
    color: Colors.ink,
    paddingVertical: 11,
  },
  programList: {
    flexShrink: 1,
    marginTop: Spacing.two,
  },
  programListBody: {
    paddingTop: Spacing.one,
    paddingBottom: Spacing.two,
    gap: 6,
  },
  progRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 13,
    paddingHorizontal: 14,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: Colors.spaceLine,
    backgroundColor: 'rgba(26,18,48,0.65)',
  },
  progRowOn: {
    borderColor: Colors.navEmber2,
    backgroundColor: 'rgba(255,122,47,0.10)',
  },
  progName: {
    flex: 1,
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.ink,
  },
  progAbbrev: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    color: Colors.spaceDim,
  },
  empty: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    lineHeight: 18,
    color: Colors.spaceDim,
    paddingVertical: Spacing.three,
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.danger,
    marginTop: Spacing.two,
  },
});
