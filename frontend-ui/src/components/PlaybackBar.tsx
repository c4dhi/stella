
import { useMemo } from 'react'
import { useStore } from '../store'
import { PeerTransport } from '../services/PeerTransport'

export default function PlaybackBar() {
  const status = useStore(s => s.status)
  const playing = useStore(s => s.playing)
  const setPlaying = useStore(s => s.setPlaying)
  const transport = useMemo(() => new PeerTransport(), [])

  const pause = () => { setPlaying(false); try { transport.sendControl('barge_in', { action: 'pause' }) } catch {} }
  const resume = () => { setPlaying(true); try { transport.sendControl('system', { action: 'resume' }) } catch {} }

  return (
    <div className="p-3 bg-white dark:bg-gray-800 shadow rounded-xl flex items-center gap-3">
      <button disabled={status!=='connected'} onClick={pause} className="px-3 py-2 rounded bg-gray-200 hover:bg-gray-300 dark:bg-gray-600 dark:hover:bg-gray-500 dark:text-white disabled:opacity-50">Pause</button>
      <button disabled={status!=='connected'} onClick={resume} className="px-3 py-2 rounded bg-gray-200 hover:bg-gray-300 dark:bg-gray-600 dark:hover:bg-gray-500 dark:text-white disabled:opacity-50">Resume</button>
      <button disabled={status!=='connected'} onClick={pause} className="px-3 py-2 rounded bg-amber-200 hover:bg-amber-300 dark:bg-amber-600 dark:hover:bg-amber-500 dark:text-white disabled:opacity-50">Barge in</button>
    </div>
  )
}
