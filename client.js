/**
 * dsh-session-delete — Client 半边
 *
 * 三个入口，共用同一个 Host 操作：
 *   1. 「…」菜单 → 删除对话…        (sidebar.workspaces.session.menu.item)
 *   2. 会话行悬停垃圾桶按钮          (sidebar.workspaces.session.row.action)
 *   3. 设置 → 删除对话（回收站 / 残留清理）(settings.section)
 *
 * 确认对话框走 frame 级浮层 (shell.overlay)，不用 window.confirm。
 */
window.__ModuleLoader__.load({
  id: '@liubaibuliuyan/dsh-session-delete',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useReducer, useCallback } = React

    const API = '/dsh-session-delete'

    // ── 文案 ────────────────────────────────────────────────────────────
    const ZH = {
      menuDelete: '删除对话…',
      menuDeleteTitle: '把这个对话移入回收站',
      rowDelete: '删除这个对话',
      rowRunning: '正在运行的对话不能删除，先等它结束',
      inlineConfirm: '确认删除',
      confirmCancel: '取消',
      toastClose: '关闭提示',
      backToNew: '已退回新对话',
      busyDeleting: '正在删除…',
      doneMoved: (n) => (n === 1 ? '已移入回收站 · 可在设置里还原' : `已移入回收站 ${n} 个对话 · 可在设置里还原`),
      failedRunning: '有对话正在运行，已跳过。',
      failedInUse: '这个对话的日志文件正被占用（多半是它正开着或刚被预览过），先切到别的对话再删，或稍后重试。',
      failedNotFound: '磁盘上找不到这个会话的日志目录，可能已经被删过一次了。',
      failedOther: (n) => `${n} 个对话未能删除。`,
      // 设置页
      sectionLabel: '删除对话',
      title: '删除对话',
      subtitle: '删除的对话先进入回收站，日志目录整体搬走，投影缓存与工作区记账同步清理。',
      tabTrash: '回收站',
      tabResidue: '残留清理',
      emptyTrash: '回收站是空的。',
      emptyResidue: '没有发现残留的投影缓存。',
      colTitle: '标题',
      colCwd: '工作目录',
      colTime: '删除时间',
      colSize: '大小',
      restore: '还原',
      purge: '彻底删除',
      purgeAll: '清空回收站',
      cleanResidue: '清理全部残留',
      refresh: '刷新',
      selectAll: '全选',
      selected: (n) => `已选 ${n} 项`,
      restoreDone: (n) => `已还原 ${n} 个对话。`,
      purgeDone: (n) => `已彻底删除 ${n} 项。`,
      residueDone: (n, size) => `已清理 ${n} 个残留记录（${size}）。`,
      opFailed: (e) => `操作失败：${e}`,
      loadFailed: (e) => `加载失败：${e}`,
      noSelection: '先选中条目。',
      trashPath: '回收站位置',
      residueIntro:
        '这些是日志已经不在、投影缓存还留着的记录。删除会话时插件会一起清掉；已删除的会话如果又被应用把缓存写了回来（会从缓存里被列出来、还能打开），也会出现在这里——点「清理全部残留」即可。',
      confirmPurgeAll: '彻底删除回收站里的所有会话？此操作不可撤销。',
      confirmRestore: (n) => `还原 ${n} 个对话？`,
    }
    const EN = {
      menuDelete: 'Delete conversation…',
      menuDeleteTitle: 'Move this conversation to the trash',
      rowDelete: 'Delete this conversation',
      rowRunning: 'A running conversation cannot be deleted — wait for it to finish',
      inlineConfirm: 'Confirm delete',
      confirmCancel: 'Cancel',
      toastClose: 'Dismiss',
      backToNew: 'back to a new conversation',
      busyDeleting: 'Deleting…',
      doneMoved: (n) => (n === 1 ? 'Moved to trash · restore anytime in Settings' : `Moved ${n} conversations to trash · restore anytime in Settings`),
      failedRunning: 'Some conversations are running and were skipped.',
      failedInUse: 'Its log file is in use right now (open or just previewed). Switch to another conversation and try again.',
      failedNotFound: 'No log directory for this session on disk — it may already be deleted.',
      failedOther: (n) => `${n} conversation(s) could not be deleted.`,
      sectionLabel: 'Delete Conversation',
      title: 'Delete Conversation',
      subtitle:
        'Deleted conversations go to the trash: the log directory is moved as a whole, and the projection cache plus workspace bookkeeping are cleaned in the same step.',
      tabTrash: 'Trash',
      tabResidue: 'Residue',
      emptyTrash: 'The trash is empty.',
      emptyResidue: 'No orphaned projection caches found.',
      colTitle: 'Title',
      colCwd: 'Working directory',
      colTime: 'Deleted at',
      colSize: 'Size',
      restore: 'Restore',
      purge: 'Delete forever',
      purgeAll: 'Empty trash',
      cleanResidue: 'Clean all residue',
      refresh: 'Refresh',
      selectAll: 'Select all',
      selected: (n) => `${n} selected`,
      restoreDone: (n) => `Restored ${n} conversation(s).`,
      purgeDone: (n) => `Deleted ${n} item(s) forever.`,
      residueDone: (n, size) => `Cleaned ${n} orphaned record(s) (${size}).`,
      opFailed: (e) => `Operation failed: ${e}`,
      loadFailed: (e) => `Load failed: ${e}`,
      noSelection: 'Select something first.',
      trashPath: 'Trash location',
      residueIntro:
        'These records outlived their session logs. Deleting a conversation cleans them in the same step; this view is the fallback sweep for older leftovers.',
      confirmPurgeAll: 'Delete every conversation in the trash forever? This cannot be undone.',
      confirmRestore: (n) => `Restore ${n} conversation(s)?`,
    }

    let locale = 'zh'
    const tickSubs = new Set()
    function notifyTick() {
      for (const fn of tickSubs) fn()
    }
    /** 订阅语言切换，避免文案停在首次渲染时的那一种语言。 */
    function useLocaleTick() {
      const [, force] = useReducer((v) => v + 1, 0)
      useEffect(() => {
        tickSubs.add(force)
        return () => tickSubs.delete(force)
      }, [])
    }
    function t(key, ...args) {
      const dict = locale === 'en' ? EN : ZH
      const value = dict[key]
      if (typeof value === 'function') return value(...args)
      return value ?? key
    }

    // ── 删除确认：模块级状态 + shell.overlay 渲染 ────────────────────────
    let pending = null
    const pendingSubs = new Set()
    function setPending(next) {
      pending = next
      for (const fn of pendingSubs) fn()
    }
    function usePending() {
      const [, force] = useReducer((v) => v + 1, 0)
      useEffect(() => {
        pendingSubs.add(force)
        return () => pendingSubs.delete(force)
      }, [])
      return pending
    }

    async function callApi(action, payload) {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, ...(payload || {}) }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.ok === false) {
        const error = new Error(data.error || `HTTP ${res.status}`)
        error.payload = data
        error.status = res.status
        // Host 用 409 表达「一条都没成功」，原因在 failed[] 里；带上它，别让调用方只看到 HTTP 409
        error.reason = Array.isArray(data.failed) ? data.failed[0]?.reason : undefined
        throw error
      }
      return data
    }

    function failureReasonOf(error) {
      const payload = error?.payload || {}
      const failed = Array.isArray(payload.failed) ? payload.failed : []
      return String(error?.reason ?? failed[0]?.reason ?? '')
    }

    /** 把 Host 的结构化失败翻译成一句能照做的话。 */
    function describeFailure(error, t) {
      const reason = failureReasonOf(error)
      const payload = error?.payload || {}
      const moved = Array.isArray(payload.moved) ? payload.moved.length : 0
      const text =
        reason === 'running'
          ? t('failedRunning')
          : reason === 'in-use'
            ? t('failedInUse')
            : reason === 'not-found'
              ? t('failedNotFound')
              : reason
                ? t('opFailed', reason)
                : t('opFailed', String(error?.message ?? error))
      return moved > 0 ? `${t('doneMoved', moved)} ${text}` : text
    }

    /** Windows 上日志文件被瞬时段占用会让改名失败；这种失败值得退避重试。 */
    function isTransientMoveFailure(error) {
      const reason = failureReasonOf(error)
      if (reason === 'in-use') return true
      return /EPERM|EBUSY|EACCES|ENOTEMPTY|being used by another process/i.test(reason)
    }

    // 删除后「回到新对话页」需要两个客户端服务：uiWorkspace 负责导航，sessions 负责判断是否正开着。
    // 服务可能在 apply 之后才就绪，所以不在 apply 里缓存，用到时再取。
    let clientCtx = null
    function clientService(key) {
      try {
        return clientCtx?.get?.(key) ?? null
      } catch {
        return null
      }
    }

    /** 这条会话是否已经在主视图里物化（= 用户正开着它）。 */
    function isSessionOpen(sessionId) {
      try {
        return !!clientService('sessions')?.binding?.(sessionId)
      } catch {
        return false
      }
    }

    /**
     * 退回主页面（新对话界面）：等价于点侧边栏的 New Session。
     * 空白 New Session 在发出第一条消息前不落盘，所以这么做不会留下垃圾会话。
     *
     * 必须显式传工作区：startSession() 的默认顺序是「显式选中 → 当前会话所属 → 最近活跃」，
     * 而我们刚把会话从工作区里拆掉，第二步必然落空，会退到“最近活跃的工作区”去。
     */
    function returnToNewSession(workspaceId) {
      try {
        const uiWorkspace = clientService('uiWorkspace')
        if (typeof uiWorkspace?.startSession !== 'function') return false
        if (workspaceId) uiWorkspace.startSession(workspaceId)
        else uiWorkspace.startSession()
        return true
      } catch {
        return false
      }
    }

    /**
     * 执行一次删除（行内确认与菜单共用）。
     * 瞬时占用自动退避重试；无论成败都返回一句可以直接显示的话。
     */
    async function runDelete(sessionIds, cascade = true) {
      let data = null
      for (let attempt = 0; ; attempt += 1) {
        try {
          data = await callApi('delete', { sessionIds, cascade })
          break
        } catch (error) {
          if (attempt < 2 && isTransientMoveFailure(error)) {
            await new Promise((resolve) => setTimeout(resolve, 240 * (attempt + 1)))
            continue
          }
          return { ok: false, text: describeFailure(error, t) }
        }
      }
      const moved = Array.isArray(data.moved) ? data.moved.length : 0
      const failed = Array.isArray(data.failed) ? data.failed : []
      if (moved === 0) {
        const reason = failed[0]?.reason
        const text =
          reason === 'running'
            ? t('failedRunning')
            : reason === 'in-use'
              ? t('failedInUse')
              : reason === 'not-found'
                ? t('failedNotFound')
                : t('opFailed', String(reason ?? failed.length ?? 'unknown'))
        return { ok: false, text }
      }
      const failedNote = failed.length > 0 ? ` ${t('failedOther', failed.length)}` : ''
      // 取被删（根）会话原本的工作区：Host 在拆记账之前记下了它
      const entries = Array.isArray(data.entries) ? data.entries : []
      const workspaceId = entries.find((entry) => entry?.workspaceId)?.workspaceId ?? null
      return { ok: true, moved, partial: failed.length > 0, text: `${t('doneMoved', moved)}${failedNote}`, workspaceId }
    }

    // ── 结果提示：右下角小弹窗。成功自动消失，失败常驻并带 × 关闭 ────────
    let toast = null
    let toastTimer = null
    const toastSubs = new Set()
    const notifyToast = () => {
      for (const fn of toastSubs) fn()
    }
    function dismissToast() {
      if (toastTimer) {
        clearTimeout(toastTimer)
        toastTimer = null
      }
      if (!toast) return
      toast = null
      notifyToast()
    }
    function setToast(next) {
      if (toastTimer) {
        clearTimeout(toastTimer)
        toastTimer = null
      }
      toast = next
      notifyToast()
      if (next && next.kind !== 'error') {
        toastTimer = setTimeout(() => {
          toastTimer = null
          toast = null
          notifyToast()
        }, 2000)
      }
    }
    function useToast() {
      const [, force] = useReducer((v) => v + 1, 0)
      useEffect(() => {
        toastSubs.add(force)
        return () => toastSubs.delete(force)
      }, [])
      return toast
    }

    function formatBytes(bytes) {
      const n = Number(bytes) || 0
      if (n < 1024) return `${n} B`
      if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
      if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
      return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
    }

    function formatTime(ms) {
      const n = Number(ms) || 0
      if (!n) return '—'
      try {
        return new Date(n).toLocaleString(locale === 'en' ? 'en-US' : 'zh-CN', { hour12: false })
      } catch {
        return '—'
      }
    }

    function shortPath(value) {
      const s = String(value || '')
      if (!s) return ''
      const parts = s.split(/[\\/]+/).filter(Boolean)
      if (parts.length <= 2) return s
      return `…/${parts.slice(-2).join('/')}`
    }

    // ── 图标 ────────────────────────────────────────────────────────────
    function TrashIcon({ size = 14 }) {
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        h('path', { d: 'M2.5 4.5h11' }),
        h('path', { d: 'M6 4.5V3a.5.5 0 0 1 .5-.5h3A.5.5 0 0 1 10 3v1.5' }),
        h('path', { d: 'M4 4.5l.6 8.1a1 1 0 0 0 1 .9h4.8a1 1 0 0 0 1-.9L12 4.5' }),
        h('path', { d: 'M6.7 7v4M9.3 7v4' }),
      )
    }

    function CheckIcon({ size = 14 }) {
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        h('path', { d: 'M3.4 8.6l3.2 3.2 6-7' }),
      )
    }

    function CrossIcon({ size = 13 }) {
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2,
          strokeLinecap: 'round',
          'aria-hidden': true,
        },
        h('path', { d: 'M4.5 4.5l7 7M11.5 4.5l-7 7' }),
      )
    }

    // ── 入口 1：会话「…」菜单 ──────────────────────────────────────────
    function MenuDeleteItem(props) {
      const { sessionId, displayTitle, useMenuOpenState, useSessions, useSessionStatus } = props
      useLocaleTick()
      // 「…」菜单这个 slot 声明了 MenuOpenState hook；取不到时降级为不主动关菜单。
      const menuOpenState = typeof useMenuOpenState === 'function' ? useMenuOpenState() : null
      const setMenuOpen = menuOpenState ? menuOpenState[1] : null
      const sessionTitle = useSessions((s) => s.byId[sessionId]?.displayTitle)
      const running = useSessionStatus((s) => s[sessionId]?.running ?? false)
      if (!sessionId) return null
      const title = String(displayTitle || '').trim() || String(sessionTitle || '').trim()
      return h(
        'button',
        {
          type: 'button',
          role: 'menuitem',
          disabled: running,
          title: running ? t('rowRunning') : t('menuDeleteTitle'),
          onClick: (event) => {
            event.preventDefault()
            event.stopPropagation()
            if (running) return
            if (typeof setMenuOpen === 'function') setMenuOpen(false)
            setPending({ mode: 'inline', sessionIds: [sessionId], title, cascade: true })
          },
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            width: '100%',
            padding: '6px 10px',
            border: 'none',
            borderRadius: 6,
            background: 'transparent',
            color: running
              ? 'var(--dsw-alias-state-idle-primary)'
              : 'var(--dsw-alias-state-error-primary)',
            font: 'inherit',
            fontSize: 13,
            textAlign: 'left',
            cursor: running ? 'not-allowed' : 'pointer',
          },
        },
        h(TrashIcon, { size: 13 }),
        h('span', null, t('menuDelete')),
      )
    }

    // ── 入口 2：会话行悬停按钮 → 就地 ✓ / ✕ 确认 ───────────────────────
    function RowDeleteButton(props) {
      const { sessionId, displayTitle, useSessions, useSessionStatus } = props
      useLocaleTick()
      const state = usePending()
      const [busy, setBusy] = useState(false)
      const confirmRef = React.useRef(null)
      const sessionTitle = useSessions((s) => s.byId[sessionId]?.displayTitle)
      const running = useSessionStatus((s) => s[sessionId]?.running ?? false)
      const active = !!sessionId && !!state && state.mode === 'inline' && state.sessionIds?.[0] === sessionId

      useEffect(() => {
        if (!active) return undefined
        const onKey = (event) => {
          if (event.key === 'Escape') setPending(null)
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [active])

      // 弹出确认时把焦点放到 ✓ 上：回车即可确认，Esc 取消，键盘用户不用摸鼠标
      useEffect(() => {
        if (active && !busy) confirmRef.current?.focus?.()
      }, [active, busy])

      if (!sessionId) return null
      const title = String(displayTitle || '').trim() || String(sessionTitle || '').trim()

      const iconStyle = (color, extra) => ({
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 22,
        height: 22,
        padding: 0,
        border: 'none',
        borderRadius: 5,
        background: 'transparent',
        color,
        cursor: 'pointer',
        ...extra,
      })

      if (active) {
        const confirm = async (event) => {
          event.preventDefault()
          event.stopPropagation()
          const targetId = state.sessionIds?.[0]
          // 删之前先记下：这条是不是正开着。删完要退回新对话页，
          // 否则持久层的追加写入会把日志在原路径重建（回收站里会多一条重复）
          const wasOpen = targetId ? isSessionOpen(targetId) : false
          setBusy(true)
          const result = await runDelete(state.sessionIds, state.cascade !== false)
          setBusy(false)
          setPending(null)
          const wentHome = wasOpen && result.moved > 0 ? returnToNewSession(result.workspaceId) : false
          // 成功给一条两秒的确认（行会立刻消失，弹窗只是回执）；失败常驻，带原因和 ×
          const text = wentHome ? `${result.text} · ${t('backToNew')}` : result.text
          setToast({ kind: result.ok && !result.partial ? 'ok' : 'error', text })
        }
        const cancel = (event) => {
          event.preventDefault()
          event.stopPropagation()
          if (busy) return
          setPending(null)
        }
        return h(
          'span',
          {
            style: {
              display: 'inline-flex',
              alignItems: 'center',
              gap: 1,
              padding: '0 2px',
              borderRadius: 6,
              background: 'rgba(127, 127, 127, 0.16)',
            },
          },
          busy
            ? h('span', { style: iconStyle('var(--dsw-alias-label-secondary)', { cursor: 'default' }), title: t('busyDeleting') }, '…')
            : h(
                'button',
                {
                  ref: confirmRef,
                  type: 'button',
                  'aria-label': t('inlineConfirm'),
                  title: title ? `${t('inlineConfirm')} · ${title}` : t('inlineConfirm'),
                  onClick: confirm,
                  style: iconStyle('var(--dsw-alias-state-error-primary)'),
                },
                h(CheckIcon, { size: 14 }),
              ),
          h(
            'button',
            {
              type: 'button',
              'aria-label': t('confirmCancel'),
              title: t('confirmCancel'),
              onClick: cancel,
              disabled: busy,
              style: iconStyle('var(--dsw-alias-label-secondary)', busy ? { opacity: 0.4, cursor: 'default' } : undefined),
            },
            h(CrossIcon, { size: 13 }),
          ),
        )
      }

      return h(
        'button',
        {
          type: 'button',
          'aria-label': running ? t('rowRunning') : t('rowDelete'),
          title: running ? t('rowRunning') : t('rowDelete'),
          disabled: running,
          onClick: (event) => {
            event.preventDefault()
            event.stopPropagation()
            if (running) return
            setPending({ mode: 'inline', sessionIds: [sessionId], title, cascade: true })
          },
          style: iconStyle(running ? 'var(--dsw-alias-state-idle-primary)' : 'var(--dsw-alias-label-secondary)', {
            cursor: running ? 'not-allowed' : 'pointer',
            opacity: running ? 0.5 : 1,
          }),
        },
        h(TrashIcon, { size: 13 }),
      )
    }

    // ── 结果提示（shell.overlay）：右下角一条轻提示，全部用主题 token ──────
    function DeleteToast() {
      const state = useToast()
      useLocaleTick()
      const isError = state?.kind === 'error'

      // 失败的提示不会自动消失：Esc 也能关，别让用户只能去点那个 ×
      useEffect(() => {
        if (!isError) return undefined
        const onKey = (event) => {
          if (event.key === 'Escape') dismissToast()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [isError])

      if (!state) return null
      return h(
        'div',
        {
          role: isError ? 'alert' : 'status',
          'aria-live': isError ? 'assertive' : 'polite',
          style: {
            position: 'fixed',
            right: 20,
            bottom: 20,
            zIndex: 4000,
            // 成功提示只是回执，不拦点击；失败提示带 ×，需要能点
            pointerEvents: isError ? 'auto' : 'none',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
            maxWidth: 340,
            padding: '8px 10px 8px 12px',
            borderRadius: 8,
            background: 'var(--dsw-alias-bg-overlay)',
            color: 'var(--dsw-alias-label-primary)',
            border: '1px solid var(--dsw-alias-border-l1)',
            boxShadow: '0 6px 20px rgba(0, 0, 0, 0.16)',
            fontSize: 12.5,
            lineHeight: 1.45,
          },
        },
        h('span', {
          style: {
            flex: '0 0 auto',
            width: 6,
            height: 6,
            marginTop: 5,
            borderRadius: 999,
            background: isError ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-state-success-primary)',
          },
        }),
        h('span', { style: { minWidth: 0, wordBreak: 'break-word' } }, state.text),
        isError
          ? h(
              'button',
              {
                type: 'button',
                'aria-label': t('toastClose'),
                title: t('toastClose'),
                onClick: (event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  dismissToast()
                },
                style: {
                  flex: '0 0 auto',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 18,
                  height: 18,
                  marginLeft: 2,
                  marginTop: -1,
                  padding: 0,
                  border: 'none',
                  borderRadius: 4,
                  background: 'transparent',
                  color: 'var(--dsw-alias-label-secondary)',
                  cursor: 'pointer',
                },
              },
              h(CrossIcon, { size: 11 }),
            )
          : null,
      )
    }

    // ── 入口 3：设置页 ──────────────────────────────────────────────────
    function SettingsSection() {
      useLocaleTick()
      const [tab, setTab] = useState('trash')
      const [state, setState] = useState({ status: 'loading', trash: [], residue: { orphans: [], totalBytes: 0 }, home: '', trashRoot: '' })
      const [selected, setSelected] = useState(() => new Set())
      const [busy, setBusy] = useState(false)
      const [notice, setNotice] = useState(null)
      const [error, setError] = useState(null)

      const load = useCallback(async () => {
        setState((prev) => ({ ...prev, status: 'loading' }))
        try {
          const data = await callApi('list')
          setState({
            status: 'ready',
            trash: Array.isArray(data.trash) ? data.trash : [],
            residue: data.residue ?? { orphans: [], totalBytes: 0 },
            home: String(data.home ?? ''),
            trashRoot: String(data.trashRoot ?? ''),
          })
          setSelected(new Set())
        } catch (e) {
          setState((prev) => ({ ...prev, status: 'error' }))
          setError(t('loadFailed', String(e?.message ?? e)))
        }
      }, [])

      useEffect(() => {
        void load()
      }, [load])

      const rows = tab === 'trash' ? state.trash : state.residue.orphans
      const rowKey = (row) => String(tab === 'trash' ? row.entryId : row.sessionId)
      const allSelected = rows.length > 0 && rows.every((row) => selected.has(rowKey(row)))

      const toggle = (key) => {
        setSelected((prev) => {
          const next = new Set(prev)
          if (next.has(key)) next.delete(key)
          else next.add(key)
          return next
        })
      }

      const run = async (fn) => {
        if (busy) return
        setBusy(true)
        setError(null)
        setNotice(null)
        try {
          await fn()
        } catch (e) {
          setError(t('opFailed', String(e?.message ?? e)))
        } finally {
          setBusy(false)
        }
      }

      const doRestore = () =>
        run(async () => {
          if (selected.size === 0) throw new Error(t('noSelection'))
          const data = await callApi('restore', { entryIds: [...selected] })
          setNotice(t('restoreDone', data.restored?.length ?? 0))
          await load()
        })

      const doPurge = () =>
        run(async () => {
          if (selected.size === 0) throw new Error(t('noSelection'))
          const data = await callApi('purge', { entryIds: [...selected] })
          setNotice(t('purgeDone', data.purged?.length ?? 0))
          await load()
        })

      const doPurgeAll = () =>
        run(async () => {
          if (!window.confirm(t('confirmPurgeAll'))) return
          const data = await callApi('purge', {})
          setNotice(t('purgeDone', data.purged?.length ?? 0))
          await load()
        })

      const doCleanResidue = () =>
        run(async () => {
          const ids = selected.size > 0 ? [...selected] : undefined
          const data = await callApi('cleanResidue', ids ? { sessionIds: ids } : {})
          setNotice(t('residueDone', data.removed?.length ?? 0, formatBytes(data.bytes ?? 0)))
          await load()
        })

      const buttonStyle = (variant) => ({
        padding: '5px 12px',
        borderRadius: 7,
        font: 'inherit',
        fontSize: 12,
        cursor: busy ? 'not-allowed' : 'pointer',
        border:
          variant === 'primary'
            ? '1px solid transparent'
            : variant === 'danger'
              ? '1px solid var(--dsw-alias-state-error-primary)'
              : '1px solid var(--dsw-alias-border-l2)',
        background: variant === 'primary' ? 'var(--dsw-alias-brand-primary)' : 'transparent',
        color:
          variant === 'primary'
            ? '#fff'
            : variant === 'danger'
              ? 'var(--dsw-alias-state-error-primary)'
              : 'var(--dsw-alias-label-primary)',
        opacity: busy ? 0.7 : 1,
      })

      const tabStyle = (active) => ({
        padding: '4px 12px',
        borderRadius: 999,
        border: '1px solid ' + (active ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l1)'),
        background: active ? 'var(--dsw-alias-brand-primary)' : 'transparent',
        color: active ? '#fff' : 'var(--dsw-alias-label-secondary)',
        font: 'inherit',
        fontSize: 12,
        cursor: 'pointer',
      })

      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13, color: 'var(--dsw-alias-label-primary)' } },
        h('div', null, h('h3', { style: { margin: '0 0 4px', fontSize: 15 } }, t('title'))),
        h('p', { style: { margin: 0, color: 'var(--dsw-alias-label-secondary)' } }, t('subtitle')),

        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
          h('button', { type: 'button', style: tabStyle(tab === 'trash'), onClick: () => setTab('trash') }, `${t('tabTrash')} (${state.trash.length})`),
          h('button', { type: 'button', style: tabStyle(tab === 'residue'), onClick: () => setTab('residue') }, `${t('tabResidue')} (${state.residue.orphans.length})`),
          h('span', { style: { flex: 1 } }),
          h('button', { type: 'button', style: buttonStyle(), disabled: busy, onClick: () => void load() }, t('refresh')),
        ),

        notice ? h('p', { style: { margin: 0, color: 'var(--dsw-alias-state-success-primary)' } }, notice) : null,
        error ? h('p', { style: { margin: 0, color: 'var(--dsw-alias-state-error-primary)' } }, error) : null,

        tab === 'residue'
          ? h('p', { style: { margin: 0, color: 'var(--dsw-alias-label-secondary)' } }, t('residueIntro'))
          : null,

        rows.length === 0
          ? h(
              'p',
              { style: { margin: 0, padding: '18px 0', color: 'var(--dsw-alias-label-secondary)' } },
              tab === 'trash' ? t('emptyTrash') : t('emptyResidue'),
            )
          : h(
              'div',
              { style: { border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 10, overflow: 'hidden' } },
              h(
                'div',
                {
                  style: {
                    display: 'grid',
                    gridTemplateColumns: '28px 1.6fr 1.2fr 1fr 72px',
                    gap: 8,
                    padding: '6px 10px',
                    background: 'var(--dsw-alias-bg-layer-2)',
                    color: 'var(--dsw-alias-label-secondary)',
                    fontSize: 11,
                  },
                },
                h(
                  'input',
                  {
                    type: 'checkbox',
                    checked: allSelected,
                    onChange: () => setSelected(allSelected ? new Set() : new Set(rows.map(rowKey))),
                    'aria-label': t('selectAll'),
                  },
                ),
                h('span', null, t('colTitle')),
                h('span', null, t('colCwd')),
                h('span', null, tab === 'trash' ? t('colTime') : 'sessionId'),
                h('span', { style: { textAlign: 'right' } }, t('colSize')),
              ),
              rows.map((row) => {
                const key = rowKey(row)
                return h(
                  'label',
                  {
                    key,
                    style: {
                      display: 'grid',
                      gridTemplateColumns: '28px 1.6fr 1.2fr 1fr 72px',
                      gap: 8,
                      padding: '6px 10px',
                      alignItems: 'center',
                      borderTop: '1px solid var(--dsw-alias-border-l1)',
                      cursor: 'pointer',
                    },
                  },
                  h('input', { type: 'checkbox', checked: selected.has(key), onChange: () => toggle(key) }),
                  h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, row.title || row.sessionId),
                  h(
                    'span',
                    { style: { color: 'var(--dsw-alias-label-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                    tab === 'trash' ? shortPath(row.cwd) : row.file,
                  ),
                  h('span', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: 12 } }, tab === 'trash' ? formatTime(row.deletedAt) : '—'),
                  h('span', { style: { textAlign: 'right', fontSize: 12 } }, formatBytes(row.bytes)),
                )
              }),
            ),

        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
          h('span', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: 12 } }, t('selected', selected.size)),
          h('span', { style: { flex: 1 } }),
          tab === 'trash'
            ? h(
                'span',
                { style: { display: 'flex', gap: 8 } },
                h('button', { type: 'button', style: buttonStyle(), disabled: busy, onClick: () => void doRestore() }, t('restore')),
                h('button', { type: 'button', style: buttonStyle('danger'), disabled: busy, onClick: () => void doPurge() }, t('purge')),
                h('button', { type: 'button', style: buttonStyle('danger'), disabled: busy, onClick: () => void doPurgeAll() }, t('purgeAll')),
              )
            : h(
                'span',
                { style: { display: 'flex', gap: 8 } },
                h('button', { type: 'button', style: buttonStyle('primary'), disabled: busy, onClick: () => void doCleanResidue() }, t('cleanResidue')),
              ),
        ),

        h(
          'p',
          { style: { margin: 0, color: 'var(--dsw-alias-label-secondary)', fontSize: 11 } },
          `${t('trashPath')}: ${state.trashRoot || '—'}`,
        ),
      )
    }

    // ── 装配 ────────────────────────────────────────────────────────────
    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.inject(['locale'], (c) => {
          try {
            const read = () => String(c.locale.getSnapshot?.()?.active ?? 'zh')
            locale = read()
            const off = c.locale.subscribe?.(() => {
              locale = read()
              notifyTick()
            })
            if (typeof off === 'function') c.effect(() => off, 'session-delete: locale')
          } catch {}
        })

        const slots = ctx.slots

        // 删除后需要「回到新对话页」：uiWorkspace.startSession() 就是侧边栏的 New Session，
        // 而 sessions.binding(id) 能看出这条会话是否已在主视图里被物化（= 正开着）
        clientCtx = ctx

        // ① 会话「…」菜单：排在内置的复制会话 ID（450）之后
        slots.inject('sidebar.workspaces.session.menu.item', () =>
          slots.register(
            { name: 'sidebar.workspaces.session.menu.item', id: 'session-delete.menu', order: 500 },
            MenuDeleteItem,
          ),
        )

        // ② 会话行悬停按钮：与内置 archive(100)/pin(200) 并排
        slots.inject('sidebar.workspaces.session.row.action', () =>
          slots.register(
            { name: 'sidebar.workspaces.session.row.action', id: 'session-delete.row', order: 150 },
            RowDeleteButton,
          ),
        )

        // ③ 确认浮层
        slots.inject('shell.overlay', () =>
          slots.register({ name: 'shell.overlay', id: 'session-delete.toast', order: 60 }, DeleteToast),
        )

        // ④ 设置页：回收站 + 残留清理
        slots.inject('settings.section', () =>
          slots.register(
            {
              name: 'settings.section',
              id: 'session-delete',
              order: 41,
              label: () => (locale === 'en' ? EN.sectionLabel : ZH.sectionLabel),
            },
            SettingsSection,
          ),
        )
      },
    }
  },
})
