import NetInfo from '@react-native-community/netinfo';
import { useEffect, useState } from 'react';

export function useNetworkStatus() {
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    return NetInfo.addEventListener((state) => {
      // isInternetReachable is null while NetInfo is still figuring it out — don't flash
      // the banner during that brief unknown window, only when it's confirmed unreachable.
      setIsOffline(state.isConnected === false || state.isInternetReachable === false);
    });
  }, []);

  return { isOffline };
}
