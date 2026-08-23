import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { CindyActionChip } from '@/components/cindy/cindy-action-chip';
import { PersonalFlame } from '@/components/personal-flame';
import { Screen } from '@/components/ui/screen';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useReduceMotion } from '@/hooks/use-reduce-motion';
import { useActiveSession } from '@/lib/active-session-context';
import { useAuth } from '@/lib/auth/auth-context';
import { CoachError, performCoachAction, recordCoachAction, speakToCindy, type CoachAction } from '@/lib/api/coach';

// TAP TO TALK — mock 115 frame 4, built the cheap way (CINDY_SPEC "STT-only architecture").
//
//     on-device STT (free)  →  Sonnet  →  ElevenLabs TTS (her reply only)
//
// The platform recognizer does the transcription right here on the phone, so no microphone audio
// ever leaves the device and speech-to-text costs nothing. What gets posted is a string — the
// same thing typing would have produced, which is exactly why a voice turn lands in the same
// conversation as a typed one.
//
// WALKIE-TALKIE, NOT AN OPEN LINE. `continuous: false` means the recognizer ends itself after a
// natural pause, which IS the spec's "auto-send on a pause": the user just stops speaking and the
// turn goes. No Send button, and no always-listening loop to pay for.
//
// She is the same flame here too — PersonalFlame renders the equipped cosmetic, so the thing
// being talked to visibly IS the flame the user has been growing.

type Phase = 'idle' | 'listening' | 'thinking' | 'speaking';

/** Bars of the mock's waveform. Heights are the mock's, animated out of phase. */
const BARS = [12, 26, 18, 32, 14, 24, 10];

