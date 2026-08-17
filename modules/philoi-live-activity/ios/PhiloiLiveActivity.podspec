require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', '..', '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'PhiloiLiveActivity'
  s.version        = package['version']
  s.summary        = 'Starts/updates/ends the lock-in Live Activity (#87).'
  # Literals, NOT package['license'] / package['author'] as the create-expo-module template does:
  # this package.json declares neither (it's `private: true`), so those lookups return nil and
  # CocoaPods rejects the spec during pod install. Only `version` is safe to read from it.
  # Type only, no `file:` — the LICENSE lives three directories up and a podspec path that escapes
  # the pod's own root is exactly the kind of thing that resolves differently under EAS.
  s.license        = { type: 'MIT' }
  s.author         = 'Philoi'
  s.homepage       = 'https://getphiloi.com'
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
