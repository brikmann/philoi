import { Switch, type SwitchProps } from 'react-native';

import { Colors } from '@/constants/theme';

// Wraps Switch with the brand's on/off colors explicit on both trackColor AND thumbColor —
// without thumbColor set, Android falls back to the system theme accent (teal on most
// devices) even when trackColor is customized, which is why toggles were inconsistent with
// the rest of the app's orange accent.
export function Toggle(props: SwitchProps) {
  return (
    <Switch
      trackColor={{ true: Colors.coral, false: Colors.line }}
      thumbColor="#FFFFFF"
      ios_backgroundColor={Colors.line}
      {...props}
    />
  );
}
