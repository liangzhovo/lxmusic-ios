import { getData, saveData } from '@/plugins/storage'
export const LOCAL_LIBRARY_ID = 'userlist_local_music'
export const LIBRARY_BOOTSTRAP_KEY = '@lx/ios-library-initialized-v1'
export const markLibraryInitialized = async() => saveData(LIBRARY_BOOTSTRAP_KEY, true)
export const bootstrapLibrary = async(hasLocalList: () => boolean, create: () => Promise<unknown>) => {
  if (await getData<boolean>(LIBRARY_BOOTSTRAP_KEY)) return
  if (!hasLocalList()) await create()
  await markLibraryInitialized()
}
