#!/usr/bin/env python3
"""Synthetic archives + an isolated fake publisher. No GitHub writes/network.
These fixtures are not installable apps and are removed at the end of each test.
"""
from __future__ import annotations
import copy
import importlib.util
import json
import os
from pathlib import Path
import plistlib
import struct
import tempfile
import unittest
from unittest import mock
import zipfile

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('policy', ROOT / 'scripts/ios_release_policy.py')
p = importlib.util.module_from_spec(spec); spec.loader.exec_module(p)
META = p.expected_metadata({'version':'1.9.0', 'versionCode':88}, 'a'*40, '123456')
NOTES = '## 更新日志\n\n- 修正深色底栏与列表定位。\n\n## 系统要求\n\n- iOS 15.0 / iPadOS 15.0 或更高版本。\n- IPA 未签名，需要自行签名后安装。\n'


def synthetic_macho(*, platform=2, minimum=(15 << 16), signature=False):
    # Minimal command-table fixture, explicitly not executable/installable.
    commands = struct.pack('<IIIIII', 0x32, 24, platform, minimum, 0, 0)
    if signature: commands += struct.pack('<IIII', 0x1D, 16, 0, 0)
    return struct.pack('<IiiIIIII', 0xFEEDFACF, 0x100000C, 0, 2, 2 if signature else 1, len(commands), 0, 0) + commands + b'not-a-MachO-test-only'


def fixture(directory: Path):
    build = directory / 'build'; build.mkdir()
    info = {'CFBundleIdentifier':p.BUNDLE,'CFBundleShortVersionString':'1.9.0','CFBundleVersion':'88',
            'MinimumOSVersion':'15.0','UIDeviceFamily':[1,2]}
    files = {'Info.plist':plistlib.dumps(info), 'main.jsbundle':b'synthetic-test-data\n'*130,
             'LxMusicMobile':synthetic_macho(), p.PROVENANCE:json.dumps(META).encode()}
    props = {'CFBundleIdentifier':p.BUNDLE,'CFBundleVersion':'88','CFBundleShortVersionString':'1.9.0',
             'Architectures':['arm64'],'Team':p.TEAM}
    ipa_name, archive_name = p.binary_names(META)
    with zipfile.ZipFile(build/ipa_name,'w',zipfile.ZIP_STORED) as z:
        for name, data in files.items(): z.writestr(p.APP_ROOT+name,data)
    with zipfile.ZipFile(build/archive_name,'w',zipfile.ZIP_STORED) as z:
        z.writestr(p.ARCHIVE_ROOT+'Info.plist',plistlib.dumps({'ApplicationProperties':props}))
        for name, data in files.items(): z.writestr(p.ARCHIVE_ROOT+'Products/Applications/LxMusicMobile.app/'+name,data)
    (build/'BUILD-METADATA.txt').write_text(''.join(f'{k}={v}\n' for k,v in META.items()))
    rehash(build)
    notes = directory/'docs/releases/BUILD88.md'; notes.parent.mkdir(parents=True);notes.write_text(NOTES)
    return build


def rehash(build):
    (build/'SHA256SUMS.txt').write_text(''.join(p.sha256(build/name)+'  '+name+'\n' for name in p.binary_names(META)))


def rewrite(build, which, change):
    file = build/p.binary_names(META)[which]
    with zipfile.ZipFile(file) as z: members={n:z.read(n) for n in z.namelist()}
    change(members)
    with zipfile.ZipFile(file,'w',zipfile.ZIP_STORED) as z:
        for n,b in members.items(): z.writestr(n,b)
    rehash(build)


class PolicyTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='lx-policy-test-')
        self.root=Path(self.tmp.name);self.build=fixture(self.root)
    def tearDown(self): self.tmp.cleanup()
    def test_valid_pair_has_exactly_three_public_assets(self):
        (self.build/'build87-ui-evidence.zip').write_bytes(b'should not be selected')
        (self.build/'secret-log.txt').write_text('test only')
        report=p.verify_binaries(self.build,META)
        self.assertEqual(report['release_assets'],[*p.binary_names(META),'SHA256SUMS.txt'])
        self.assertTrue((self.build/'checks/release-validation.json').exists())
    def test_bad_source_run_package_metadata_rejected(self):
        for key,val in [('commit','b'*40),('run','987'),('version','2.0.0'),('build','89'),('signing','signed')]:
            with self.subTest(key=key):
                (self.build/'BUILD-METADATA.txt').write_text(''.join(f'{k}={val if k==key else v}\n' for k,v in META.items()))
                with self.assertRaises(RuntimeError): p.verify_binaries(self.build,META)
    def test_hash_mismatch_rejected(self):
        with (self.build/p.binary_names(META)[0]).open('ab') as f:f.write(b'corrupt')
        with self.assertRaises(RuntimeError):p.verify_binaries(self.build,META)
    def test_extra_or_duplicate_checksum_rejected(self):
        original=(self.build/'SHA256SUMS.txt').read_text()
        for extra in ['0'*64+'  BUILD-METADATA.txt\n',original.splitlines()[0]+'\n','bad line\n']:
            with self.subTest(extra=extra):
                (self.build/'SHA256SUMS.txt').write_text(original+extra)
                with self.assertRaises(RuntimeError):p.verify_binaries(self.build,META)
    def test_crc_tampering_rejected_even_with_new_outer_hash(self):
        file=self.build/p.binary_names(META)[0];raw=file.read_bytes()
        needle=b'not-a-MachO-test-only';self.assertEqual(raw.count(needle),1)
        file.write_bytes(raw.replace(needle,b'bad-a-MachO-test-only'))
        rehash(self.build)
        with self.assertRaises((RuntimeError,zipfile.BadZipFile)):p.verify_binaries(self.build,META)
    def test_application_bytes_must_match(self):
        rewrite(self.build,0,lambda files:files.__setitem__(p.APP_ROOT+'main.jsbundle',b'different-bundle-data'*130))
        with self.assertRaisesRegex(RuntimeError,'bytes differ'):p.verify_binaries(self.build,META)
    def test_application_file_sets_must_match(self):
        rewrite(self.build,0,lambda files:files.__setitem__(p.APP_ROOT+'extra',b'x'))
        with self.assertRaisesRegex(RuntimeError,'file sets'):p.verify_binaries(self.build,META)
    def test_internal_source_marker_required(self):
        rewrite(self.build,0,lambda files:files.__setitem__(p.APP_ROOT+p.PROVENANCE,json.dumps({**META,'commit':'b'*40}).encode()))
        with self.assertRaisesRegex(RuntimeError,'source/run marker'):p.verify_binaries(self.build,META)
    def test_info_platform_identity_checked(self):
        path=p.APP_ROOT+'Info.plist'
        for key,val in [('CFBundleIdentifier','evil.bundle'),('MinimumOSVersion','16.0'),('UIDeviceFamily',[1]),('CFBundleVersion','87')]:
            with self.subTest(key=key):
                def change(files):
                    value=plistlib.loads(files[path]);value[key]=val;files[path]=plistlib.dumps(value)
                rewrite(self.build,0,change)
                with self.assertRaisesRegex(RuntimeError,'platform/version'):p.verify_binaries(self.build,META)
    def test_archive_team_checked(self):
        def change(files):
            key=p.ARCHIVE_ROOT+'Info.plist';value=plistlib.loads(files[key]);value['ApplicationProperties']['Team']='OTHER';files[key]=plistlib.dumps(value)
        rewrite(self.build,1,change)
        with self.assertRaisesRegex(RuntimeError,'Archive identity'):p.verify_binaries(self.build,META)
    def test_unsafe_zip_names_rejected(self):
        for bad in ['/outside','../outside','a/../b','a\\b','a//b','./a']:
            with self.subTest(name=bad):
                rewrite(self.build,0,lambda files:files.__setitem__(bad,b'x'))
                with self.assertRaisesRegex(RuntimeError,'Unsafe ZIP'):p.verify_binaries(self.build,META)
    def test_signing_prohibited(self):
        for which,prefix in [(0,p.APP_ROOT),(1,p.ARCHIVE_ROOT+'Products/Applications/LxMusicMobile.app/')]:
            rewrite(self.build,which,lambda files,prefix=prefix:files.__setitem__(prefix+'_CodeSignature/CodeResources',b'x'))
        with self.assertRaisesRegex(RuntimeError,'signing files'):p.verify_binaries(self.build,META)
    def test_stamp_only_unsigned_matching_archive(self):
        app=self.build/p.ARCHIVE_ROOT/'Products/Applications/LxMusicMobile.app';app.mkdir(parents=True)
        with zipfile.ZipFile(self.build/p.binary_names(META)[0]) as z:(app/'Info.plist').write_bytes(z.read(p.APP_ROOT+'Info.plist'))
        p.stamp_archive(self.build,META);self.assertEqual(json.loads((app/p.PROVENANCE).read_text()),META)
        (app/'embedded.mobileprovision').write_bytes(b'signed')
        with self.assertRaisesRegex(RuntimeError,'signed app'):p.stamp_archive(self.build,META)
    def test_notes_have_only_two_sections_and_actual_requirements(self):
        self.assertEqual(p.notes_for_release(NOTES,META),NOTES)
        for text in [NOTES+'\n## 验证报告\nlogs\n','preface\n'+NOTES,NOTES.replace('15.0','16.0'),NOTES.replace('未签名','可直接安装'),NOTES.replace('iPadOS','Android'),NOTES+'<script>alert(1)</script>']:
            with self.subTest(text=text):
                with self.assertRaises(RuntimeError):p.notes_for_release(text,META)
    def test_build87_cannot_be_republished_by_new_policy(self):
        with self.assertRaisesRegex(RuntimeError,'new build number'):p.notes_for_release(NOTES,{**META,'build':'87'})
    def test_input_commit_and_version_validated(self):
        for commit,run in [('short','1'),('g'*40,'1'),('a'*40,'not-number')]:
            with self.assertRaises(RuntimeError):p.expected_metadata({'version':'1.9.0','versionCode':88},commit,run)
    def test_existing_asset_differences_and_extras_fail_closed(self):
        local={name:self.build/name for name in [*p.binary_names(META),'SHA256SUMS.txt']}
        for assets in [[{'name':'extra.log'}],[{'name':next(iter(local)),'state':'uploaded','size':0,'digest':'sha256:'+'0'*64}]]:
            with self.assertRaises(RuntimeError):p.release_inventory({'assets':assets},local)
    def test_simulated_publisher_uploads_only_allowlist_and_is_idempotent(self):
        verified=p.verify_binaries(self.build,META);remote={'release':None};uploads=[];writes=[]
        def api(endpoint,method='GET',payload=None,allow_missing=False):
            if '/git/ref/heads/master' in endpoint:return {'object':{'type':'commit','sha':META['commit']}}
            if '/actions/runs/' in endpoint:return {'head_sha':META['commit'],'path':'.github/workflows/ios-ipa.yml','event':'push'}
            if '/git/ref/tags/' in endpoint:return {'object':{'type':'commit','sha':META['commit']}}
            if method=='POST':
                writes.append(method);remote['release']={'id':1,'assets':[],'html_url':'https://github.com/example/synthetic',**payload};return copy.deepcopy(remote['release'])
            if method=='PATCH':
                writes.append(method);remote['release'].update(payload)
            return copy.deepcopy(remote['release'])
        def upload(args,**kwargs):
            self.assertEqual(args[:3],['gh','release','upload']);self.assertNotIn('--clobber',args)
            file=Path(args[4]);uploads.append(file.name)
            remote['release']['assets'].append({'name':file.name,'state':'uploaded','size':file.stat().st_size,'digest':'sha256:'+p.sha256(file)})
            return subprocess_result()
        with mock.patch.dict(os.environ,{'GITHUB_REPOSITORY':p.REPOSITORY,'GITHUB_REF':'refs/tags/v1.9.0-ios-build88'}),mock.patch.object(p,'verify_acceptance',return_value={'success':True}),mock.patch.object(p,'gh_api',side_effect=api),mock.patch.object(p.subprocess,'run',side_effect=upload):
            p.publish(self.root,self.build,META,verified)
            self.assertEqual(uploads,verified['release_assets']);self.assertEqual(writes,['POST','PATCH'])
            p.publish(self.root,self.build,META,verified)
            self.assertEqual(len(uploads),3);self.assertEqual(writes,['POST','PATCH'])
    def test_moved_tag_stops_before_creating_release(self):
        verified=p.verify_binaries(self.build,META)
        def api(endpoint,**kwargs):
            if '/heads/master' in endpoint:return {'object':{'type':'commit','sha':META['commit']}}
            if '/actions/runs/' in endpoint:return {'head_sha':META['commit'],'path':'.github/workflows/ios-ipa.yml','event':'push'}
            return {'object':{'type':'commit','sha':'b'*40}}
        with mock.patch.dict(os.environ,{'GITHUB_REPOSITORY':p.REPOSITORY,'GITHUB_REF':'refs/heads/master'}),mock.patch.object(p,'verify_acceptance'),mock.patch.object(p,'gh_api',side_effect=api) as network:
            with self.assertRaisesRegex(RuntimeError,'tag moved'):p.publish(self.root,self.build,META,verified)
            self.assertEqual(network.call_count,3)

    def test_wrong_repository_or_tag_stops_before_network(self):
        verified=p.verify_binaries(self.build,META)
        with mock.patch.dict(os.environ,{'GITHUB_REPOSITORY':'other/repo','GITHUB_REF':'refs/tags/wrong'}),mock.patch.object(p,'gh_api') as api:
            with self.assertRaises(RuntimeError):p.publish(self.root,self.build,META,verified)
            api.assert_not_called()
    def test_executable_rejects_simulator_signature_truncation_and_command_overflow(self):
        for raw in [synthetic_macho(platform=7), synthetic_macho(minimum=16<<16), synthetic_macho(signature=True), b'garbage', synthetic_macho()[:40]]:
            with self.subTest(raw=raw[:32]):
                with self.assertRaises(RuntimeError):p.verify_executable(raw)
        p.verify_executable(synthetic_macho())

    def test_missing_real_acceptance_prevents_all_publication_network(self):
        verified=p.verify_binaries(self.build,META)
        with mock.patch.dict(os.environ,{'GITHUB_REPOSITORY':p.REPOSITORY,'GITHUB_REF':'refs/heads/master'}),mock.patch.object(p,'gh_api') as network:
            with self.assertRaises((RuntimeError,FileNotFoundError)):p.publish(self.root,self.build,META,verified)
            network.assert_not_called()

    def test_changed_master_prevents_tag_release_writes(self):
        verified=p.verify_binaries(self.build,META)
        with mock.patch.dict(os.environ,{'GITHUB_REPOSITORY':p.REPOSITORY,'GITHUB_REF':'refs/heads/master'}),mock.patch.object(p,'verify_acceptance'),mock.patch.object(p,'gh_api',return_value={'object':{'type':'commit','sha':'b'*40}}) as network:
            with self.assertRaisesRegex(RuntimeError,'Master changed'):p.publish(self.root,self.build,META,verified)
            self.assertEqual(network.call_count,1)

    def test_new_tag_created_on_same_source_once_before_draft(self):
        verified=p.verify_binaries(self.build,META); calls=[]; remote={'tag':None,'release':None}
        def api(endpoint,method='GET',payload=None,allow_missing=False):
            calls.append((method,endpoint,payload))
            if '/heads/master' in endpoint:return {'object':{'type':'commit','sha':META['commit']}}
            if '/actions/runs/' in endpoint:return {'head_sha':META['commit'],'path':'.github/workflows/ios-ipa.yml','event':'push'}
            if endpoint.endswith('/git/refs'):
                self.assertEqual(payload,{'ref':'refs/tags/v1.9.0-ios-build88','sha':META['commit']});remote['tag']={'object':{'type':'commit','sha':META['commit']}};return remote['tag']
            if '/git/ref/tags/' in endpoint:return remote['tag']
            if method=='POST':remote['release']={'id':1,'assets':[],'html_url':'https://github.com/example/synthetic',**payload}
            if method=='PATCH':remote['release'].update(payload)
            return copy.deepcopy(remote['release'])
        def upload(args,**kwargs):
            file=Path(args[4]);remote['release']['assets'].append({'name':file.name,'state':'uploaded','size':file.stat().st_size,'digest':'sha256:'+p.sha256(file)})
            return subprocess_result()
        with mock.patch.dict(os.environ,{'GITHUB_REPOSITORY':p.REPOSITORY,'GITHUB_REF':'refs/heads/master'}),mock.patch.object(p,'verify_acceptance'),mock.patch.object(p,'gh_api',side_effect=api),mock.patch.object(p.subprocess,'run',side_effect=upload):
            p.publish(self.root,self.build,META,verified);p.publish(self.root,self.build,META,verified)
        tag_writes=[call for call in calls if call[0]=='POST' and call[1].endswith('/git/refs')]
        self.assertEqual(len(tag_writes),1)
        self.assertEqual(remote['release']['draft'],False)
        self.assertEqual(len(remote['release']['assets']),3)

    def test_acceptance_checks_validate_each_native_source_and_production_artifact(self):
        # These synthetic reports exercise the fail-closed validator only;
        # no native runtime success is claimed by this unit fixture.
        checks=self.build/'checks';checks.mkdir(exist_ok=True)
        def put(name, value): (checks/name).write_text(json.dumps(value))
        success={'done':True,'success':True}
        identity={**success,'commit':META['commit'],'run':META['run']}
        for name in ['playback-online.json','playback-offline.json','system-theme.json','system-theme-restart.json']:put(name,success)
        png=b'\x89PNG\r\n\x1a\n'+b'synthetic-not-a-rendered-image'*80
        images=[]
        for i in range(54):
            name=f'ui-test-{i}.png';(checks/name).write_bytes(png);put(name.replace('.png','.json'),success)
            images.append({'image':name,'bytes':len(png),'sha256':p.sha256(checks/name),'report':name.replace('.png','.json')})
        put('UI-MANIFEST.json',{'commit':META['commit'],'run':META['run'],'count':54,'screenshots':images})
        executed=[]
        for name,count in [('webdav-core',50),('resumable-transfer',19),('portable-backup',35)]:
            log=name+'.log';(checks/log).write_text('synthetic unit validator fixture, not native acceptance')
            executed.append({'name':name,'assertions':count,'log':log,'sha256':p.sha256(checks/log)})
        put('library-native.json',{**identity,'host':'Darwin','executed':executed})
        phases={'online':12,'full-restored':2,'playlists-restored':1,'ui-webdav':1,'ui-downloads':1,'ui-backup':1,'cover-cd':1,'cover-square':1,'offline':2}
        for phase,count in phases.items():put('library-'+phase+'.json',{**success,'phase':'library-'+phase,'checks':[{'ok':True}]*count})
        features=[]
        for i in range(5):
            name=f'feature-library-{i}.png';(checks/name).write_bytes(png);features.append({'name':name,'bytes':len(png),'sha256':p.sha256(checks/name)})
        put('library-acceptance.json',{**identity,'phases':list(phases),'checks':sum(phases.values()),'screenshots':features,
              'network':{'verifiedResume':True,'offlineServiceStopped':True,'publishedMoves':2}})
        (self.root/'src').mkdir()
        with zipfile.ZipFile(self.root/'lx-build-source.zip','w') as z:
            z.comment=META['commit'].encode()
            for i in range(501):
                name=f'src/synthetic-{i}.ts';data=b'// unit source fixture\n';(self.root/name).write_bytes(data);z.writestr(name,data)
        self.assertTrue(p.verify_acceptance(self.root,self.build,META)['success'])
        original={name:(checks/name).read_bytes() for name in ['library-native.json','library-acceptance.json','UI-MANIFEST.json','library-online.json','playback-offline.json']}
        mutations=[('library-native.json',lambda v:v.update(host='Linux')),
            ('library-native.json',lambda v:v['executed'][2].update(assertions=0)),
            ('library-acceptance.json',lambda v:v.update(commit='b'*40)),
            ('library-acceptance.json',lambda v:v['network'].update(offlineServiceStopped=False)),
            ('library-acceptance.json',lambda v:v.update(checks=1)),
            ('UI-MANIFEST.json',lambda v:v.update(count=53)),
            ('library-online.json',lambda v:v['checks'][0].update(ok=False)),
            ('playback-offline.json',lambda v:v.update(success=False))]
        for name,mutate in mutations:
            with self.subTest(report=name,mutation=repr(mutate)):
                value=json.loads(original[name]);mutate(value);put(name,value)
                with self.assertRaises(RuntimeError):p.verify_acceptance(self.root,self.build,META)
                (checks/name).write_bytes(original[name])
        (self.root/'src/synthetic-0.ts').write_text('// changed after build')
        with self.assertRaisesRegex(RuntimeError,'source changed'):p.verify_acceptance(self.root,self.build,META)


class subprocess_result:
    returncode=0
    stdout=''
    stderr=''

if __name__=='__main__':
    unittest.main(verbosity=2)
