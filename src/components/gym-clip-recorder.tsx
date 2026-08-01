import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useGymClipQuota } from '@/hooks/use-gym-clip-quota';
import { attachWorkoutSetClip, requestClipUploadUrls, uploadClipAsset } from '@/lib/api/gym-clips';
import { GYM_CLIP_TIER_CONFIG } from '@/lib/gym-clip-tiers';
import { getErrorMessage } from '@/lib/errors';
import type { WorkoutSet } from '@/types/database';

type Stage = 'loading' | 'quota_exceeded' | 'permission' | 'ready' | 'recording' | 'processing' | 'error';

type GymClipRecorderProps = {
  visible: boolean;
  workoutSetId: string;
  /** "Film this PR?" vs. a plain manual tap (PHILOI_UI_SPEC.md §23's two triggers) — copy only. */
  isPrPrompt?: boolean;
  onClose: () => void;
  onCaptured: (set: WorkoutSet) => void;
};

// Records, compresses, and uploads ONE opt-in per-set clip (PHILOI_UI_SPEC.md §23) — never
// auto-filmed. Always skippable via the close button at every stage except the few seconds of
// actual upload. Native modules (expo-camera, expo-video-thumbnails, react-native-compressor)
// are required lazily inside the component body, not at module scope — this file predates any
// build that actually compiles them in (see GYM_VIDEO_CLIPS_ENABLED), and an eager top-level
// import would crash an old binary's bundle eval the moment anything reaches this file at all,
// same reasoning as photo-viewer.tsx's deferred expo-media-library require.
export function GymClipRecorder({ visible, workoutSetId, isPrPrompt, onClose, onCaptured }: GymClipRecorderProps) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- deferred native import, see comment above
  const { CameraView, useCameraPermissions, useMicrophonePermissions } = require('expo-camera') as typeof import('expo-camera');

  const cameraRef = useRef<InstanceType<typeof CameraView>>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();
  const { quota, loading: quotaLoading, refetch: refetchQuota } = useGymClipQuota();

  const [stage, setStage] = useState<Stage>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [elapsedS, setElapsedS] = useState(0);
  const recordStartRef = useRef<number | null>(null);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const tier = quota?.tier ?? 'free';
  const tierConfig = GYM_CLIP_TIER_CONFIG[tier];

  useEffect(() => {
    if (!visible) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets on each open, not a render-loop risk
    setStage('loading');
    setElapsedS(0);
  }, [visible]);

  useEffect(() => {
    if (!visible || quotaLoading) return;
    if (quota?.tier === 'free' && (quota.remaining ?? 0) <= 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- derived from quota/permission state resolving, not a render-loop risk
      setStage('quota_exceeded');
      return;
    }
    if (!cameraPermission?.granted || !micPermission?.granted) {
      setStage('permission');
      return;
    }
    setStage((s) => (s === 'loading' || s === 'permission' ? 'ready' : s));
  }, [visible, quotaLoading, quota, cameraPermission?.granted, micPermission?.granted]);

  async function handleRequestPermissions() {
    const cam = cameraPermission?.granted ? cameraPermission : await requestCameraPermission();
    const mic = micPermission?.granted ? micPermission : await requestMicPermission();
    if (cam.granted && mic.granted) setStage('ready');
  }

  function stopElapsedTimer() {
    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    elapsedTimerRef.current = null;
  }

  async function handleStartRecording() {
    if (!cameraRef.current) return;
    setStage('recording');
    recordStartRef.current = Date.now();
    setElapsedS(0);
    elapsedTimerRef.current = setInterval(() => {
      setElapsedS((s) => s + 0.2);
    }, 200);

    try {
      const result = await cameraRef.current.recordAsync({ maxDuration: tierConfig.maxDurationS });
      stopElapsedTimer();
      if (!result?.uri) {
        setStage('ready');
        return;
      }
      await processAndUpload(result.uri);
    } catch (e) {
      stopElapsedTimer();
      setErrorMessage(getErrorMessage(e, 'Recording failed.'));
      setStage('error');
    }
  }

  function handleStopRecording() {
    cameraRef.current?.stopRecording();
  }

  async function processAndUpload(rawUri: string) {
    setStage('processing');
    try {
      const durationS = recordStartRef.current ? (Date.now() - recordStartRef.current) / 1000 : tierConfig.maxDurationS;

      // eslint-disable-next-line @typescript-eslint/no-require-imports -- deferred native import
      const { Video: VideoCompressor } = require('react-native-compressor') as typeof import('react-native-compressor');
      const compressedUri = await VideoCompressor.compress(rawUri, {
        compressionMethod: 'auto',
        maxSize: tierConfig.maxSizePx,
      });

      // eslint-disable-next-line @typescript-eslint/no-require-imports -- deferred native import
      const VideoThumbnails = require('expo-video-thumbnails') as typeof import('expo-video-thumbnails');
      const thumbnail = await VideoThumbnails.getThumbnailAsync(compressedUri, { time: 0 });

      const urls = await requestClipUploadUrls(workoutSetId);
      await Promise.all([
        uploadClipAsset(urls.videoUploadUrl, compressedUri, 'video/mp4'),
        uploadClipAsset(urls.thumbUploadUrl, thumbnail.uri, 'image/jpeg'),
      ]);

      const updatedSet = await attachWorkoutSetClip({
        workoutSetId,
        videoKey: urls.videoKey,
        thumbKey: urls.thumbKey,
        durationS,
        resolution: tierConfig.resolution,
      });

      refetchQuota();
      onCaptured(updatedSet);
    } catch (e) {
      setErrorMessage(getErrorMessage(e, 'Could not save this clip.'));
      setStage('error');
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        {stage === 'ready' || stage === 'recording' ? (
          <CameraView ref={cameraRef} style={styles.camera} facing="back" mode="video" mute={false} />
        ) : (
          <View style={[styles.camera, styles.centerFill]}>
            {stage === 'loading' && <ActivityIndicator color={Colors.coral} />}
            {stage === 'quota_exceeded' && (
              <>
                <Ionicons name="videocam-off-outline" size={32} color={Colors.textTertiary} />
                <Text style={styles.centerTitle}>You’re out of free clips this month</Text>
                <Text style={styles.centerBody}>Upgrade for unlimited clips at 1080p/60fps — or wait until next month.</Text>
              </>
            )}
            {stage === 'permission' && (
              <>
                <Ionicons name="camera-outline" size={32} color={Colors.amber} />
                <Text style={styles.centerTitle}>Camera & mic access</Text>
                <Text style={styles.centerBody}>Philoi needs these to film this set’s clip.</Text>
                <Pressable style={styles.primaryBtn} onPress={handleRequestPermissions}>
                  <Text style={styles.primaryBtnLabel}>Allow access</Text>
                </Pressable>
              </>
            )}
            {stage === 'processing' && (
              <>
                <ActivityIndicator color={Colors.coral} />
                <Text style={styles.centerTitle}>Saving your clip…</Text>
              </>
            )}
            {stage === 'error' && (
              <>
                <Ionicons name="warning-outline" size={32} color={Colors.danger} />
                <Text style={styles.centerTitle}>{errorMessage}</Text>
                <Pressable style={styles.primaryBtn} onPress={() => setStage('ready')}>
                  <Text style={styles.primaryBtnLabel}>Try again</Text>
                </Pressable>
              </>
            )}
          </View>
        )}

        <View style={styles.topBar}>
          <Pressable onPress={onClose} hitSlop={8} disabled={stage === 'processing'} accessibilityLabel="Close">
            <Ionicons name="close" size={26} color={Colors.ink} />
          </Pressable>
          {isPrPrompt && stage === 'ready' && <Text style={styles.prBadge}>🏆 Film this PR?</Text>}
          {tier === 'free' && quota && (
            <Text style={styles.quotaText}>{quota.remaining} clip{quota.remaining === 1 ? '' : 's'} left this month</Text>
          )}
        </View>

        {(stage === 'ready' || stage === 'recording') && (
          <View style={styles.bottomBar}>
            <Text style={styles.timer}>
              {elapsedS.toFixed(0)}s / {tierConfig.maxDurationS}s
            </Text>
            <Pressable
              style={[styles.recordBtn, stage === 'recording' && styles.recordBtnActive]}
              onPress={stage === 'recording' ? handleStopRecording : handleStartRecording}
              accessibilityLabel={stage === 'recording' ? 'Stop recording' : 'Start recording'}>
              <View style={[styles.recordBtnInner, stage === 'recording' && styles.recordBtnInnerActive]} />
            </Pressable>
            <Text style={styles.skipHint}>Always optional — skip anytime</Text>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  camera: {
    flex: 1,
  },
  centerFill: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.five,
  },
  centerTitle: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 16,
    color: Colors.ink,
    textAlign: 'center',
  },
  centerBody: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.muted,
    textAlign: 'center',
  },
  primaryBtn: {
    marginTop: Spacing.two,
    backgroundColor: Colors.coral,
    borderRadius: Radius.button,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.five,
  },
  primaryBtnLabel: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 14,
    color: Colors.ink,
  },
  topBar: {
    position: 'absolute',
    top: 56,
    left: Spacing.four,
    right: Spacing.four,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  prBadge: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.ember,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: Radius.pill,
    paddingVertical: 5,
    paddingHorizontal: 11,
  },
  quotaText: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.ink,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: Radius.pill,
    paddingVertical: 4,
    paddingHorizontal: 9,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 48,
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: Spacing.two,
  },
  timer: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.ink,
    fontVariant: ['tabular-nums'],
  },
  recordBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordBtnActive: {
    borderColor: Colors.coral,
  },
  recordBtnInner: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: Colors.coral,
  },
  recordBtnInnerActive: {
    width: 26,
    height: 26,
    borderRadius: 6,
  },
  skipHint: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: 'rgba(255,255,255,0.6)',
  },
});