export default function CindyVoiceScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const { session: activeSession, start, clear } = useActiveSession();
  const reduceMotion = useReduceMotion();
  const player = useAudioPlayer(null);

  const [phase, setPhase] = useState<Phase>('idle');
  const [heard, setHeard] = useState('');
  const [reply, setReply] = useState<string | null>(null);
  const [action, setAction] = useState<CoachAction | null>(null);
  const [busyAction, setBusyAction] = useState(false);
  const [capped, setCapped] = useState(false);

  // The recognizer streams interim results and then ends. `end` is what fires the send, but it
  // fires AFTER the last result — so the final transcript has to be held in a ref rather than
  // read from state, which would still be the previous render's value at that moment.
  const finalTranscript = useRef('');
  const sending = useRef(false);

  useEffect(() => {
    (async () => {
      const perms = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!perms.granted) {
        Alert.alert('Microphone needed', 'Cindy needs the mic to hear you. You can still type to her.', [
          { text: 'OK', onPress: () => router.back() },
        ]);
        return;
      }
      // playsInSilentMode so her reply is audible with the ringer switch off — someone walking to
      // class with a silenced phone still expects a voice conversation to make sound.
      await setAudioModeAsync({ playsInSilentMode: true });
    })();
  }, [router]);

  useSpeechRecognitionEvent('result', (event) => {
    const text = event.results[0]?.transcript ?? '';
    setHeard(text);
    if (text) finalTranscript.current = text;
  });

  // Fires after the natural pause. This is the auto-send.
  useSpeechRecognitionEvent('end', () => {
    const text = finalTranscript.current.trim();
    if (!text || sending.current) {
      setPhase((p) => (p === 'listening' ? 'idle' : p));
      return;
    }
    void send(text);
  });

  useSpeechRecognitionEvent('error', (event) => {
    setPhase('idle');
    // 'no-speech' is the ordinary "they tapped and said nothing" case, not a failure worth an
    // alert — the screen just goes back to idle and waits.
    if (event.error !== 'no-speech') {
      console.error('[cindy-voice] recognition error:', event.error, event.message);
    }
  });

  function listen() {
    setHeard('');
    setReply(null);
    setAction(null);
    setCapped(false);
    finalTranscript.current = '';
    ExpoSpeechRecognitionModule.start({
      lang: 'en-US',
      // Interim results drive the live "what she's hearing" text; continuous:false is what makes
      // the recognizer stop on its own after a pause instead of holding the mic open.
      interimResults: true,
      continuous: false,
      addsPunctuation: true,
      iosTaskHint: 'dictation',
    });
    setPhase('listening');
  }

  function stopListening() {
    // Ends capture and lets the recognizer emit its final result; the `end` handler sends.
    ExpoSpeechRecognitionModule.stop();
  }

  async function send(transcript: string) {
    sending.current = true;
    setPhase('thinking');
    try {
      const turn = await speakToCindy(transcript);
      setHeard(turn.transcript);
      setReply(turn.text);
      setAction(turn.action ? { ...turn.action, status: 'proposed' } : null);
      setCapped(turn.voice_capped);

      if (turn.audio) {
        // Written to a cache file rather than played as a data: URI — ExoPlayer's data-URI
        // support is unreliable on Android, and a reply that only speaks on one platform is
        // worse than one that speaks on neither.
        const out = new File(Paths.cache, `cindy-${Date.now()}.mp3`);
        out.create({ overwrite: true });
        out.write(turn.audio, { encoding: 'base64' });
        player.replace({ uri: out.uri });
        player.play();
        setPhase('speaking');
      } else {
        // Budget spent — she still answered, just silently. Losing her voice for the day must
        // not mean losing her answer.
        setPhase('idle');
      }

      if (turn.action?.effect === 'auto') await runAction(turn.action);
    } catch (e) {
      setPhase('idle');
      if (e instanceof CoachError && e.code === 'no_speech') {
        Alert.alert('Cindy', "I didn't catch that — try again?");
      } else {
        Alert.alert('Cindy', e instanceof CoachError ? e.message : 'That did not go through.');
      }
    } finally {
      sending.current = false;
    }
  }

  async function runAction(pending: CoachAction) {
    if (!session) return;
    setBusyAction(true);
    try {
      const outcome = await performCoachAction(pending, {
        userId: session.user.id,
        activeSession: activeSession ? { id: activeSession.id, goalType: activeSession.goalType } : null,
        startSession: start,
        clearSession: clear,
      });
      setAction({ ...pending, status: outcome.status });
      await recordCoachAction(pending, outcome.status);
      if (outcome.route) router.push(outcome.route as never);
    } finally {
      setBusyAction(false);
    }
  }

  const listening = phase === 'listening';

  return (
    <Screen padded={false}>
      <View style={styles.top}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Close">
          <Ionicons name="chevron-down" size={24} color={Colors.muted} />
        </Pressable>
        <Text style={styles.eyebrow}>TALKING TO CINDY</Text>
        <View style={styles.topSpacer} />
      </View>

      <View style={styles.stage}>
        <PersonalFlame size={132} />
        <Waveform active={listening || phase === 'speaking'} reduceMotion={reduceMotion} />

        {heard.length > 0 && <Text style={styles.transcript}>&ldquo;{heard}&rdquo;</Text>}
        {reply && <Text style={styles.reply}>{reply}</Text>}
        {heard.length === 0 && (
          <Text style={styles.hint}>
            {listening
              ? "I'm listening — just stop when you're done."
              : phase === 'thinking'
                ? 'One sec…'
                : 'Tap to talk — hands-free while you walk to class or set up at the gym.'}
          </Text>
        )}
        {capped && <Text style={styles.capped}>Out of voice for today — she&apos;s still here in text.</Text>}

        {action && (
          <View style={styles.actionWrap}>
            <CindyActionChip
              action={action}
              busy={busyAction}
              onConfirm={() => runAction(action)}
              onDecline={async () => {
                setAction({ ...action, status: 'declined' });
                await recordCoachAction(action, 'declined');
              }}
            />
          </View>
        )}
      </View>

      <View style={styles.footer}>
        <Pressable
          onPress={listening ? stopListening : listen}
          disabled={phase === 'thinking'}
          style={[styles.talk, listening && styles.talkStop, phase === 'thinking' && styles.talkOff]}
          accessibilityRole="button"
          accessibilityLabel={listening ? 'Stop and send' : 'Start talking'}>
          <Ionicons
            name={listening ? 'stop' : phase === 'thinking' ? 'hourglass-outline' : 'mic'}
            size={18}
            color={listening ? Colors.danger : Colors.onEmber}
          />
          <Text style={[styles.talkLabel, listening && styles.talkStopLabel]}>
            {listening ? 'Tap to stop' : phase === 'thinking' ? 'Thinking…' : 'Tap to talk'}
          </Text>
        </Pressable>
        <Text style={styles.credit}>Cindy by Sonnet · her voice by ElevenLabs</Text>
      </View>
    </Screen>
  );
}

