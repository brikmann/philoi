require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', '..', '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'PhiloiFocusNudge'
  s.version        = package['version']
  s.summary        = 'Screen Time authorization, app picker and shield arming for Focus Nudge.'
  # Literals, NOT package['license'] / package['author'] — same reason as PhiloiLiveActivity's
  # podspec: this package.json is `private: true` and declares neither, so those lookups return
  # nil and CocoaPods rejects the spec during pod install. Only `version` is safe to read.
  s.license        = { type: 'MIT' }
  s.author         = 'Philoi'
  s.homepage       = 'https://philoi.app'
  # FamilyControls needs 15+, requestAuthorization(for:) and ManagedSettingsStore(named:) need
  # 16.0 — but this is pinned to the app's own floor, matching every other target in the project,
  # so none of the code below needs @available annotations.
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: 'https://github.com/philoi/philoi-app' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Swift/Objective-C compatibility, per the create-expo-module template.
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
