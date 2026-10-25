import { useEffect, useRef, useState } from 'react'
import { Alert, FlatList, TouchableOpacity, View } from 'react-native'
import Text from '@/components/common/Text'
import { useTheme } from '@/store/theme/hook'
import { setNavActiveId } from '@/core/common'
import { downloadQueue, localDownloadPath, useDownloadQueue } from '@/core/library'
import type { DownloadJob } from '@/core/library/types'
import { publishedMusic } from '@/core/library/reference'
import { shareFile } from '@/utils/nativeModules/utils'
import MusicAddModal, { type MusicAddModalType } from '@/components/MusicAddModal'

const running = new Set(['queued', 'resolving', 'downloading', 'uploading', 'verifying'])
const labels: Record<string, string> = { queued: '等待下载', resolving: '获取音源', downloading: '下载中', uploading: '上传到WebDAV', verifying: '校验文件', paused: '已暂停', failed: '下载失败', completed: '已完成' }
export const formatBytes = (n: number) => n < 1024 ? `${Math.max(0, n)} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : n < 1073741824 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1073741824).toFixed(2)} GB`
export function TaskAction({ label, onPress, disabled = false, id }: { label: string, onPress: () => void, disabled?: boolean, id?: string }) {
  const theme = useTheme()
  return <TouchableOpacity testID={id} accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 10, opacity: disabled ? 0.4 : 1 }}>
    <Text size={14} color={theme['c-primary-font']}>{label}</Text>
  </TouchableOpacity>
}
export default function Downloads() {
  const theme = useTheme(), queue = useDownloadQueue()
  const [tab, setTab] = useState<'active' | 'history'>('active')
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false)
  const [rates, setRates] = useState<Record<string, number>>({})
  const jobsRef = useRef(queue.jobs), samples = useRef(new Map<string, { bytes: number, time: number, phase: string }>())
  const mounted = useRef(true), pending = useRef(false), add = useRef<MusicAddModalType>(null)
  jobsRef.current = queue.jobs
  const transferring = queue.jobs.some(job => ['downloading', 'uploading'].includes(job.status))
  useEffect(() => {
    mounted.current = true
    if (!transferring) { setRates({}); return () => { mounted.current = false } }
    const timer = setInterval(() => {
      const now = Date.now(), next: Record<string, number> = {}, keep = new Set<string>()
      for (const job of jobsRef.current) {
        if (!['downloading', 'uploading'].includes(job.status)) continue
        keep.add(job.id)
        const prior = samples.current.get(job.id)
        next[job.id] = prior && prior.phase === job.status && now > prior.time && job.received >= prior.bytes ? (job.received - prior.bytes) * 1000 / (now - prior.time) : 0
        samples.current.set(job.id, { bytes: job.received, time: now, phase: job.status })
      }
      for (const id of samples.current.keys()) if (!keep.has(id)) samples.current.delete(id)
      setRates(next)
    }, 1000)
    return () => { mounted.current = false; clearInterval(timer) }
  }, [transferring])
  const run = (task: () => Promise<unknown>) => {
    if (pending.current) return
    pending.current = true; setBusy(true); setMessage('')
    void task().catch(error => { if (mounted.current) setMessage(String(error?.message ?? '操作失败')) })
      .finally(() => { pending.current = false; if (mounted.current) setBusy(false) })
  }
  const active = queue.jobs.filter(j => j.status !== 'completed'), history = queue.jobs.filter(j => j.status === 'completed').reverse()
  const renderItem = ({ item: job }: { item: DownloadJob }) => {
    const percent = job.total > 0 ? Math.min(100, Math.max(0, job.received / job.total * 100)) : 0
    return <View testID={`library-job-${job.id}`} style={{ paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: theme['c-border-background'] }}>
      <Text size={16} numberOfLines={1}>{job.music.name}</Text>
      <Text size={13} numberOfLines={1} color={theme['c-600']} style={{ marginTop: 4 }}>{job.music.singer || '未知歌手'} · {job.quality} · {job.destination.kind === 'local' ? '本机' : 'WebDAV'}</Text>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginVertical: 8 }}>
        <Text size={13}>{labels[job.status]}{rates[job.id] > 0 ? ` · ${formatBytes(Math.round(rates[job.id]))}/s` : ''}</Text>
        <Text size={13}>{job.total > 0 ? `${percent.toFixed(1)}% · ${formatBytes(job.received)} / ${formatBytes(job.total)}` : formatBytes(job.received)}</Text>
      </View>
      {job.status !== 'completed' ? <View testID={`download-progress-${job.id}`} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(percent) }} style={{ height: 3, borderRadius: 2, backgroundColor: theme['c-border-background'], overflow: 'hidden' }}>
        <View style={{ width: `${percent}%`, height: 3, backgroundColor: theme['c-primary'] }} />
      </View> : null}
      {job.error ? <Text size={13} style={{ marginTop: 6 }}>{job.error}</Text> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginLeft: -10 }}>
        {running.has(job.status) ? <TaskAction id={`download-pause-${job.id}`} label="暂停" disabled={busy} onPress={() => { run(() => downloadQueue.pause(job.id)) }} /> : null}
        {['paused', 'failed'].includes(job.status) ? <TaskAction id={`download-retry-${job.id}`} label={job.status === 'failed' ? '重试' : '继续'} disabled={busy || !queue.enabled} onPress={() => { run(() => downloadQueue.retry(job.id)) }} /> : null}
        {job.result ? <TaskAction label="添加到列表" onPress={() => { add.current?.show({ musicInfo: publishedMusic(job.result!, job.music), listId: '', isMove: false }) }} /> : null}
        {job.result?.kind === 'local' ? <TaskAction label="导出文件" disabled={busy} onPress={() => { run(async() => shareFile(job.result!.name, await localDownloadPath(job.result!.path))) }} /> : null}
        <TaskAction id={`download-remove-${job.id}`} label="移除记录" disabled={busy} onPress={() => {
          Alert.alert('移除下载记录', '仅移除任务及未完成的临时文件，已完成的音乐文件不会删除。', [{ text: '取消', style: 'cancel' }, { text: '移除', onPress: () => { run(() => downloadQueue.remove(job.id)) } }])
        }} />
      </View>
    </View>
  }
  return <View testID="download-task-page" style={{ flex: 1, minHeight: 0, backgroundColor: theme['c-main-background'] }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', borderBottomWidth: 0.5, borderBottomColor: theme['c-border-background'], paddingHorizontal: 8 }}>
      <TaskAction id="download-active-tab" label={`下载中 (${active.length})${tab === 'active' ? ' ·' : ''}`} onPress={() => { setTab('active') }} />
      <TaskAction id="download-history-tab" label={`下载记录 (${history.length})${tab === 'history' ? ' ·' : ''}`} onPress={() => { setTab('history') }} />
      <View style={{ flex: 1 }} /><TaskAction id="download-settings-link" label="设置" onPress={() => { setNavActiveId('nav_setting') }} />
    </View>
    {!queue.enabled ? <Text size={13} style={{ padding: 12 }}>下载功能尚未启用，请到“设置 → 下载设置”开启。已有下载记录会保留。</Text> : null}
    {queue.error || message ? <Text testID="download-error" style={{ padding: 12 }}>{queue.error || message}</Text> : null}
    {tab === 'active' && active.length > 0 ? <View style={{ flexDirection: 'row', paddingHorizontal: 8 }}>
      <TaskAction label="暂停全部" disabled={busy} onPress={() => { run(() => downloadQueue.pauseAll()) }} />
      <TaskAction label="继续全部" disabled={busy || !queue.enabled} onPress={() => { run(async() => { for (const job of active) if (job.status === 'paused' || job.status === 'failed') await downloadQueue.retry(job.id) }) }} />
    </View> : null}
    <FlatList testID="download-records" data={tab === 'active' ? active : history} keyExtractor={job => job.id} renderItem={renderItem}
      contentContainerStyle={{ paddingHorizontal: 16, flexGrow: 1 }} initialNumToRender={12} windowSize={7}
      ListEmptyComponent={<View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 48 }}><Text size={15}>{tab === 'active' ? '暂无下载任务' : '暂无下载记录'}</Text><Text size={13} style={{ marginTop: 8 }}>在歌曲或歌单菜单中选择“下载”。</Text></View>} />
    <MusicAddModal ref={add} />
  </View>
}