/** The mock's seven bars. Decorative — not driven by real amplitude, and fully still under
 *  reduce-motion rather than merely slower. */
function Waveform({ active, reduceMotion }: { active: boolean; reduceMotion: boolean }) {
  const t = useSharedValue(0);
  useEffect(() => {
    if (!active || reduceMotion) {
      t.value = 0;
      return;
    }
    t.value = withRepeat(withTiming(1, { duration: 620, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [active, reduceMotion, t]);

  return (
    <View style={styles.wave}>
      {BARS.map((height, i) => (
        <WaveBar key={i} height={height} index={i} t={t} />
      ))}
    </View>
  );
}

function WaveBar({ height, index, t }: { height: number; index: number; t: { value: number } }) {
  // Neighbouring bars scale out of phase, which is what stops seven bars reading as one block
  // pulsing — the same trick the flame tongues use in heat-flame.tsx.
  const phase = index % 2 === 0 ? 1 : -1;
  const style = useAnimatedStyle(() => ({
    transform: [{ scaleY: 1 + t.value * 0.55 * phase }],
  }));
  return <Animated.View style={[styles.bar, { height }, style]} />;
}

const styles = StyleSheet.create({
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
  },
  eyebrow: {
    flex: 1,
    textAlign: 'center',
    fontFamily: Fonts.bodyBold,
    fontSize: 10,
    letterSpacing: 0.7,
    color: Colors.amber,
  },
  topSpacer: { width: 24 },

  stage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
    gap: Spacing.twelve,
  },
  wave: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 34 },
  bar: { width: 4, borderRadius: 2, backgroundColor: Colors.amber },

  transcript: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 15,
    lineHeight: 21,
    color: Colors.ink,
    textAlign: 'center',
  },
  reply: {
    fontFamily: Fonts.body,
    fontSize: 13.5,
    lineHeight: 20,
    color: Colors.muted,
    textAlign: 'center',
  },
  hint: {
    fontFamily: Fonts.body,
    fontSize: 12,
    lineHeight: 18,
    color: Colors.textTertiary,
    textAlign: 'center',
    maxWidth: 250,
  },
  capped: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textTertiary, textAlign: 'center' },
  actionWrap: { marginTop: Spacing.two },

  footer: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.four, gap: Spacing.twelve },
  talk: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    backgroundColor: Colors.amber,
    borderRadius: Radius.input,
    paddingVertical: Spacing.three,
  },
  talkStop: {
    backgroundColor: Colors.dangerBg,
    borderWidth: 1,
    borderColor: 'rgba(255,120,90,0.4)',
  },
  talkOff: { backgroundColor: Colors.disabledSurface },
  talkLabel: { fontFamily: Fonts.bodyBold, fontSize: 14, color: Colors.onEmber },
  talkStopLabel: { color: Colors.danger },
  credit: { fontFamily: Fonts.body, fontSize: 9, color: Colors.textTertiary, textAlign: 'center' },
});
