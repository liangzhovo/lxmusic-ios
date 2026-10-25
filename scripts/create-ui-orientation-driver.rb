#!/usr/bin/env ruby
# A standalone UI-test runner, never included in the release app/archive.
require 'xcodeproj'
root = File.expand_path('..', __dir__)
path = File.join(root, 'build', 'LXUIDriver.xcodeproj')
project = Xcodeproj::Project.new(path)
target = project.new_target(:ui_test_bundle, 'LXUIDriver', :ios, '15.0')
file = project.main_group.new_file(File.join(root, 'tests', 'ios-ui-driver', 'OrientationTests.swift'))
target.source_build_phase.add_file_reference(file)
target.build_configurations.each do |config|
  config.build_settings.merge!({
    'PRODUCT_BUNDLE_IDENTIFIER' => 'com.skyhc.lxmusic.ui-driver',
    'SWIFT_VERSION' => '5.0', 'GENERATE_INFOPLIST_FILE' => 'YES',
    'TARGETED_DEVICE_FAMILY' => '1,2', 'CODE_SIGNING_ALLOWED' => 'NO',
    'CODE_SIGNING_REQUIRED' => 'NO', 'ENABLE_TESTING_SEARCH_PATHS' => 'YES',
    'SUPPORTED_PLATFORMS' => 'iphonesimulator', 'SDKROOT' => 'iphonesimulator',
    'IPHONEOS_DEPLOYMENT_TARGET' => '15.0', 'SWIFT_OPTIMIZATION_LEVEL' => '-O',
    'CLANG_ENABLE_MODULES' => 'YES', 'SKIP_INSTALL' => 'YES'
  })
end
project.save
scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(target)
scheme.add_test_target(target)
scheme.test_action.build_configuration = 'Release'
scheme.save_as(path, 'LXUIDriver', true)
puts path
