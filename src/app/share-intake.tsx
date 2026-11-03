import { Redirect } from 'expo-router';

// philoi://share-intake — where the iOS Share Extension (targets/share-intake) opens the app. It
// carries nothing: the shared file waits in the App Group, and the import composer reads it.
// Replaced, not pushed, so Back from the composer doesn't land on an empty screen.
export default function ShareIntakeRoute() {
  return <Redirect href="/agora/import" />;
}
