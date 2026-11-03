import React, { useEffect, useRef, useState } from 'react'

export default function Station() {
  const [code, setCode] = useState('')
  const [deviceToken, setDeviceToken] = useState(
    () => sessionStorage.getItem('attendx_device_token') || ''
  )
  const [cameraName, setCameraName] = useState(
    () => sessionStorage.getItem('attendx_camera_name') || ''
  )
  const [cameraId, setCameraId] = useState(
    () => sessionStorage.getItem('attendx_camera_id') || ''
  )
  const [status, setStatus] = useState('Not paired')
  const [error, setError] = useState('')
  const [cameraFacing, setCameraFacing] = useState('environment')

  const [streaming, setStreaming] = useState(false)
  const [liveStreaming, setLiveStreaming] = useState(false)
  const [liveStatus, setLiveStatus] = useState('Not streaming')

  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const peerRef = useRef(null)
  const resourceRef = useRef(null)
  const reconnectTimerRef = useRef(null)
  const reconnectAttemptsRef = useRef(0)
  const manualStopRef = useRef(true)
  const connectingRef = useRef(false)

  const pairDevice = async (e) => {
    e.preventDefault()
    setError('')
    try {
      const res = await fetch('/api/station/pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim() })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Pairing failed.')

      sessionStorage.setItem('attendx_device_token', data.device_token)
      sessionStorage.setItem('attendx_camera_name', data.camera)
      sessionStorage.setItem('attendx_camera_id', data.camera_id)

      setCameraId(data.camera_id)
      setDeviceToken(data.device_token)
      setCameraName(data.camera)
      setCode('')
      setStatus('Paired — connecting...')
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => {
    if (!deviceToken) return
    let active = true

    const heartbeat = async () => {
      try {
        const res = await fetch('/api/station/heartbeat', {
          method: 'POST',
          headers: { Authorization: `Bearer ${deviceToken}` }
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.detail || 'Heartbeat failed.')

        if (data.camera_id) {
          sessionStorage.setItem('attendx_camera_id', data.camera_id)
          if (active) setCameraId(data.camera_id)
        }
        if (active) setStatus('Online')
      } catch (err) {
        if (active) setStatus('Offline — ' + err.message)
      }
    }

    heartbeat()
    const timer = setInterval(heartbeat, 30000)

    return () => {
      active = false
      clearInterval(timer)
    }
  }, [deviceToken])

  const startPreview = async () => {
    setError('')
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Camera preview requires HTTPS or localhost.')
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: cameraFacing } },
        audio: false
      })

      streamRef.current = stream
      if (videoRef.current) videoRef.current.srcObject = stream
      setStreaming(true)
    } catch (err) {
      setError(err.message || 'Camera access failed.')
    }
  }

  const scheduleReconnect = (reason = 'Connection interrupted') => {
    if (manualStopRef.current) return

    const hasLiveTrack = streamRef.current?.getTracks().some(
      track => track.readyState === 'live'
    )

    if (!hasLiveTrack) return
    if (reconnectTimerRef.current) return

    const delay = Math.min(
      2000 * Math.pow(2, reconnectAttemptsRef.current),
      15000
    )

    reconnectAttemptsRef.current += 1

    setLiveStreaming(false)
    setLiveStatus(`Reconnecting in ${Math.ceil(delay / 1000)}s...`)

    reconnectTimerRef.current = setTimeout(async () => {
      reconnectTimerRef.current = null

      const currentPeer = peerRef.current

      if (currentPeer?.connectionState === 'connected') {
        reconnectAttemptsRef.current = 0
        setLiveStreaming(true)
        setLiveStatus('Live — connected')
        return
      }

      if (connectingRef.current) {
        scheduleReconnect('Waiting for previous connection')
        return
      }

      const resource = resourceRef.current
      peerRef.current = null
      resourceRef.current = null

      currentPeer?.close()

      if (resource && deviceToken) {
        try {
          await fetch(resource, {
            method: 'DELETE',
            headers: {
              Authorization: `Basic ${btoa(`station:${deviceToken}`)}`
            }
          })
        } catch (err) {
          console.warn('Old stream session cleanup failed.')
        }
      }

      if (!manualStopRef.current) {
        startLiveStream()
      }
    }, delay)
  }

  const stopLiveStream = async () => {
    manualStopRef.current = true

    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }

    reconnectAttemptsRef.current = 0

    const peer = peerRef.current
    const resource = resourceRef.current

    peerRef.current = null
    resourceRef.current = null

    if (peer) peer.close()

    if (resource && deviceToken) {
      try {
        const auth = btoa(`station:${deviceToken}`)
        await fetch(resource, {
          method: 'DELETE',
          headers: { Authorization: `Basic ${auth}` }
        })
      } catch (err) {
        console.warn('Stream session cleanup failed.')
      }
    }

    setLiveStreaming(false)
    setLiveStatus('Not streaming')
  }

  const startLiveStream = async () => {
    if (connectingRef.current) return

    setError('')

    if (!streamRef.current || !streaming) {
      setError('Pehle camera preview start karo.')
      return
    }

    if (!cameraId || !deviceToken) {
      setError('Camera pairing details missing. Please check station pairing.')
      return
    }

    manualStopRef.current = false
    connectingRef.current = true

    let peer

    try {
      setLiveStatus('Connecting to streaming server...')

      peer = new RTCPeerConnection({
        iceServers: []
      })

      peerRef.current = peer

      streamRef.current.getTracks().forEach(track => {
        peer.addTrack(track, streamRef.current)
      })

      peer.onconnectionstatechange = () => {
        if (peerRef.current !== peer) return

        if (peer.connectionState === 'connected') {
          if (reconnectTimerRef.current) {
            clearTimeout(reconnectTimerRef.current)
            reconnectTimerRef.current = null
          }

          reconnectAttemptsRef.current = 0
          setLiveStreaming(true)
          setLiveStatus('Live — connected')

          fetch(`/api/station/stream-started/${cameraId}`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${deviceToken}`
            }
          })
            .then(async response => {
              if (!response.ok) {
                const message = await response.text()
                throw new Error(message || `Verification failed: ${response.status}`)
              }
              setLiveStatus('Live — station verified')
            })
            .catch(err => {
              console.error('Station verification failed:', err)
              setLiveStatus('Live — verification pending')
            })
        } else if (
          peer.connectionState === 'failed' ||
          peer.connectionState === 'disconnected'
        ) {
          scheduleReconnect('Connection interrupted')
        }
      }

      const offer = await peer.createOffer()
      await peer.setLocalDescription(offer)

      if (peer.iceGatheringState !== 'complete') {
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error('ICE gathering timed out.')),
            15000
          )

          const checkState = () => {
            if (peer.iceGatheringState === 'complete') {
              clearTimeout(timeout)
              peer.removeEventListener('icegatheringstatechange', checkState)
              resolve()
            }
          }

          peer.addEventListener('icegatheringstatechange', checkState)
          checkState()
        })
      }

      if (manualStopRef.current || peerRef.current !== peer) return

      const auth = btoa(`station:${deviceToken}`)

      const response = await fetch(`/camera-${cameraId}/whip`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/sdp'
        },
        body: peer.localDescription.sdp
      })

      if (!response.ok) {
        const message = await response.text()
        throw new Error(`Streaming server returned ${response.status}: ${message}`)
      }

      const answer = await response.text()
      const location = response.headers.get('Location')

      if (!location) {
        throw new Error('Streaming server did not return a session location.')
      }

      const resourceUrl = new URL(location, window.location.origin)
      resourceRef.current = resourceUrl.pathname + resourceUrl.search

      if (manualStopRef.current || peerRef.current !== peer) {
        peer.close()
        return
      }

      await peer.setRemoteDescription({
        type: 'answer',
        sdp: answer
      })

      setLiveStreaming(true)
      setLiveStatus('Stream started — checking connection...')

    } catch (err) {
      if (peerRef.current === peer) {
        peerRef.current = null
        peer.close()
      }

      setLiveStreaming(false)

      if (!manualStopRef.current) {
        setLiveStatus('Connection lost — retrying...')
        setError(err.message || 'Could not start live stream.')
        scheduleReconnect('Stream connection failed')
      }

    } finally {
      connectingRef.current = false
    }
  }

  const stopPreview = async () => {
    await stopLiveStream()

    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = null

    if (videoRef.current) videoRef.current.srcObject = null
    setStreaming(false)
  }

  const unpairThisBrowser = async () => {
    await stopPreview()

    sessionStorage.removeItem('attendx_device_token')
    sessionStorage.removeItem('attendx_camera_name')
    sessionStorage.removeItem('attendx_camera_id')

    setCameraId('')
    setDeviceToken('')
    setCameraName('')
    setStatus('Not paired')
  }

  useEffect(() => {
    return () => {
      manualStopRef.current = true

      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }

      peerRef.current?.close()
      streamRef.current?.getTracks().forEach(track => track.stop())
    }
  }, [])

  return (
    <main style={{ maxWidth: '760px', margin: '40px auto', padding: '20px' }}>
      <h1>AttendX Camera Station</h1>
      <p>Pair this device with your assigned classroom camera.</p>

      {!deviceToken ? (
        <form onSubmit={pairDevice} className="panel">
          <h3>Pair your device</h3>
          <label>
            One-time pairing code
            <input
              required
              minLength={10}
              value={code}
              onChange={e => setCode(e.target.value)}
              placeholder="Enter code from admin dashboard"
            />
          </label>
          <button className="primary" type="submit">Pair Device</button>
        </form>
      ) : (
        <div className="panel">
          <h3>Device paired</h3>
          <p><b>Camera:</b> {cameraName}</p>
          <p><b>Connection:</b> {status}</p>
          <p className="muted">
            Heartbeat is sent every 30 seconds while this page is open.
          </p>

          <label style={{ display: 'block', marginBottom: '12px' }}>
            Camera
            <select
              value={cameraFacing}
              disabled={streaming}
              onChange={e => setCameraFacing(e.target.value)}
            >
              <option value="environment">Back Camera</option>
              <option value="user">Front Camera</option>
            </select>
          </label>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            style={{
              width: '100%',
              maxWidth: '600px',
              background: '#111',
              borderRadius: '12px'
            }}
          />

          {!streaming ? (
            <button className="primary" onClick={startPreview}>
              Start Camera Preview
            </button>
          ) : (
            <>
              <button
                className="primary"
                onClick={startLiveStream}
                disabled={liveStreaming}
              >
                Start Live Stream
              </button>

              {liveStreaming && (
                <button className="secondary" onClick={stopLiveStream}>
                  Stop Live Stream
                </button>
              )}

              <button className="secondary" onClick={stopPreview}>
                Stop Camera Preview
              </button>
            </>
          )}

          <p><b>Live Stream:</b> {liveStatus}</p>

          <button
            className="secondary"
            onClick={unpairThisBrowser}
            style={{ marginLeft: '10px' }}
          >
            Sign out this station
          </button>
        </div>
      )}

      {error && <p role="alert">{error}</p>}

      <p style={{ marginTop: '24px' }}>
        <a href="/">Return to AttendX</a>
      </p>
    </main>
  )
}
