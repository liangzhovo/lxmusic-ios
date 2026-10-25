// Run the real tools.ts gate and theme initializer with iOS-shaped Platform
// constants. Returning true from a gate mock hid Run87's missing subscription.
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript')
const { EventEmitter } = require('node:events')
const root = path.resolve(__dirname, '..')
const load = (file, mocks, globals = {}) => {
  const source = fs.readFileSync(path.join(root, file), 'utf8')
  const output = ts.transpileModule(source, {fileName:file, compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}})
  const exports = {}
  vm.runInNewContext(output.outputText, {exports,console,setTimeout,clearTimeout,...globals,require(name){
    assert.ok(name in mocks, `${file}: missing mock ${name}`); return mocks[name]
  }}, {filename:file})
  return exports
}
const tools = (Platform, Appearance) => load('src/utils/tools.ts', {
  'react-native':{Platform,Appearance}, '@react-native-clipboard/clipboard':{},
  '@/config/constant':{}, '@/utils/fs':{}, '@/utils/nativeModules/utils':{},
  '@/utils/musicSdk':{}, '@/plugins/storage':{}, 'react-native-background-timer':{},
  './pixelRatio':{}, './index':{}, 'react-native-quick-md5':{}, '@/utils/windowSizeTools':{},
})
module.exports = async function checkPlatformTheme() {
  // Release is an Android-only constant. Do not populate it on iOS fixtures.
  for (const [version, expected] of [['12.5',false],['13.0',true],['17.6.1',true],['26.6',true]]) {
    const real = tools({OS:'ios',Version:version,constants:{osVersion:version}}, {})
    assert.equal(real.getIsSupportedAutoTheme(),expected,`iOS ${version} automatic theme support`)
    assert.equal(real.getIsSupportedAutoTheme(),expected,'cached support must match')
  }
  for (const [release, api, expected] of [['4.4',19,false],['5.0',21,true],['14',34,true]]) {
    assert.equal(tools({OS:'android',Version:api,constants:{Release:release}},{}).getIsSupportedAutoTheme(),expected)
  }
  const event = new EventEmitter(), cfg = {setting:{'theme.id':'auto','theme.lightId':'blue','theme.darkId':'black','common.isAutoTheme':true}}
  const state = {theme:{id:'blue',isDark:false},shouldUseDarkColors:false}
  let dark=false, listener, registered=0, removed=0, refreshes=0
  const Platform={OS:'ios',Version:'26.6',constants:{osVersion:'26.6'}}
  const real=tools(Platform,{
    getColorScheme:()=>dark?'dark':'light',
    addChangeListener:fn=>{registered++;listener=fn;return{remove(){removed++}}},
  })
  const init=load('src/core/init/theme.ts',{
    'react-native':{Platform,NativeModules:{LXWindowAppearance:{getSystemDark:async()=>dark}},AppState:{addEventListener:()=>({remove(){}})}},
    '@/utils/tools':real,'@/core/theme':{
      setShouldUseDarkColors:value=>{state.shouldUseDarkColors=value},
      refreshTheme:async()=>{refreshes++;state.theme={id:state.shouldUseDarkColors?'black':'blue',isDark:state.shouldUseDarkColors};event.emit('themeUpdated')},
    },'@/store/setting/state':{default:cfg},'@/navigation/appearance':{applyNavigationAppearance(){}},
    '@/store/theme/state':{default:state},'@/theme/systemTheme':{isAutoTheme:s=>s['theme.id']==='auto'},
  },{global:{state_event:event}}).default
  const cleanup=await init(cfg.setting)
  assert.equal(registered,1,'production gate must actually register an iOS Appearance listener')
  dark=true;listener({colorScheme:'dark'});await new Promise(resolve=>setTimeout(resolve,10))
  assert.equal(state.theme.id,'black');assert.equal(state.shouldUseDarkColors,true)
  dark=false;listener({colorScheme:'light'});await new Promise(resolve=>setTimeout(resolve,10))
  assert.equal(state.theme.id,'blue')
  cleanup();assert.equal(removed,1)
  const before=refreshes;dark=true;listener({colorScheme:'dark'});await new Promise(resolve=>setTimeout(resolve,10))
  assert.equal(refreshes,before,'disposed listener must not refresh the theme')
}
if (require.main===module) module.exports().then(()=>console.log('PASS real platform gate + iOS appearance registration')).catch(error=>{console.error(error);process.exitCode=1})
