import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'Philoi',
  slug: 'philoi-app',
  owner: 'philoi',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: 'philoi',
  userInterfaceStyle: 'automatic',
  backgroundColor: '#3A2E5C',
  ios: {
    bundleIdentifier: 'com.philoi.app',
    icon: './assets/images/icon.png',
    associatedDomains: ['applinks:getphiloi.com'],
  },
  android: {
    package: 'com.philoi.app',
    adaptiveIcon: {
      backgroundColor: '#3A2E5C',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    intentFilters: [
      {
        action: 'VIEW',
        autoVerify: true,
        data: [
          {
            scheme: 'https',
            host: 'getphiloi.com',
            pathPrefix: '/join',
          },
        ],
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ],
  },
  web: {
    output: 'static',
    favicon: './assets/images/favicon.png',
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-image',
    'expo-status-bar',
    'expo-web-browser',
    'expo-audio',
    [
      'expo-font',
      {
        fonts: [
          'node_modules/@expo-google-fonts/fredoka/500Medium/Fredoka_500Medium.ttf',
          'node_modules/@expo-google-fonts/fredoka/600SemiBold/Fredoka_600SemiBold.ttf',
          'node_modules/@expo-google-fonts/nunito/400Regular/Nunito_400Regular.ttf',
          'node_modules/@expo-google-fonts/nunito/600SemiBold/Nunito_600SemiBold.ttf',
          'node_modules/@expo-google-fonts/nunito/700Bold/Nunito_700Bold.ttf',
          'node_modules/@expo-google-fonts/nunito/800ExtraBold/Nunito_800ExtraBold.ttf',
        ],
      },
    ],
    [
      'expo-splash-screen',
      {
        backgroundColor: '#3A2E5C',
        image: './assets/images/splash-icon.png',
        imageWidth: 180,
      },
    ],
    [
      'expo-image-picker',
      {
        photosPermission: 'Philoi needs photo access to post a check-in.',
        cameraPermission: 'Philoi uses your camera so your circle can see you show up.',
      },
    ],
    [
      'expo-notifications',
      {
        icon: './assets/images/icon.png',
        color: '#E0612C',
      },
    ],
  ],
  runtimeVersion: {
    policy: 'sdkVersion',
  },
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
    // TODO: RevenueCat — public SDK keys go here once billing is wired up.
    revenueCatIosKey: process.env.REVENUECAT_IOS_KEY ?? null,
    revenueCatAndroidKey: process.env.REVENUECAT_ANDROID_KEY ?? null,
    posthogApiKey: process.env.POSTHOG_API_KEY ?? null,
    posthogHost: process.env.POSTHOG_HOST ?? 'https://us.i.posthog.com',
    eas: {
      projectId: 'f1031c6d-fd56-4d27-880a-0e87a7953f05',
    },
  },
};

export default config;
