#!/usr/bin/env ruby
# Resolve source files using the same project parser used by CocoaPods.
require 'xcodeproj'
require 'pathname'

root = Pathname.new(__dir__).parent.expand_path
project = Xcodeproj::Project.open(root.join('ios/LxMusicMobile.xcodeproj'))
target = project.targets.find { |candidate| candidate.name == 'LxMusicMobile' }
raise 'LxMusicMobile application target missing' unless target

resolved = target.source_build_phase.files.map do |entry|
  reference = entry.file_ref
  raise "Source build entry has no file reference: #{entry.uuid}" unless reference
  file = reference.real_path.expand_path.cleanpath
  raise "Missing application source: #{file}" unless file.file?
  file.to_s
end
raise 'Duplicate resolved application source files' unless resolved.uniq.length == resolved.length

expected = %w[
  LXLibrarySupport.swift LXWebDAVCore.swift LXResumableTransfer.swift
  LXPortableBackup.swift LXStorageSnapshot.swift LXRestoreCoordinator.swift
  LXLibraryWorker.swift LXLibraryServices.swift LXLibraryServicesBridge.m
]
expected.each do |name|
  file = root.join('ios/LxMusicMobile', name).cleanpath.to_s
  raise "Library source not registered at its actual path: #{name}" unless resolved.count(file) == 1
end
puts "PASS #{resolved.length} actual application source paths resolve; all #{expected.length} library bridge/service files occur exactly once"
