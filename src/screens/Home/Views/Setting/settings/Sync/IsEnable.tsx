import Clipboard from '@react-native-clipboard/clipboard'
import { getSyncDiagnostic } from '@/plugins/sync/diagnostics'
import { useCallback, useState, useEffect, useRef } from 'react'
import { View, Linking } from 'react-native'
import CheckBoxItem from '../../components/CheckBoxItem'
import Button from '../../components/Button'
import ConfirmAlert, { type ConfirmAlertType } from '@/components/common/ConfirmAlert'
import Input from '@/components/common/Input'
import Text from '@/components/common/Text'
import { connectServer, disconnectServer } from '@/plugins/sync'
import { normalizeSyncAddress } from '@/plugins/sync/address'
import { addSyncHostHistory, getSyncHost, setSyncHost } from '@/plugins/sync/data'
import { updateSetting } from '@/core/common'
import { useSettingValue } from '@/store/setting/hook'
import { useTheme } from '@/store/theme/hook'
import { useStatus } from '@/store/sync/hook'
import { SYNC_CODE } from '@/plugins/sync/constants'
import { toast } from '@/utils/tools'

export default ({ host, setHost }: { host: string, setHost: (host: string) => void }) => {
  const theme = useTheme()
  const status = useStatus()
  const enabled = useSettingValue('sync.enable')
  const [busy, setBusy] = useState(false)
  const [authCode, setAuthCode] = useState('')
  const [error, setError] = useState('')
  const mounted = useRef(true)
  const touched = useRef(false)
  const requestId = useRef(0)
  const alert = useRef<ConfirmAlertType>(null)
  useEffect(() => {
    mounted.current = true
    void getSyncHost().then(value => { if (mounted.current && !touched.current) setHost(value || '') }).catch(() => {})
    return () => { mounted.current = false }
  }, [setHost])
  useEffect(() => {
    if (status.message == SYNC_CODE.missingAuthCode || status.message == SYNC_CODE.authFailed) {
      if (status.message == SYNC_CODE.authFailed) setError('配对码或密码不正确，请重新输入')
      alert.current?.setVisible(true)
    }
  }, [status.message])
  const connect = useCallback(async(code?: string) => {
    const id = ++requestId.current
    setBusy(true); setError('')
    try {
      const address = normalizeSyncAddress(host)
      setHost(address)
      await setSyncHost(address)
      if (id != requestId.current) return
      updateSetting({ 'sync.enable': true })
      await connectServer(address, code)
      if (id == requestId.current) await addSyncHostHistory(address)
    } catch (e: any) {
      if (mounted.current && id == requestId.current && e?.message != SYNC_CODE.missingAuthCode && e?.message != SYNC_CODE.authFailed) setError(e?.message || '同步连接失败')
    } finally { if (mounted.current && id == requestId.current) setBusy(false) }
  }, [host, setHost])
  const disconnect = () => {
    ++requestId.current; setBusy(false)
    updateSetting({ 'sync.enable': false })
    void disconnectServer().catch(() => toast('断开失败，请重试'))
    alert.current?.setVisible(false)
    setAuthCode('')
  }
  const submitCode = () => {
    if (!authCode.trim()) { setError('请输入电脑端配对码或同步服务密码'); return }
    const code = authCode.trim(); setAuthCode(''); alert.current?.setVisible(false)
    void connect(code)
  }
  return <View style={{ marginHorizontal: 20, gap: 10 }}>
    <Text>电脑端请先开启“数据同步”，输入电脑显示的地址；设备需能互相访问。首次连接必须选择合并或覆盖方向。</Text>
    <Text>同步地址</Text>
    <Input testID="sync-address" value={host} autoCapitalize="none" autoCorrect={false} keyboardType="url"
      editable={!busy} placeholder="http://192.168.1.10:9527"
      onChangeText={value => { touched.current = true; setHost(value) }}
      onSubmitEditing={() => { void connect() }}
      style={{ minHeight: 44, backgroundColor: theme['c-primary-input-background'], borderRadius: 6 }} />
    <CheckBoxItem check={enabled} label="启用数据同步" onChange={value => { if (value) void connect(); else disconnect() }} />
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
      <Button disabled={busy} onPress={() => { void connect() }}>{enabled ? '重新连接' : '连接电脑 / 同步服务'}</Button>
      {enabled || busy ? <Button onPress={disconnect}>断开 / 取消</Button> : null}
      <Button onPress={() => { void Linking.openSettings().catch(() => toast('无法打开系统设置')) }}>本地网络权限设置</Button>
    </View>
    <Text accessibilityLiveRegion="polite">{status.status ? '已连接，列表更改会双向同步' : busy ? '正在连接…' : error || status.message || '未连接'}</Text>
    {!status.status && (error || status.message) ? <Button onPress={() => { Clipboard.setString(getSyncDiagnostic() || error || status.message); toast('已复制同步诊断，不包含配对码或密钥') }}>复制同步诊断</Button> : null}
    <Text size={12}>连接失败时检查：iOS 本地网络权限、电脑防火墙、地址及端口、两端同步协议版本。同步不会自动传输音频文件；首次覆盖前请导出备份。</Text>
    <ConfirmAlert ref={alert} onCancel={disconnect} onConfirm={submitCode}>
      <View style={{ minWidth: 0, flexShrink: 1, gap: 10 }}>
        <Text>请输入电脑显示的配对码，或独立同步服务的密码</Text>
        <Input testID="sync-auth-code" value={authCode} onChangeText={setAuthCode} autoCapitalize="none" autoCorrect={false}
          secureTextEntry onSubmitEditing={submitCode} style={{ minWidth: 0, minHeight: 44, backgroundColor: theme['c-primary-input-background'] }} />
        {error ? <Text>{error}</Text> : null}
      </View>
    </ConfirmAlert>
  </View>
}
