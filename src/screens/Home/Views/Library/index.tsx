import { useEffect, useRef, useState } from 'react'
import { Alert, Platform, ScrollView, Switch, TextInput, TouchableOpacity, View } from 'react-native'
import Text from '@/components/common/Text'
import { useTheme } from '@/store/theme/hook'
import { useMyList } from '@/store/list/hook'
import { setActiveList } from '@/core/list'
import { setNavActiveId } from '@/core/common'
import { useLibraryPage } from '@/core/library/page'
import Downloads from './Downloads'
import { selectFile } from '@/utils/fs'
import { shareFile } from '@/utils/nativeModules/utils'
import {
  addPublished, armRestore, browseDirectory, cancelRestore, clearCache, createEncryptedBackup, downloadQueue,
  fetchBackup, importEntries, initializeLibrary, localDownloadPath, removeAccount, restoreStatus, saveAccount,
  setCacheLimit, stageEncryptedRestore, uploadBackup, useDownloadQueue, useLibrary,
} from '@/core/library'
import type { BackupFile, DirectoryEntry, LibraryAccount, RestoreStatus, TransferProgress } from '@/core/library/types'
import { supportedAudio } from '@/core/library/reference'

const formatBytes = (n: number) => n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`
const statusName: Record<string, string> = { queued: '等待', resolving: '获取音源', downloading: '下载', uploading: '上传', verifying: '校验', paused: '已暂停', failed: '失败', completed: '完成', encrypting: '加密', decrypting: '解密', preparing: '准备播放' }
const confirm = (title: string, message: string) => new Promise<boolean>(resolve => Alert.alert(title, message, [{ text: '取消', style: 'cancel', onPress: () => { resolve(false) } }, { text: '确认', onPress: () => { resolve(true) } }], { cancelable: true, onDismiss: () => { resolve(false) } }))
function Button({ title, onPress, disabled, id }: { title: string, onPress: () => void, disabled?: boolean, id?: string }) {
  const theme = useTheme()
  return <TouchableOpacity testID={id} accessibilityRole="button" accessibilityLabel={title} disabled={disabled} onPress={onPress}
    style={{ minHeight: 42, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderRadius: 6, borderColor: theme['c-border-background'], marginRight: 8, marginBottom: 8, opacity: disabled ? 0.45 : 1 }}>
    <Text color={theme['c-button-font']} size={15}>{title}</Text>
  </TouchableOpacity>
}
function Field({ label, value, onChange, secure, disabled, id, numeric }: { label: string, value: string, onChange: (text: string) => void, secure?: boolean, disabled?: boolean, id?: string, numeric?: boolean }) {
  const theme = useTheme()
  return <View style={{ marginBottom: 12 }}><Text size={14}>{label}</Text><TextInput testID={id} accessibilityLabel={label} value={value} onChangeText={onChange}
    editable={!disabled} secureTextEntry={secure} autoCapitalize="none" autoCorrect={false} keyboardType={numeric ? 'number-pad' : 'default'}
    style={{ minHeight: 44, paddingHorizontal: 10, paddingVertical: 8, fontSize: 16, borderWidth: 1, borderRadius: 5, color: theme['c-font'], borderColor: theme['c-border-background'], marginTop: 5 }} /></View>
}
function Toggle({ title, value, onChange, disabled, id }: { title: string, value: boolean, onChange: (value: boolean) => void, disabled?: boolean, id?: string }) {
  return <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 46, marginBottom: 6 }}>
    <Text style={{ flex: 1, marginRight: 12 }} size={15}>{title}</Text><Switch testID={id} accessibilityLabel={title} value={value} disabled={disabled} onValueChange={onChange} />
  </View>
}
const row = { flexDirection: 'row' as const, flexWrap: 'wrap' as const, marginVertical: 6 }
const emptyAccount = { name: 'WebDAV', endpoint: 'https://', username: '', allowHTTP: false, directoryCache: true, audioCache: true }

export default function Library({ initialTab }: { initialTab?: 'webdav' | 'downloads' | 'backup' } = {}) {
  const theme = useTheme(), library = useLibrary(), queue = useDownloadQueue(), lists = useMyList()
  const requested = useLibraryPage()
  const [tab, setTab] = useState<'webdav' | 'downloads' | 'backup'>(initialTab ?? requested.tab)
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [progress, setProgress] = useState<TransferProgress>()
  const [editing, setEditing] = useState<Partial<LibraryAccount> | null>(null), [accountPassword, setAccountPassword] = useState(''), [passwordEdited, setPasswordEdited] = useState(false)
  const [accountId, setAccountId] = useState(''), [path, setPath] = useState(''), [entries, setEntries] = useState<DirectoryEntry[]>([]), [selected, setSelected] = useState<string[]>([])
  const [visibleCount, setVisibleCount] = useState(100), [directoryLoading, setDirectoryLoading] = useState(false)
  const [listId, setListId] = useState(requested.listId), [limit, setLimit] = useState(String(library.configuration.audioLimitMB))
  const [backupFolder, setBackupFolder] = useState('LX Backups')
  const [backupKind, setBackupKind] = useState<'full' | 'playlists'>('full'), [includeCaches, setIncludeCaches] = useState(true)
  const [password, setPassword] = useState(''), [passwordAgain, setPasswordAgain] = useState(''), [backup, setBackup] = useState<BackupFile>(), [restore, setRestore] = useState<RestoreStatus>()
  const [restorePath, setRestorePath] = useState(''), [backupEntries, setBackupEntries] = useState<DirectoryEntry[]>([])
  const pendingDirectory = useRef<ReturnType<typeof browseDirectory>>(), directoryGeneration = useRef(0), mounted = useRef(true)
  const locked = busy || library.busy
  useEffect(() => { if (!initialTab) { setTab(requested.tab); setListId(requested.listId) } }, [requested.revision, initialTab])
  useEffect(() => { mounted.current = true; void initializeLibrary().then(() => restoreStatus()).then(setRestore).catch(error => { setMessage(String(error.message)) })
    return () => { mounted.current = false; pendingDirectory.current?.cancel() }
  }, [])
  useEffect(() => { setLimit(String(library.configuration.audioLimitMB)); if (!accountId || !library.configuration.accounts.some(a => a.id === accountId)) { setAccountId(library.configuration.accounts[0]?.id ?? ''); setPath('') } }, [library.configuration])
  const run = (task: () => Promise<void>) => {
    if (locked) return
    setBusy(true); setMessage(''); setProgress(undefined)
    void (async() => {
      // Let an obsolete directory request settle before changing credentials,
      // clearing its cache or taking an exclusive backup snapshot.
      const pending = pendingDirectory.current; pendingDirectory.current = undefined
      directoryGeneration.current++; pending?.cancel()
      if (pending) await pending.promise.catch(() => {})
      if (mounted.current) setDirectoryLoading(false)
      await task()
    })().catch(error => { if (mounted.current) setMessage(String(error?.message ?? '操作失败')) }).finally(() => { if (mounted.current) setBusy(false) })
  }
  const loadDirectory = (force = false) => {
    pendingDirectory.current?.cancel(); const generation = ++directoryGeneration.current
    if (!accountId) { setEntries([]); return }
    setDirectoryLoading(true); setSelected([]); setVisibleCount(100)
    const pending = browseDirectory(accountId, path, force); pendingDirectory.current = pending
    void pending.promise.then(data => { if (mounted.current && generation === directoryGeneration.current) setEntries(data) })
      .catch(error => { if (mounted.current && generation === directoryGeneration.current) { setEntries([]); setMessage(String(error?.message ?? '目录读取失败')) } })
      .finally(() => { if (mounted.current && generation === directoryGeneration.current) setDirectoryLoading(false) })
  }
  useEffect(() => { if (tab === 'webdav') loadDirectory() }, [accountId, path, tab])
  const playlistButtons = <View style={row}>{[{ id: 'default', name: '默认列表' }, { id: 'love', name: '我的收藏' }, ...lists.filter(l => !['default', 'love'].includes(l.id))].map(list =>
    <Button key={list.id} title={`${listId === list.id ? '已选：' : ''}${list.name}`} disabled={locked} onPress={() => { setListId(list.id) }} />)}</View>
  const accountButtons = <View style={row}>{library.configuration.accounts.map(a => <Button key={a.id} title={`${accountId === a.id ? '已选：' : ''}${a.name}`} disabled={locked} onPress={() => { setAccountId(a.id); setPath(''); setBackupEntries([]) }} />)}</View>
  if (Platform.OS !== 'ios') return <View style={{ flex: 1, padding: 20 }}><Text>资料库功能需要iOS / iPadOS构建。</Text></View>
  const tabs = <View style={row}><Button title="下载" id="library-tab-downloads" onPress={() => { setTab('downloads') }} /><Button title="WebDAV" id="library-tab-webdav" onPress={() => { setTab('webdav') }} /><Button title="备份 / 恢复" id="library-tab-backup" onPress={() => { setTab('backup') }} /></View>
  if (tab === 'downloads') return <View testID="library-screen" style={{ flex: 1, minHeight: 0, backgroundColor: theme['c-main-background'] }}>{tabs}<Downloads /></View>
  return <View testID="library-screen" style={{ flex: 1, backgroundColor: theme['c-main-background'] }}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingBottom: 40, maxWidth: 1100, width: '100%', alignSelf: 'center' }}>
      <Text size={22} style={{ marginBottom: 8 }}>{tab === 'webdav' ? 'WebDAV 音乐' : '备份 / 恢复'}</Text>
      {tabs}
      {library.error || queue.error ? <Text testID="library-error" size={15}>错误：{library.error || queue.error}</Text> : null}
      {message ? <Text testID="library-message" selectable size={15} style={{ marginVertical: 10 }}>{message}</Text> : null}
      {progress ? <Text testID="library-progress">{statusName[progress.phase] ?? progress.phase}：{formatBytes(progress.received)}{progress.total > 0 ? ` / ${formatBytes(progress.total)}` : ''}</Text> : null}
      {tab === 'webdav' ? <View>
        {accountButtons}
        <View style={row}><Button title="添加账户" id="library-account-add" disabled={locked} onPress={() => { setEditing({ ...emptyAccount }); setAccountPassword(''); setPasswordEdited(true) }} />
          <Button title="编辑当前账户" disabled={locked || !accountId} onPress={() => { setEditing({ ...library.configuration.accounts.find(a => a.id === accountId) }); setAccountPassword(''); setPasswordEdited(false) }} />
          <Button title="删除当前账户" disabled={locked || !accountId} onPress={() => { run(async() => { if (await confirm('删除WebDAV账户', '删除保存的连接和密码，不删除服务器文件或歌单。已导入歌曲在账户重新配置前将无法读取。')) await removeAccount(accountId) }) }} /></View>
        {editing ? <View testID="library-account-editor" style={{ padding: 12, borderWidth: 1, borderColor: theme['c-border-background'], marginBottom: 12 }}>
          <Field label="账户名称" value={editing.name ?? ''} onChange={name => { setEditing({ ...editing, name }) }} disabled={locked} />
          <Field id="library-account-endpoint" label="WebDAV根目录完整地址" value={editing.endpoint ?? ''} onChange={endpoint => { setEditing({ ...editing, endpoint }) }} disabled={locked} />
          <Field label="用户名" value={editing.username ?? ''} onChange={username => { setEditing({ ...editing, username }) }} disabled={locked} />
          <Field id="library-account-password" label={editing.id ? '密码（不修改则保留已存密码）' : '密码（匿名可为空）'} value={accountPassword} secure onChange={value => { setAccountPassword(value); setPasswordEdited(true) }} disabled={locked} />
          <Toggle title="允许明文HTTP（仅可信局域网）" value={!!editing.allowHTTP} onChange={allowHTTP => { setEditing({ ...editing, allowHTTP }) }} disabled={locked} />
          <Toggle id="library-directory-cache" title="缓存目录5分钟，减少目录请求" value={!!editing.directoryCache} onChange={directoryCache => { setEditing({ ...editing, directoryCache }) }} disabled={locked} />
          <Toggle id="library-audio-cache" title="保留已验证音频缓存，重复播放可离线复用" value={!!editing.audioCache} onChange={audioCache => { setEditing({ ...editing, audioCache }) }} disabled={locked} />
          <Text size={13}>关闭音频缓存后，每次播放重新请求完整音频；临时文件只供本次播放。准备完成后由原播放器播放。目录和音频缓存互不依赖。</Text>
          <View style={row}><Button title="保存账户" id="library-account-save" disabled={locked} onPress={() => { run(async() => {
            const value = await saveAccount({ ...editing, ...(passwordEdited ? { password: accountPassword } : {}) });
            setAccountPassword(''); setEditing(null); setAccountId(editing.id ?? value.accounts[value.accounts.length - 1].id); setMessage('账户已保存；点击强制刷新可验证连接。')
          }) }} /><Button title="取消编辑" disabled={locked} onPress={() => { setEditing(null); setAccountPassword('') }} /></View>
        </View> : null}
        <Field label="音频缓存上限（MB，0表示不读写音频缓存）" value={limit} numeric onChange={setLimit} disabled={locked} />
        <View style={row}><Button title="保存缓存上限" disabled={locked} onPress={() => { run(async() => { await setCacheLimit(Number(limit)); setMessage('缓存上限已保存。') }) }} />
          <Button title="清除目录缓存" disabled={locked} onPress={() => { run(async() => { await clearCache('directory'); setMessage('目录缓存已清除。') }) }} />
          <Button title="清除音频缓存" disabled={locked} onPress={() => { run(async() => { await clearCache('audio'); setMessage('音频缓存已清除；已下载文件和正在播放的临时副本保留。') }) }} /></View>
        <Text selectable size={15}>目录：/{path}</Text>
        <View style={row}><Button title="上一级" disabled={locked || directoryLoading || !path} onPress={() => { setPath(path.split('/').slice(0, -1).join('/')) }} />
          <Button title={directoryLoading ? '读取中…' : '强制刷新 / 测试连接'} id="library-directory-refresh" disabled={locked || directoryLoading || !accountId} onPress={() => { loadDirectory(true) }} />
          <Button title="全选当前目录音频" disabled={locked || directoryLoading} onPress={() => { setSelected(entries.filter(e => !e.directory && supportedAudio(e.name)).map(e => e.path)) }} /></View>
        {entries.slice(0, visibleCount).map(entry => <TouchableOpacity key={entry.path} accessibilityRole="button" accessibilityLabel={`${entry.directory ? '打开文件夹' : '选择文件'} ${entry.name}`}
          onPress={() => { if (locked) return; if (entry.directory) { setPath(entry.path) } else if (supportedAudio(entry.name)) setSelected(current => current.includes(entry.path) ? current.filter(p => p !== entry.path) : [...current, entry.path]) }}
          style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme['c-border-background'] }}>
          <Text size={15}>{entry.directory ? '目录 / ' : selected.includes(entry.path) ? '已选 / ' : ''}{entry.name}</Text>
          {!entry.directory && entry.size != null ? <Text size={12}>{formatBytes(entry.size)}</Text> : null}
        </TouchableOpacity>)}
        {visibleCount < entries.length ? <Button title={`显示更多（共${entries.length}项）`} onPress={() => { setVisibleCount(v => v + 100) }} /> : null}
        {!directoryLoading && accountId && entries.length === 0 ? <Text>当前目录没有可显示条目。</Text> : null}
        <Text style={{ marginTop: 14 }}>导入目的歌单（已选{selected.length}首）</Text>{playlistButtons}
        <View style={row}><Button id="library-import" title="添加到所选歌单" disabled={locked || !selected.length} onPress={() => { run(async() => { const result = await importEntries(accountId, entries.filter(e => selected.includes(e.path)), listId); setSelected([]); setMessage(`已添加${result.count}首；从我的列表播放。`) }) }} />
          <Button title="返回我的列表" onPress={() => { setActiveList(listId); setNavActiveId('nav_love') }} /></View>
        <Text size={13}>需要新歌单时，请先在“我的列表”中新建，再从该列表选择“从 WebDAV 添加”。</Text>
      </View> : null}
      {tab === 'backup' ? <View>
        <Text size={16}>备份类型</Text><View style={row}><Button title={`${backupKind === 'full' ? '已选：' : ''}完整软件数据`} disabled={locked} onPress={() => { setBackupKind('full') }} /><Button title={`${backupKind === 'playlists' ? '已选：' : ''}全部歌单`} disabled={locked} onPress={() => { setBackupKind('playlists') }} /></View>
        <Text size={13}>完整备份包含应用Documents、Application Support、设置、用户音源、歌单、已下载文件、下载记录及WebDAV凭据；可包含Library/Caches。已有备份文件、临时播放副本、系统授权、签名与外部未导入的文件不在软件数据包内。歌单备份包含歌单所引用的WebDAV账户，恢复时保留其他设置和文件。</Text>
        <Toggle title="包含Library/Caches缓存文件" value={includeCaches} onChange={setIncludeCaches} disabled={locked || backupKind !== 'full'} />
        <Field id="library-backup-password" label="备份 / 恢复密码（至少10个字符，不会保存）" value={password} secure onChange={setPassword} disabled={locked} />
        <Field label="再次输入密码（创建备份时必填）" value={passwordAgain} secure onChange={setPasswordAgain} disabled={locked} />
        <Text size={13}>密码用于PBKDF2派生及AES-GCM加密。忘记密码不能恢复。上传仅发送加密文件；WebDAV上传需要完整读回校验，因此额外消耗一次下载流量。</Text>
        <Button id="library-backup-create" title="创建加密备份" disabled={locked} onPress={() => { run(async() => {
          if (password.length < 10 || password !== passwordAgain) throw new Error('请填写至少10个字符且两次一致的密码')
          pendingDirectory.current?.cancel()
          const result = await createEncryptedBackup(backupKind, password, includeCaches, setProgress); setBackup(result); setPassword(''); setPasswordAgain(''); setMessage('加密备份已生成；请选择导出文件或上传到WebDAV。')
        }) }} />
        {backup ? <View><Text selectable>{backup.name} · {formatBytes(backup.size)}</Text><Text selectable size={12}>SHA256：{backup.sha256}</Text>
          <Button title="导出加密备份文件" disabled={locked} onPress={() => { run(async() => { await shareFile(backup.name, backup.path) }) }} /></View> : null}
        {accountButtons}<Field label="WebDAV备份目录（相对根目录）" value={backupFolder} onChange={setBackupFolder} disabled={locked} />
        <View style={row}><Button title="上传刚创建的备份" disabled={locked || !accountId || !backup} onPress={() => { run(async() => { await uploadBackup(backup!.path, accountId, backupFolder, setProgress).promise; setMessage('服务器读回校验通过，加密备份已上传。') }) }} />
          <Button title="查看WebDAV备份" disabled={locked || !accountId} onPress={() => { run(async() => { const data = await browseDirectory(accountId, backupFolder, true).promise; setBackupEntries(data.filter(e => !e.directory && e.name.toLowerCase().endsWith('.lxbackup'))) }) }} /></View>
        {backupEntries.map(entry => <Button key={entry.path} title={`选择恢复：${entry.name}`} disabled={locked} onPress={() => { run(async() => { const result = await fetchBackup(accountId, entry.path, setProgress).promise; setRestorePath(result.path); setMessage('备份已下载到应用；输入密码后先解密检查。') }) }} />)}
        <Button title="选择本地加密备份" disabled={locked} onPress={() => { run(async() => { const file = await selectFile({ extTypes: ['lxbackup'] }); setRestorePath(file.path); setMessage('已选择备份，尚未修改当前软件数据。') }) }} />
        <Text selectable size={12}>待检查文件：{restorePath.split('/').pop() || '未选择'}</Text>
        <Button id="library-restore-stage" title="解密并检查备份（暂不替换）" disabled={locked || !restorePath} onPress={() => { run(async() => {
          const result = await stageEncryptedRestore(restorePath, password, setProgress); setRestore(result); setPassword(''); setPasswordAgain(''); setMessage('解密、版本及文件校验通过；确认恢复后，下次冷启动才替换数据。')
        }) }} />
        {restore && restore.state !== 'none' ? <View testID="library-restore-status"><Text size={15}>{restore.message}</Text>
          <Text size={13}>{restore.kind === 'full' ? '完整数据' : restore.kind === 'playlists' ? '歌单' : ''}{restore.files != null ? ` · ${restore.files}个文件` : ''}{restore.bytes != null ? ` · ${formatBytes(restore.bytes)}` : ''}</Text>
          {restore.state === 'prepared' ? <Button id="library-restore-arm" title="确认在下次冷启动恢复" disabled={locked} onPress={() => { run(async() => {
            if (await confirm('替换软件数据', '恢复将替换备份范围内的数据。原数据保留到首次成功启动；启动验证失败则下次启动回滚。确认后请从后台关闭并重新打开应用，不要卸载。')) { await downloadQueue.pauseAll(); setRestore(await armRestore(restore.id!)); setMessage('已安排恢复。请从后台关闭后重新打开应用，不要卸载。') }
          }) }} /> : null}
          {['prepared', 'ready'].includes(restore.state) ? <Button title="取消待恢复事务" disabled={locked} onPress={() => { run(async() => { await cancelRestore(restore.id!); setRestore(await restoreStatus()); setMessage('已取消，原软件数据未替换。') }) }} /> : null}
        </View> : null}
      </View> : null}
    </ScrollView>
  </View>
}
