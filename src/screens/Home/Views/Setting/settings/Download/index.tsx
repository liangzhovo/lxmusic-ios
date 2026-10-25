import { useEffect, useState } from 'react'
import { Platform, Switch, TextInput, View } from 'react-native'
import Text from '@/components/common/Text'
import { useTheme } from '@/store/theme/hook'
import { downloadQueue, useDownloadQueue, useLibrary } from '@/core/library'
import { openLibraryPage } from '@/core/library/page'
import Section from '../../components/Section'
import SubTitle from '../../components/SubTitle'
import CheckBoxItem from '../../components/CheckBoxItem'
import Button from '@/components/common/Button'

export default function DownloadSettings() {
  const theme = useTheme(), queue = useDownloadQueue(), library = useLibrary()
  const [folder, setFolder] = useState('LX Music'), [account, setAccount] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  useEffect(() => { if (queue.destination.kind === 'webdav') { setAccount(queue.destination.accountId); setFolder(queue.destination.path) } else setAccount(library.configuration.accounts[0]?.id ?? '') }, [queue.destination.kind, queue.destination.kind === 'webdav' ? queue.destination.accountId : '', queue.destination.kind === 'webdav' ? queue.destination.path : '', library.configuration.accounts])
  const run = (task: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true); setError('')
    void task().catch(e => { setError(String(e?.message ?? '保存失败')) }).finally(() => { setBusy(false) })
  }
  if (Platform.OS !== 'ios') return null
  return <Section title="下载设置">
    <View testID="download-settings" style={{ marginBottom: 24 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 25, minHeight: 48 }}>
        <Text>启用下载功能（默认关闭）</Text><Switch testID="library-download-enabled" value={queue.enabled} disabled={busy || !queue.initialized} onValueChange={enabled => { run(() => downloadQueue.setEnabled(enabled)) }} />
      </View>
      <SubTitle title="下载音质"><View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{(['128k', '320k', 'flac', 'flac24bit'] as LX.Quality[]).map(q => <CheckBoxItem key={q} label={q} check={queue.quality === q} need onChange={() => { run(() => downloadQueue.configure({ quality: q })) }} />)}</View></SubTitle>
      <SubTitle title="保存位置">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}><CheckBoxItem label="本机 / LX Downloads" check={queue.destination.kind === 'local'} need onChange={() => { run(() => downloadQueue.configure({ destination: { kind: 'local' } })) }} />
          <CheckBoxItem label="WebDAV" check={queue.destination.kind === 'webdav'} need onChange={() => { if (!account) { setError('请先添加WebDAV账户'); return }; run(() => downloadQueue.configure({ destination: { kind: 'webdav', accountId: account, path: folder } })) }} /></View>
        {library.configuration.accounts.length ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 10 }}>{library.configuration.accounts.map(a => <CheckBoxItem key={a.id} label={a.name} check={account === a.id} need onChange={() => { setAccount(a.id) }} />)}</View> : <Text size={13}>尚未配置WebDAV账户。</Text>}
        <Text size={13} style={{ marginTop: 8 }}>WebDAV目录（相对账户根目录）</Text>
        <TextInput testID="download-settings-folder" accessibilityLabel="WebDAV下载目录" value={folder} onChangeText={setFolder} autoCapitalize="none" autoCorrect={false} editable={!busy}
          style={{ minHeight: 44, marginVertical: 8, padding: 10, borderRadius: 4, borderWidth: 0.5, borderColor: theme['c-border-background'], color: theme['c-font'], backgroundColor: theme['c-primary-input-background'] }} />
        <Button testID="download-settings-save-dav" onPress={() => { if (!account) { setError('请先添加WebDAV账户'); return }; run(() => downloadQueue.configure({ destination: { kind: 'webdav', accountId: account, path: folder } })) }}><Text>保存WebDAV位置</Text></Button>
        <Button onPress={() => { openLibraryPage('webdav') }}><Text>管理WebDAV账户</Text></Button>
      </SubTitle>
      {error || queue.error ? <Text testID="download-settings-error" style={{ paddingLeft: 25 }}>{error || queue.error}</Text> : null}
      <Text size={13} style={{ paddingLeft: 25 }}>从歌曲菜单加入下载；任务进度与记录在“下载”页查看。进入后台或重启后任务暂停，返回后继续。修改保存位置只影响新任务。</Text>
    </View>
  </Section>
}
