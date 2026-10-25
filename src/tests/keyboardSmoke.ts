import { NativeModules } from 'react-native'
import initRemoteCommand from '@/core/init/player/remoteCommand'
import { keyboardRouter } from '@/core/keyboardRouter'
import { updateSetting } from '@/core/common'
const sleep = async(ms: number) => new Promise(resolve => setTimeout(resolve, ms))
type Check = (name: string, fn: () => Promise<unknown>) => Promise<void>
export const runKeyboardSmoke = async(check: Check) => {
  const support = NativeModules.LXPlaybackTestSupport
  initRemoteCommand()
  const assert = (value: unknown, message: string) => { if (!value) throw new Error(message) }
  await check('keyboard: native commands update from settings and reach only the active JS selection target',async()=>{
    updateSetting({'keyboard.enabled':true,'keyboard.selection':true})
    await sleep(250)
    const commands=await support.keyboardSnapshot() as string[]
    assert(commands.includes('select_up')&&commands.includes('select_down')&&commands.includes('select_enter'),'Native arrow/Enter commands missing')
    const received: string[]=[]
    const off=keyboardRouter.register({layer:0,enabled:()=>true,handle:action=>{received.push(action);return true}})
    try {
      await support.sendKeyboard('select_down');await sleep(250)
      await support.sendKeyboard('select_enter');await sleep(250)
      assert(received.join(',')==='select_down,select_enter','Native key command did not reach JS router')
      updateSetting({'keyboard.selection':false});await sleep(250)
      assert(!(await support.keyboardSnapshot()).includes('select_enter'),'Disabled native selection still intercepts Enter')
      updateSetting({'keyboard.enabled':false});await sleep(250)
      assert((await support.keyboardSnapshot()).length===0,'Master keyboard toggle ignored')
    }finally{off();updateSetting({'keyboard.enabled':true,'keyboard.selection':true});await sleep(250)}
    return {commands,received}
  })
  await check('keyboard: native text input focus removes application arrow/space/Enter overrides',async()=>{
    const probe=await support.keyboardEditingProbe()
    assert(probe.focused && probe.appKeysWhileEditing===0,'Text editing would be intercepted')
    return probe
  })
}
