require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', '..', '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'PhiloiLiveActivity'
  s.version        = package['version']
  s.summary        = 'Starts/updates/ends the lock-in Live Activity (#87).'
  s.license        = package['license']
  s.author         = package['author']
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
