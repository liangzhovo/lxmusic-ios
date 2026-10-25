import { useRef, useImperativeHandle, forwardRef, useState } from 'react'
import ConfirmAlert, { type ConfirmAlertType } from '@/components/common/ConfirmAlert'
import Text from '@/components/common/Text'
import { View } from 'react-native'
import Input, { type InputType } from '@/components/common/Input'
import { createUserList, updateUserList, setActiveList } from '@/core/list'
import { confirmDialog, createStyle, toast } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import listState from '@/store/list/state'

interface NameInputType {
  setName: (text: string) => void
  getText: () => string
  focus: () => void
}
const NameInput = forwardRef<NameInputType, {}>((props, ref) => {
  const theme = useTheme()
  const [text, setText] = useState('')
  const [placeholder, setPlaceholder] = useState('')
  const inputRef = useRef<InputType>(null)

  useImperativeHandle(ref, () => ({
    getText() {
      return text.trim()
    },
    setName(text) {
      setText(text)
      setPlaceholder(text || global.i18n.t('list_create_input_placeholder'))
    },
    focus() {
      inputRef.current?.focus()
    },
  }))

  return (
    <Input
      ref={inputRef}
      placeholder={placeholder}
      value={text}
      onChangeText={setText}
      style={{ ...styles.input, backgroundColor: theme['c-primary-input-background'] }}
    />
  )
})


export interface ListNameEditType {
  showCreate: (position: number) => void
  show: (listInfo: LX.List.UserListInfo) => void
}
const initSelectInfo = {}


export default forwardRef<ListNameEditType, {}>((props, ref) => {
  const alertRef = useRef<ConfirmAlertType>(null)
  const nameInputRef = useRef<NameInputType>(null)
  const [position, setPosition] = useState(0)
  const selectedListInfo = useRef<LX.List.UserListInfo>(initSelectInfo as LX.List.UserListInfo)
  const [visible, setVisible] = useState(false)

  const actionRef = useRef(0)
  const saving = useRef(false)
  const handleShow = (name: string) => {
    alertRef.current?.setVisible(true)
    requestAnimationFrame(() => {
      nameInputRef.current?.setName(name)
      setTimeout(() => {
        nameInputRef.current?.focus()
      }, 300)
    })
  }
  useImperativeHandle(ref, () => ({
    showCreate(position) {
      actionRef.current = position
      setPosition(position)
      if (visible) handleShow('')
      else {
        setVisible(true)
        requestAnimationFrame(() => {
          handleShow('')
        })
      }
    },
    show(listInfo) {
      actionRef.current = -1
      setPosition(-1)
      selectedListInfo.current = listInfo
      if (visible) handleShow(listInfo.name)
      else {
        setVisible(true)
        requestAnimationFrame(() => {
          handleShow(listInfo.name)
        })
      }
    },
  }))

  const handleRename = async() => {
    if (saving.current) return
    const name = (nameInputRef.current?.getText() ?? '').slice(0, 100)
    if (!name) return
    saving.current = true
    try {
      if (actionRef.current === -1) {
        await updateUserList([{ ...selectedListInfo.current, name }])
      } else {
        if (listState.userList.some(l => l.name === name) && !await confirmDialog({ message: global.i18n.t('list_duplicate_tip') })) return
        const now = Date.now(), id = `userlist_${now}_${Math.random().toString(36).slice(2, 8)}`
        await createUserList(actionRef.current, [{ id, name, locationUpdateTime: now }])
        setActiveList(id)
      }
      alertRef.current?.setVisible(false)
    } catch (error) { toast(error instanceof Error ? error.message : '列表保存失败，请重试') }
    finally { saving.current = false }
  }

  return (
    visible
      ? <ConfirmAlert
          ref={alertRef}
          onConfirm={handleRename}
        >
          <View style={styles.renameContent}>
            <Text style={{ marginBottom: 5 }}>{ position == -1 ? global.i18n.t('list_rename_title') : global.i18n.t('list_create')}</Text>
            <NameInput ref={nameInputRef} />
          </View>
        </ConfirmAlert>
      : null
  )
})


const styles = createStyle({
  renameContent: {
    flexGrow: 1,
    flexShrink: 1,
    flexDirection: 'column',
  },
  input: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 290,
    borderRadius: 4,
    // paddingTop: 2,
    // paddingBottom: 2,
  },
})


